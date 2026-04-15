/**
 * AI Flow Builder — Flow Executor
 * The heart of the system. Executes automation flows step by step.
 * Features: anti-detect browsing, self-healing, live progress reporting.
 * 
 * v2 — Enhanced with session warm-up, natural idle breaks, tab switching.
 */

const BrowserManager = require('./browser-manager');
const HumanBehavior = require('./human-behavior');
const SelfHealer = require('./self-healer');
const sessionWarmer = require('./session-warmer');
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
      // 1. Launch anti-detect browser (headless on server)
      const profileName = flow.profileName || `flow_${flow.id || 'temp'}`;
      const { page } = await this.browserManager.launch({ profileName, headless: true });

      // 1.5. Load saved session cookies (enables login-free replays)
      const SessionManager = require('./session-manager');
      const hadSession = await SessionManager.loadCookies(profileName, page);
      if (hadSession) {
        logger.info(`Loaded saved session cookies for profile: ${profileName}`);
      }

      // 2. Initialize human behavior engine
      this.human = new HumanBehavior(page);
      await this.human.init();

      // NOTE: Warm-up moved to AFTER successful flow completion (background)

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

        // ─── Natural idle break between steps (v2 anti-detection) ───
        // Real humans don't execute steps back-to-back like a machine
        if (i > 0 && Math.random() < 0.35) {
          // 35% chance of a natural break between steps
          const breakDuration = randomInt(3000, 12000);
          logger.debug(`Natural break between steps: ${Math.round(breakDuration / 1000)}s`);
          this._emit('step', {
            step: i + 1,
            total: flow.steps.length,
            status: 'idle',
            message: 'Natural browsing pause...',
          });
          await this.human.naturalIdle(2000, breakDuration);
        }

        // Random tab switch simulation (10% chance between steps)
        if (i > 0 && Math.random() < 0.10) {
          await this.human.simulateTabSwitch();
        }

        try {
          // Check browser is still alive
          if (!this.browserManager.isAlive()) {
            throw new Error('Browser crashed — session lost. Please retry the flow.');
          }

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
        // Save final session cookies before closing
        try {
          await SessionManager.saveCookies(profileName, page);
        } catch (e) {}

        Execution.updateStatus(executionId, 'completed');
        this._emit('status', {
          status: 'completed',
          message: `Flow completed in ${formatDuration(totalDuration)}`,
          duration: formatDuration(totalDuration),
        });
        logger.info(`Flow "${flow.name}" completed`, { duration: formatDuration(totalDuration) });

        // Background warm-up AFTER successful completion (fire-and-forget)
        // Runs in a separate browser session so it doesn't block anything
        if (flow.warmUpEnabled !== false && sessionWarmer.needsWarmup()) {
          logger.info(`[WARMER] Scheduling background warm-up after successful flow "${flow.name}"`);
          setImmediate(async () => {
            try {
              const warmBrowser = new BrowserManager();
              await sessionWarmer.warmUpDuringBreak(warmBrowser, profileName);
              logger.info('[WARMER] Background post-flow warm-up completed');
            } catch (err) {
              logger.warn(`[WARMER] Background warm-up failed (non-fatal): ${err.message}`);
            }
          });
        }
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
      // Cleanup human behavior engine
      if (this.human) {
        this.human.destroy();
        this.human = null;
      }
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

    // After any step, check if we landed on a processing/redirect page
    // (click steps can trigger payment popups that redirect through liftoff)
    if (step.action === 'click' || step.action === 'navigate') {
      await this._handleProcessingPage(page);
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

    // Handle Google redirects (account chooser, already logged in, etc.)
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      const hasAccountList = await page.evaluate(() => {
        const accountItems = document.querySelectorAll(
          '[data-identifier], [data-email], .JDAKTe, ul li[role="link"]'
        );
        const chooseText = document.body.innerText.toLowerCase();
        return accountItems.length > 0 || chooseText.includes('choose an account');
      }).catch(() => false);

      if (hasAccountList) {
        logger.info('Google redirected to account chooser, picking account...');
        await this._handleAccountChooser(page);
      } else {
        logger.debug('On Google sign-in page — conditional_login step will handle');
      }
    }

    // Dismiss any popup overlays
    await this._dismissOverlayPopups(page);

    // Handle Google Payments processing/redirect pages (liftoff, etc.)
    await this._handleProcessingPage(page);

    // Save cookies after each navigate step (incremental session persistence)
    try {
      const SessionManager = require('./session-manager');
      const profileName = this.browserManager?.profileName || 'default';
      await SessionManager.saveCookies(profileName, page);
    } catch (e) {}

    if (this.human) await this.human.warmUp();
  }

  /**
   * Handle Google Payments processing/redirect pages (liftoff, etc.)
   * These pages show a loading spinner and auto-redirect. If stuck, we refresh.
   */
  async _handleProcessingPage(page) {
    try {
      const currentUrl = page.url();
      const isProcessingPage = currentUrl.includes('/liftoff') ||
                                (currentUrl.includes('payments.google.com') && 
                                 (currentUrl.includes('/gp/') || currentUrl.includes('/processing')));

      if (!isProcessingPage) return;

      logger.info(`🔄 Payment processing page detected: ${currentUrl} — waiting for redirect...`);
      this._emit('step', { status: 'running', message: '💳 Payment page processing — waiting for redirect...' });

      const maxWaitMs = 90000; // 90 seconds max
      const refreshAfterMs = 30000; // Refresh if stuck after 30s
      const pollIntervalMs = 3000; // Check every 3 seconds
      const startTime = Date.now();
      let hasRefreshed = false;

      while (Date.now() - startTime < maxWaitMs) {
        await sleep(pollIntervalMs);

        const newUrl = page.url();
        // Check if URL changed (redirect happened)
        if (newUrl !== currentUrl && newUrl !== 'about:blank') {
          logger.info(`✅ Processing page redirected to: ${newUrl}`);
          await sleep(2000); // Wait for new page to settle
          return;
        }

        // Check if page has actual content now (not just spinner)
        const hasContent = await page.evaluate(() => {
          const body = document.body;
          if (!body) return false;
          // Check if there are interactive elements (buttons, forms)
          const buttons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
          return buttons.length > 2; // More than just loading UI
        }).catch(() => false);

        if (hasContent) {
          logger.info('✅ Processing page loaded with interactive content');
          return;
        }

        const elapsed = Date.now() - startTime;

        // Auto-refresh if stuck for 30s
        if (elapsed > refreshAfterMs && !hasRefreshed) {
          hasRefreshed = true;
          logger.info(`🔄 Processing page stuck for ${Math.round(elapsed / 1000)}s — refreshing...`);
          this._emit('step', { status: 'running', message: '🔄 Payment page stuck — refreshing...' });
          try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
            await sleep(3000);
          } catch (e) {
            logger.warn(`Processing page refresh failed: ${e.message}`);
          }
        }
      }

      logger.warn('⚠️ Processing page did not redirect within 90s — continuing anyway');
    } catch (err) {
      logger.debug(`Processing page handler error (non-fatal): ${err.message}`);
    }
  }

  /**
   * Handle Google "Choose an account" page ONLY
   * Does NOT do full login — that's handled by conditional_login step
   */
  async _handleAccountChooser(page) {
    try {
      await sleep(2000);

      // Try to click the first signed-in account
      const clicked = await page.evaluate(() => {
        // Google account chooser: look for account list items
        const accountItems = document.querySelectorAll(
          '[data-identifier], [data-email], li[role="link"], div[role="link"], .JDAKTe'
        );
        
        if (accountItems.length > 0) {
          accountItems[0].click();
          return true;
        }

        // Fallback: click any element that looks like an email
        const allElements = document.querySelectorAll('div, span, li');
        for (const el of allElements) {
          const text = el.textContent.trim();
          if (text.includes('@') && text.includes('.com') && el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        logger.info('Clicked on account in chooser');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await sleep(randomInt(2000, 4000));
        
        // After selecting account, might need to handle post-login screens
        await this._handlePostLoginScreens(page);
      } else {
        logger.warn('Could not find account to click in chooser — login step will handle');
      }
    } catch (err) {
      logger.warn('Account chooser handling failed (non-fatal)', { error: err.message });
    }
  }

  async _stepClick(page, params) {
    const selector = params.selector || params.text;
    logger.debug(`Clicking: ${selector}`);

    // First, try to dismiss any overlay popups that might be blocking
    await this._dismissOverlayPopups(page);

    if (selector.startsWith('text=')) {
      // Text-based click
      const text = selector.replace('text=', '');
      let clicked = await this.human.clickText(text);
      
      if (!clicked) {
        // Fallback: try Puppeteer's text selector
        try {
          await page.click(`::-p-text(${text})`, { timeout: 10000 });
          clicked = true;
        } catch {
          // If click failed, maybe a popup is blocking — dismiss and retry
          logger.info(`Click failed for "${text}", attempting popup dismiss + retry...`);
          const dismissed = await this._dismissOverlayPopups(page, true);
          if (dismissed) {
            await sleep(randomInt(1000, 2000));
            clicked = await this.human.clickText(text);
            if (!clicked) {
              try {
                await page.click(`::-p-text(${text})`, { timeout: 5000 });
                clicked = true;
              } catch {}
            }
          }
          if (!clicked) {
            throw new Error(`Could not find element with text: "${text}"`);
          }
        }
      }
    } else {
      // CSS selector click
      await page.waitForSelector(selector, { timeout: 15000, visible: true });
      await this.human.click(selector);
    }
  }

  /**
   * Dismiss any overlay popups, modals, or welcome screens
   * that might be blocking clicks on the actual page content.
   */
  async _dismissOverlayPopups(page, force = false) {
    try {
      const dismissed = await page.evaluate((forceCheck) => {
        // Try to find and close common popup patterns
        const closeSelectors = [
          // Close buttons (X icons)
          'button[aria-label="Close"]',
          'button[aria-label="Dismiss"]',
          '.modal-close',
          '.popup-close',
          '[class*="close-button"]',
          '[class*="dismiss"]',
          'button.close',
          'mat-dialog-container button[mat-icon-button]',
          // Material Design close icons
          'button mat-icon',
        ];

        for (const sel of closeSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            el.click();
            return 'close-button';
          }
        }

        // Check for overlay/backdrop and try to click it to dismiss
        const overlays = document.querySelectorAll(
          '.cdk-overlay-backdrop, .modal-backdrop, [class*="overlay"], [class*="backdrop"]'
        );
        for (const overlay of overlays) {
          if (overlay.offsetParent !== null || overlay.style.display !== 'none') {
            overlay.click();
            return 'overlay-click';
          }
        }

        // Check for "Get set up" or similar welcome popups and try dismiss
        const allButtons = document.querySelectorAll('button, a[role="button"]');
        const dismissTexts = ['not now', 'skip', 'dismiss', 'close', 'cancel', 'no thanks', 'later', 'maybe later'];
        for (const btn of allButtons) {
          const btnText = btn.textContent.trim().toLowerCase();
          if (dismissTexts.some(t => btnText.includes(t)) && btn.offsetParent !== null) {
            btn.click();
            return `dismiss-${btnText}`;
          }
        }

        return null;
      }, force);

      if (dismissed) {
        logger.info(`Dismissed overlay popup via: ${dismissed}`);
        await sleep(1000);
        return true;
      }

      // Also try Escape key to close modals
      if (force) {
        await page.keyboard.press('Escape');
        await sleep(500);
        // Check if something closed
        return true;
      }
    } catch (e) {
      logger.debug('Overlay dismiss check failed (non-critical)');
    }
    return false;
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

    // Check if we're on a login page or recovery/verification page
    const url = page.url();
    const isLoginPage = url.includes('accounts.google.com') ||
                         url.includes('/signin') ||
                         url.includes('/login');
    
    // Also check if we're on a post-login verification page
    const isVerificationPage = url.includes('myaccount.google.com') ||
                                url.includes('gds.google.com') ||
                                url.includes('/challenge/');

    if (!isLoginPage && !isVerificationPage) {
      logger.debug('Not on login page, skipping login');
      return;
    }

    // If we're on a verification page (already logged in), just dismiss
    if (isVerificationPage && !isLoginPage) {
      logger.info('On verification/recovery page, attempting to dismiss...');
      await this._handlePostLoginScreens(page);
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

    try {
      // Detect which page we're on: email, password, or account chooser
      await sleep(2000);

      // Check if password field is already visible (Google remembers email from session)
      const hasPassword = await page.$('input[type="password"]').then(el => !!el).catch(() => false);
      const hasEmail = await page.$('input[type="email"]').then(el => !!el).catch(() => false);
      const hasAccountList = await page.evaluate(() => {
        return document.body.innerText.toLowerCase().includes('choose an account');
      }).catch(() => false);

      logger.info(`Login page state: email=${hasEmail}, password=${hasPassword}, accountList=${hasAccountList}`);

      // Case 1: "Choose an account" page — pick the account first
      if (hasAccountList) {
        logger.info('Account chooser detected, selecting account...');
        await this._handleAccountChooser(page);
        await sleep(3000);
        // After picking account, re-check the page state
        return await this._googleLogin(page, credential);
      }

      // Case 2: Email input visible — full login flow
      if (hasEmail) {
        logger.info('Email page detected, entering email...');
        await this.human.type('input[type="email"]', credential.username);
        await sleep(randomInt(500, 1000));

        // Click Next
        await this.human.clickText('Next');
        await sleep(randomInt(3000, 5000));

        // Wait for password input to appear
        await page.waitForSelector('input[type="password"]', { timeout: 15000, visible: true });
        await sleep(randomInt(500, 1500));
      }

      // Case 3: Password field visible (either from Case 2 or Google remembered email)
      const passwordVisible = await page.$('input[type="password"]').then(el => !!el).catch(() => false);
      if (passwordVisible) {
        logger.info('Password page detected, entering password...');
        await page.waitForSelector('input[type="password"]', { timeout: 10000, visible: true });
        await sleep(randomInt(500, 1000));

        await this.human.type('input[type="password"]', credential.password);
        await sleep(randomInt(500, 1000));

        // Click Next / Sign in
        await this.human.clickText('Next');
        
        // Wait for login to complete
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await sleep(randomInt(2000, 4000));
      }

      // Handle post-login screens (recovery, 2FA, verification prompts)
      await this._handlePostLoginScreens(page);

      // Save session cookies for future login-free replays
      try {
        const SessionManager = require('./session-manager');
        await SessionManager.saveCookies('google_admin', page);
        logger.info('Session cookies saved after login');
      } catch (e) {
        logger.debug('Could not save session cookies (non-critical)');
      }

      logger.info('Google login completed');
    } catch (err) {
      logger.error('Google login failed', { error: err.message });
      throw new Error(`Google login failed: ${err.message}`);
    }
  }

  /**
   * Handle Google post-login screens (recovery prompts, 2FA, etc.)
   * These appear after fresh logins and block navigation to the target page.
   */
  async _handlePostLoginScreens(page) {
    const maxAttempts = 6; // Try for up to 30 seconds (6 * 5s)
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const url = page.url();
      logger.debug(`Post-login screen check #${attempt + 1}, URL: ${url}`);

      // If we've reached the target page (admin console, etc.), we're done
      if (url.includes('admin.google.com') && !url.includes('accounts.google.com')) {
        logger.info('Reached admin console, post-login screens complete');
        return;
      }

      // Check for known post-login prompts and dismiss them
      const dismissed = await this._tryDismissPrompt(page);
      
      if (dismissed) {
        logger.info('Dismissed a post-login prompt');
        await sleep(randomInt(2000, 4000));
        // Wait for any navigation
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
        await sleep(1000);
        continue;
      }

      // No known prompt found — wait a bit and check again
      await sleep(3000);
    }

    logger.info('Post-login screen handling complete (max attempts reached)');
  }

  /**
   * Try to dismiss known Google post-login prompts
   * Returns true if a prompt was dismissed
   */
  async _tryDismissPrompt(page) {
    // List of buttons/links to dismiss post-login screens
    // Order matters: try most specific first
    const dismissTexts = [
      'Done',           // "Make sure you can always sign in" → Done button
      'Cancel',         // Recovery prompt → Cancel
      'Not now',        // 2FA prompt → Not now
      'Skip',           // Various prompts → Skip
      'No thanks',      // Recovery email prompt
      'Confirm',        // Confirm identity
      'Continue',       // Continue to app
      'I understand',   // Policy prompts
      'Remind me later', // Security check
      'Turn off',       // Turn off less secure apps
      'Got it',         // Information screens
    ];

    for (const text of dismissTexts) {
      try {
        // Check if the text exists on the page
        const found = await page.evaluate((t) => {
          const elements = document.querySelectorAll('button, a, span[role="button"], div[role="button"]');
          for (const el of elements) {
            if (el.textContent.trim().toLowerCase().includes(t.toLowerCase()) && el.offsetParent !== null) {
              return true;
            }
          }
          return false;
        }, text);

        if (found) {
          logger.info(`Found dismissable prompt button: "${text}"`);
          
          // Try clicking via human behavior first
          const clicked = await this.human.clickText(text);
          if (!clicked) {
            // Fallback: puppeteer text selector
            try {
              await page.click(`::-p-text(${text})`, { timeout: 3000 });
            } catch {
              continue;
            }
          }
          return true;
        }
      } catch (e) {
        // Ignore and try next
      }
    }

    // Also check for "Add recovery phone" or similar pages — try pressing Escape
    try {
      const isRecoveryPage = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('recovery') || text.includes('verify') || text.includes('protect your account');
      });

      if (isRecoveryPage) {
        logger.info('On recovery/verify page, trying Escape key');
        await page.keyboard.press('Escape');
        await sleep(1000);
        return true;
      }
    } catch (e) {}

    return false;
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
