/**
 * AI Flow Builder — Flow Routes
 * CRUD operations + AI flow generation endpoint.
 */

const express = require('express');
const router = express.Router();
const Flow = require('../models/Flow');
const Credential = require('../models/Credential');
const AIEngine = require('../core/ai-engine');
const logger = require('../utils/logger');

const ai = new AIEngine();

// ─── AI Generate Flow ──────────────────────────────────

/**
 * POST /api/flows/generate
 * Generate flow steps from natural language using AI
 */
router.post('/generate', async (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }

    // Provide context to AI
    const credentials = Credential.findAll();
    const context = { credentials };

    const flow = await ai.generateFlow(instruction, context);

    res.json({
      success: true,
      flow,
    });
  } catch (err) {
    logger.error('Flow generation failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Chat ───────────────────────────────────────────

/**
 * POST /api/flows/chat
 * Chat with AI about automation tasks
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const response = await ai.chat(message, history);
    res.json({ success: true, response });
  } catch (err) {
    logger.error('AI chat failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── CRUD Operations ──────────────────────────────────

/**
 * GET /api/flows
 * List all flows
 */
router.get('/', (req, res) => {
  try {
    const { category, search } = req.query;
    let flows;

    if (search) {
      flows = Flow.search(search);
    } else {
      flows = Flow.findAll(category);
    }

    res.json({ success: true, flows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/flows/:id
 * Get single flow
 */
router.get('/:id', (req, res) => {
  try {
    const flow = Flow.findById(parseInt(req.params.id));
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json({ success: true, flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/flows
 * Create a new flow
 */
router.post('/', (req, res) => {
  try {
    const { name, description, steps, category, warmUpEnabled } = req.body;
    if (!name || !steps) {
      return res.status(400).json({ error: 'name and steps are required' });
    }

    const flow = Flow.create({ name, description, steps, category, warmUpEnabled });
    res.status(201).json({ success: true, flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/flows/:id
 * Update a flow
 */
router.put('/:id', (req, res) => {
  try {
    const { name, description, steps, category, is_favorite, warmUpEnabled } = req.body;
    const flow = Flow.update(parseInt(req.params.id), {
      name, description, steps, category, is_favorite, warmUpEnabled,
    });
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json({ success: true, flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/flows/:id
 * Delete a flow
 */
router.delete('/:id', (req, res) => {
  try {
    Flow.delete(parseInt(req.params.id));
    res.json({ success: true, message: 'Flow deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
