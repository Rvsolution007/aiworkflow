/**
 * AI Flow Builder — Flow Executor
 * The heart of the system. Executes automation flows step by step.
 * Features: anti-detect browsing, self-healing, live progress reporting.
 */

const BrowserManager = require('./browser-manager');
const HumanBehavior = require('./human-behavior');
const SelfHealer = require('./self-healer');
const Credential = require('../models/Credential');
const Execution = require('../models/Execution');
const logger = require('../utils/logger');
const { sleep, randomInt, formatDuration } = require('../utils/helpers');

class FlowExecutor {
  /**
   * @param {object} options
   * @param {function} options.onProgress - Callback for progress updates (step, status, screenshot)
   */
  constructor(options = {}) {
    this.browserManager = new BrowserManager();
    this.human = null;
    this.selfHealer = new SelfHealer();
    this.onProgress = options.onProgress || (() => {});
    this.executionId = null;
    this._cancelled = false;
  }

  /**
   * Execute a flow (all steps)
   * @param {object} flow - Flow object with steps array
   * @param {number} executionId - Execution record ID  
   * @returns {object} Execution result
   */
  async execute(flow, executionId) {
    this.executionId = executionId;
    this._cancelled = false;
    const startTime = Date.now();

    logger.info(`Starting flow execution: "${flow.name}"`, {
      executionId,
      totalSteps: flow.steps.length,
    });

    // Update execution status
    Execution.updateStatus(executionId, 'running');
    this._emit('status', { status: 'running', message: 'Launching browser...' });

    try {
      // 1. Launch anti-detect browser
      const profileName = flow.profileName || `flow_${flow.id || 'temp'}`;
      const { page } = await this.browserManager.launch({ profileName });

      // 2. Initialize human behavior engine
      this.human = new HumanBehavior(page);
      await this.human.init();

      // 3. Execute each step
      for (let i = 0; i < flow.steps.length; i++) {
        if (this._cancelled) {
          logger.info('Flow execution cancelled by user');
          Execution.updateStatus(executionId, 'cancelled');
          this._emit('status', { status: 'cancelled', message: 'Cancelled by user' });
          break;
        }

        const step = flow.steps[i];
        const stepStart = Date.now();

        // Log step start
        Execution.addStep({
          execution_id: executionId,
          step_index: i,
          action: step.action,
          description: step.description || '',
        });
        Execution.updateProgress(executionId, i + 1);

        this._emit('step', {
          step: i + 1,
          total: flow.steps.length,
          action: step.action,
          description: step.description,
          status: 'running',
        });

        try {
          // Execute the step
          await this._executeStep(step, page, flow);

          // Take screenshot after step
          const screenshotPath = await this.browserManager.screenshot(
            `exec_${executionId}_step_${i}`
          );

          const duration = Date.now() - stepStart;
          Execution.updateStep(executionId, i, {
            status: 'completed',
            screenshot_path: screenshotPath,
            duration_ms: duration,
          });

          this._emit('step', {
            step: i + 1,
            total: flow.steps.length,
            action: step.action,
            description: step.description,
            status: 'completed',
            screenshot: screenshotPath,
            duration: formatDuration(duration),
          });

          logger.info(`Step ${i + 1}/${flow.steps.length} completed: ${step.description}`, {
            duration: formatDuration(duration),
          });

        } catch (stepError) {
          logger.warn(`Step ${i + 1} failed: ${stepError.message}`, {
            action: step.action,
          });

          // Try self-healing
          const fix = await this.selfHealer.heal(this.browserManager, step, stepError.message);
          
          if (fix) {
            logger.info(`Self-healer suggesting fix: ${fix.description}`);
            this._emit('step', {
              step: i + 1,
              total: flow.steps.length,
              status: 'healing',
              message: `Self-healing: ${fix.description}`,
            });

            try {
              await this._executeStep(fix, page, flow);
              
              const screenshotPath = await this.browserManager.screenshot(
                `exec_${executionId}_step_${i}_healed`
              );
              const duration = Date.now() - stepStart;

              Execution.updateStep(executionId, i, {
                status: 'completed',
                screenshot_path: screenshotPath,
                duration_ms: duration,
              });

              this._emit('step', {
                step: i + 1,
                total: flow.steps.length,
                status: 'healed',
                screenshot: screenshotPath,
                message: `Self-healed: ${fix.description}`,
              });

              continue;
            } catch (healError) {
              logger.error('Self-healing also failed', { error: healError.message });
            }
          }

          // Step failed permanently
          const screenshotPath = await this.browserManager.screenshot(
            `exec_${executionId}_step_${i}_failed`
          );

          Execution.updateStep(executionId, i, {
            status: 'failed',
            screenshot_path: screenshotPath,
            error_message: stepError.message,
            duration_ms: Date.now() - stepStart,
          });

          // Abort flow on critical failure
          throw new Error(`Step ${i + 1} failed: ${step.description} — ${stepError.message}`);
        }
      }

      // Flow completed!
      const totalDuration = Date.now() - startTime;
      if (!this._cancelled) {
        Execution.updateStatus(executionId, 'completed');
        this._emit('status', {
          status: 'completed',
          message: `Flow completed in ${formatDuration(totalDuration)}`,
          duration: formatDuration(totalDuration),
        });
        logger.info(`Flow "${flow.name}" completed`, { duration: formatDuration(totalDuration) });
      }

      return { status: 'completed', duration: totalDuration };

    } catch (err) {
      const totalDuration = Date.now() - startTime;
      Execution.updateStatus(executionId, 'failed', err.message);
      this._emit('status', {
        status: 'failed',
        message: err.message,
        duration: formatDuration(totalDuration),
      });
      logger.error(`Flow "${flow.name}" failed`, { error: err.message });
      return { status: 'failed', error: err.message, duration: totalDuration };

    } finally {
      // Always close browser
      await this.browserManager.close();
    }
  }

  /**
   * Cancel the running execution
   */
  cancel() {
    this._cancelled = true;
  }

  // ─── Step Executors ──────────────────────────────────

  /**
   * Execute a single step
   */
  async _executeStep(step, page, flow) {
    const params = step.params || {};

    switch (step.action) {
      case 'navigate':
        await this._stepNavigate(page, params);
        break;

      case 'click':
        await this._stepClick(page, params);
        break;

      case 'type':
        await this._stepType(page, params);
        break;

      case 'wait':
        await this._stepWait(page, params);
        break;

      case 'wait_for_element':
        await this._stepWaitForElement(page, params);
        break;

      case 'wait_for_navigation':
        await this._stepWaitForNavigation(page, params);
        break;

      case 'screenshot':
        // Already handled after each step
        break;

      case 'scroll':
        await this._stepScroll(page, params);
        break;

      case 'select':
        await this._stepSelect(page, params);
        break;

      case 'conditional_login':
        await this._stepConditionalLogin(page, params);
        break;

      case 'keyboard':
        await this._stepKeyboard(page, params);
        break;

      case 'extract_text':
        await this._stepExtractText(page, params);
        break;

      default:
        logger.warn(`Unknown action: ${step.action}`);
    }
  }

  async _stepNavigate(page, params) {
    logger.debug(`Navigating to: ${params.url}`);
    await page.goto(params.url, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    // Warm up behavior after navigation
    await sleep(randomInt(1000, 2500));
    if (this.human) await this.human.warmUp();
  }

  async _stepClick(page, params) {
    const selector = params.selector || params.text;
    logger.debug(`Clicking: ${selector}`);

    if (selector.startsWith('text=')) {
      // Text-based click
      const text = selector.replace('text=', '');
      const clicked = await this.human.clickText(text);
      if (!clicked) {
        // Fallback: try Puppeteer's text selector
        try {
          await page.click(`::-p-text(${text})`, { timeout: 10000 });
        } catch {
          throw new Error(`Could not find element with text: "${text}"`);
        }
      }
    } else {
      // CSS selector click
      await page.waitForSelector(selector, { timeout: 15000, visible: true });
      await this.human.click(selector);
    }
  }

  async _stepType(page, params) {
    const selector = params.selector;
    const text = this._resolveVariable(params.text || params.value);
    logger.debug(`Typing into: ${selector}`);

    await page.waitForSelector(selector, { timeout: 15000, visible: true });
    await this.human.type(selector, text, { clear: params.clear !== false });
  }

  async _stepWait(page, params) {
    const duration = params.duration || params.ms || 2000;
    logger.debug(`Waiting ${formatDuration(duration)}`);
    await sleep(duration);
  }

  async _stepWaitForElement(page, params) {
    const selector = params.selector;
    const timeout = params.timeout || 30000;
    logger.debug(`Waiting for element: ${selector}`);

    if (selector.startsWith('text=')) {
      const text = selector.replace('text=', '');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout },
        text
      );
    } else {
      await page.waitForSelector(selector, { timeout, visible: true });
    }
  }

  async _stepWaitForNavigation(page, params) {
    const timeout = params.timeout || 30000;
    logger.debug('Waiting for navigation...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout });
  }

  async _stepScroll(page, params) {
    const pixels = params.pixels || 300;
    const direction = params.direction || 'down';
    await this.human.scroll(pixels, direction);
  }

  async _stepSelect(page, params) {
    const selector = params.selector;
    const value = params.value;
    logger.debug(`Selecting "${value}" in ${selector}`);
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.select(selector, value);
  }

  async _stepConditionalLogin(page, params) {
    const credentialKey = params.credential_key;
    logger.debug(`Conditional login with credential: ${credentialKey}`);

    // Check if we're on a login page
    const url = page.url();
    const isLoginPage = url.includes('accounts.google.com') ||
                         url.includes('/signin') ||
                         url.includes('/login');

    if (!isLoginPage) {
      logger.debug('Not on login page, skipping login');
      return;
    }

    // Get credentials
    const cred = Credential.findByName(credentialKey, true);
    if (!cred) {
      throw new Error(`Credential "${credentialKey}" not found`);
    }

    // Google login flow
    if (url.includes('accounts.google.com')) {
      await this._googleLogin(page, cred);
    } else {
      // Generic login
      await this._genericLogin(page, cred);
    }
  }

  async _stepKeyboard(page, params) {
    const key = params.key || 'Enter';
    logger.debug(`Pressing key: ${key}`);
    await sleep(randomInt(200, 500));
    await page.keyboard.press(key);
    await sleep(randomInt(300, 700));
  }

  async _stepExtractText(page, params) {
    const selector = params.selector;
    logger.debug(`Extracting text from: ${selector}`);
    const text = await page.$eval(selector, el => el.textContent.trim());
    logger.info(`Extracted text: "${text}"`);
    return text;
  }

  // ─── Login Helpers ───────────────────────────────────

  async _googleLogin(page, credential) {
    logger.info('Performing Google login...');

    // Wait for email input
    try {
      await page.waitForSelector('input[type="email"]', { timeout: 10000, visible: true });
      await sleep(randomInt(500, 1500));

      // Enter email
      await this.human.type('input[type="email"]', credential.username);
      await sleep(randomInt(500, 1000));

      // Click Next
      await this.human.clickText('Next');
      await sleep(randomInt(2000, 4000));

      // Wait for password input
      await page.waitForSelector('input[type="password"]', { timeout: 15000, visible: true });
      await sleep(randomInt(500, 1500));

      // Enter password
      await this.human.type('input[type="password"]', credential.password);
      await sleep(randomInt(500, 1000));

      // Click Next
      await this.human.clickText('Next');

      // Wait for login to complete
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      await sleep(randomInt(2000, 4000));

      logger.info('Google login completed');
    } catch (err) {
      logger.error('Google login failed', { error: err.message });
      throw new Error(`Google login failed: ${err.message}`);
    }
  }

  async _genericLogin(page, credential) {
    logger.info('Performing generic login...');

    // Try common selectors
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[id="email"]',
      'input[id="username"]',
      '#email',
      '#username',
    ];

    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      '#password',
    ];

    // Find and fill email
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await this.human.type(sel, credential.username);
          break;
        }
      } catch {}
    }

    await sleep(randomInt(300, 800));

    // Find and fill password
    for (const sel of passwordSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await this.human.type(sel, credential.password);
          break;
        }
      } catch {}
    }

    await sleep(randomInt(300, 800));

    // Try to click submit button
    const submitClicked = await this.human.clickText('Sign in') ||
                           await this.human.clickText('Login') ||
                           await this.human.clickText('Log in') ||
                           await this.human.clickText('Submit');

    if (!submitClicked) {
      await page.keyboard.press('Enter');
    }

    await sleep(randomInt(2000, 4000));
  }

  // ─── Helpers ─────────────────────────────────────────

  _resolveVariable(text) {
    if (!text) return text;
    // Replace {{variable}} patterns with stored values
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      // Could be extended to support flow variables
      return match;
    });
  }

  _emit(event, data) {
    this.onProgress({ event, executionId: this.executionId, ...data });
  }
}

module.exports = FlowExecutor;
