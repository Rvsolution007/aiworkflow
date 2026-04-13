/**
 * AI Flow Builder — AI Engine (Gemini Vertex AI)
 * Converts natural language instructions to structured browser automation flows.
 * Uses Gemini's function calling for intelligent step generation.
 */

const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

// Set credentials path for Google Cloud SDK
if (config.google.credentialsPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(config.google.credentialsPath);
}

class AIEngine {
  constructor() {
    this.vertexAI = null;
    this.model = null;
    this._initialized = false;
  }

  /**
   * Initialize Vertex AI connection
   */
  async init() {
    if (this._initialized) return;

    try {
      this.vertexAI = new VertexAI({
        project: config.google.projectId,
        location: config.google.location,
      });

      this.model = this.vertexAI.getGenerativeModel({
        model: config.google.model,
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 8192,
        },
        systemInstruction: {
          parts: [{ text: this._getSystemPrompt() }],
        },
      });

      this._initialized = true;
      logger.info('AI Engine initialized with Gemini Vertex AI', {
        model: config.google.model,
        project: config.google.projectId,
      });
    } catch (err) {
      logger.error('Failed to initialize AI Engine', { error: err.message });
      throw err;
    }
  }

  /**
   * Generate automation flow from natural language
   * @param {string} userInstruction - Natural language description of the task
   * @param {object} context - Additional context (available credentials, etc.)
   * @returns {object} Generated flow with steps
   */
  async generateFlow(userInstruction, context = {}) {
    await this.init();

    const prompt = this._buildFlowPrompt(userInstruction, context);

    try {
      logger.info('Generating flow from AI...', { instruction: userInstruction.substring(0, 100) });

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const response = result.response;
      const text = response.candidates[0].content.parts[0].text;

      // Parse the JSON response
      const flow = this._parseFlowResponse(text);

      logger.info('Flow generated successfully', {
        name: flow.flowName,
        steps: flow.steps.length,
      });

      return flow;
    } catch (err) {
      logger.error('AI flow generation failed', { error: err.message });
      throw new Error(`AI Engine Error: ${err.message}`);
    }
  }

  /**
   * Self-heal a failed step by analyzing screenshot
   * @param {string} screenshotPath - Path to screenshot
   * @param {object} failedStep - The step that failed
   * @param {string} errorMessage - Error description
   * @returns {object} Suggested fix action
   */
  async healStep(screenshotPath, failedStep, errorMessage) {
    await this.init();

    try {
      // Read screenshot as base64
      const imageBuffer = fs.readFileSync(screenshotPath);
      const base64Image = imageBuffer.toString('base64');

      const prompt = `You are a browser automation expert. A step has failed during execution.

FAILED STEP:
${JSON.stringify(failedStep, null, 2)}

ERROR: ${errorMessage}

Look at the screenshot and suggest an alternative action to achieve the same goal.
The page might have loaded differently, the element might have a different selector, or the page structure changed.

Respond with ONLY a valid JSON object (no markdown fences):
{
  "action": "click|type|wait|scroll|navigate|wait_for_element",
  "params": { ... },
  "description": "What this fix does",
  "confidence": 0.0-1.0
}`;

      const result = await this.model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/png',
                data: base64Image,
              },
            },
          ],
        }],
      });

      const text = result.response.candidates[0].content.parts[0].text;
      return this._parseJSON(text);
    } catch (err) {
      logger.error('Self-healing failed', { error: err.message });
      return null;
    }
  }

  /**
   * Chat with AI about automation (general conversation)
   * @param {string} message - User message
   * @param {Array} history - Chat history
   * @returns {string} AI response
   */
  async chat(message, history = []) {
    await this.init();

    const contents = [
      ...history.map(h => ({
        role: h.role,
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    try {
      const result = await this.model.generateContent({ contents });
      return result.response.candidates[0].content.parts[0].text;
    } catch (err) {
      logger.error('AI chat failed', { error: err.message });
      throw err;
    }
  }

  // ─── Private Methods ─────────────────────────────────

  _getSystemPrompt() {
    return `You are an expert browser automation AI assistant called "FlowAI".
Your job is to convert natural language task descriptions into precise browser automation steps.

You understand web interfaces deeply — Google Admin Console, Workspace, AWS, Azure, social media platforms, etc.
You know how these UIs work, their navigation patterns, button locations, and typical flows.

CAPABILITIES:
You can create steps using these actions:
1. navigate - Open a URL
2. click - Click element (by CSS selector, text content, or description)
3. type - Type text into input fields
4. wait - Wait for duration (ms) or element to appear
5. screenshot - Take a screenshot
6. scroll - Scroll page up/down
7. select - Select dropdown option
8. conditional_login - Check if login is required, login with stored credentials
9. wait_for_element - Wait until specific element appears/disappears
10. extract_text - Extract text from element
11. keyboard - Press keyboard keys (Enter, Tab, Escape, etc.)
12. wait_for_navigation - Wait for page navigation to complete

RULES:
- Always include realistic wait times between critical steps
- Add conditional_login step for sites that require authentication
- Use descriptive text-based selectors when possible (more resilient to UI changes)
- Include screenshot steps after critical actions for verification
- Add error descriptions to help with debugging
- Be specific about which credential to use (by name)
- Consider page load times — add wait_for_navigation after clicks that cause navigation

When responding with a flow, format it as valid JSON.`;
  }

  _buildFlowPrompt(instruction, context) {
    let prompt = `Generate a browser automation flow for this task:

USER INSTRUCTION: "${instruction}"

`;

    if (context.credentials && context.credentials.length > 0) {
      prompt += `AVAILABLE CREDENTIALS (by name):\n`;
      context.credentials.forEach(c => {
        prompt += `- "${c.name}" (${c.label || 'no label'})\n`;
      });
      prompt += '\n';
    }

    if (context.variables) {
      prompt += `AVAILABLE VARIABLES:\n${JSON.stringify(context.variables, null, 2)}\n\n`;
    }

    prompt += `Respond with ONLY a valid JSON object (no markdown code fences, no explanation):
{
  "flowName": "Short descriptive name",
  "description": "What this flow does",
  "category": "google|aws|social|custom|other",
  "steps": [
    {
      "action": "navigate|click|type|wait|screenshot|scroll|select|conditional_login|wait_for_element|extract_text|keyboard|wait_for_navigation",
      "params": {
        "url": "for navigate",
        "selector": "CSS selector or text=TextContent",
        "text": "for type action",
        "duration": 1000,
        "credential_key": "credential name for login",
        "key": "Enter|Tab|Escape for keyboard",
        "direction": "up|down for scroll",
        "pixels": 300
      },
      "description": "Human-readable step description"
    }
  ]
}

IMPORTANT: Use text= prefix for text-based selectors (e.g., "text=Billing"). Use credential_key to reference stored credentials.`;

    return prompt;
  }

  _parseFlowResponse(text) {
    const flow = this._parseJSON(text);
    if (!flow || !flow.steps || !Array.isArray(flow.steps)) {
      throw new Error('AI returned invalid flow format');
    }
    return flow;
  }

  _parseJSON(text) {
    // Try direct parse first
    try {
      return JSON.parse(text);
    } catch (e) {
      // Try extracting JSON from markdown code block
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (e2) {
          // Continue to next attempt
        }
      }

      // Try finding JSON object in text
      const objMatch = text.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          return JSON.parse(objMatch[0]);
        } catch (e3) {
          // Give up
        }
      }

      logger.error('Failed to parse AI JSON response', { text: text.substring(0, 500) });
      throw new Error('Could not parse AI response as JSON');
    }
  }
}

module.exports = AIEngine;
