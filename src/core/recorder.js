/**
 * AI Flow Builder — Flow Recorder (Remote Browser Mode)
 * Opens browser on server, streams screenshots to frontend,
 * and accepts remote mouse/keyboard input via WebSocket.
 * Produces structured flow steps that can be replayed.
 */

const BrowserManager = require('./browser-manager');
const SessionManager = require('./session-manager');
const logger = require('../utils/logger');
const { sleep, randomInt } = require('../utils/helpers');

// ─── Recording Script (injected into every page) ─────────────
const RECORDING_SCRIPT = `
(function() {
  if (window.__recorderInjected) return;
  window.__recorderInjected = true;

  // ─── CSS Selector Generator ─────────────────────
  function getCssSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';

    // Try ID first
    if (el.id) return '#' + CSS.escape(el.id);

    // Try unique attribute selectors
    for (const attr of ['data-testid', 'data-id', 'name', 'aria-label', 'placeholder', 'role']) {
      const val = el.getAttribute(attr);
      if (val) {
        const sel = el.tagName.toLowerCase() + '[' + attr + '="' + val.replace(/"/g, '\\\\\\"') + '"]';
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }

    // Try type for inputs
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const type = el.getAttribute('type') || 'text';
      const sel = el.tagName.toLowerCase() + '[type="' + type + '"]';
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    // Build path from parent
    let path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }
      path.unshift(selector);
      current = parent;
    }
    return path.join(' > ');
  }

  // ─── XPath Generator ────────────────────────────
  function getXPath(el) {
    if (!el) return '';
    if (el.id) return '//*[@id="' + el.id + '"]';

    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.tagName === current.tagName) index++;
        sibling = sibling.previousSibling;
      }
      parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
      current = current.parentNode;
    }
    return '/' + parts.join('/');
  }

  // ─── Get visible text ───────────────────────────
  function getElementText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim().substring(0, 150);
  }

  // ─── Is popup/overlay element? ──────────────────
  function isPopupElement(el) {
    const popupSelectors = [
      '.modal', '.popup', '.overlay', '.dialog', '.toast',
      '[class*="modal"]', '[class*="popup"]', '[class*="overlay"]',
      '[class*="dismiss"]', '[class*="close-button"]',
      '.cdk-overlay', '[class*="backdrop"]',
    ];
    let current = el;
    while (current && current !== document.body) {
      for (const sel of popupSelectors) {
        try { if (current.matches(sel)) return true; } catch(e) {}
      }
      // Check if it's a close/dismiss button
      const text = (current.textContent || '').trim().toLowerCase();
      const dismissTexts = ['close', 'dismiss', 'not now', 'skip', 'cancel', 'later', 'no thanks', 'got it', 'maybe later'];
      if (current.tagName === 'BUTTON' && dismissTexts.some(t => text === t)) return true;
      current = current.parentElement;
    }
    return false;
  }

  // ─── Click Capture ──────────────────────────────
  document.addEventListener('click', function(e) {
    const target = e.target;
    if (!target || target === document.body) return;

    // Skip if popup element
    if (isPopupElement(target)) {
      console.log('[RECORDER_POPUP_DISMISSED]');
      return;
    }

    try {
      window.__recordEvent(JSON.stringify({
        type: 'click',
        timestamp: Date.now(),
        x: e.clientX,
        y: e.clientY,
        selector: getCssSelector(target),
        xpath: getXPath(target),
        text: getElementText(target),
        tag: target.tagName,
        url: location.href,
      }));
    } catch(err) {
      console.log('[RECORDER_ERROR]', err.message);
    }
  }, true);

  // ─── Input/Change Capture ───────────────────────
  let inputDebounce = {};
  document.addEventListener('input', function(e) {
    const target = e.target;
    if (!target) return;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;
    if (isPopupElement(target)) return;

    // Debounce: wait 800ms after last keystroke
    const key = getCssSelector(target);
    clearTimeout(inputDebounce[key]);
    inputDebounce[key] = setTimeout(() => {
      try {
        window.__recordEvent(JSON.stringify({
          type: target.type === 'password' ? 'type_password' : 'type',
          timestamp: Date.now(),
          selector: getCssSelector(target),
          xpath: getXPath(target),
          value: target.type === 'password' ? '{{PASSWORD}}' : target.value,
          tag: target.tagName,
          inputType: target.type || 'text',
          url: location.href,
        }));
      } catch(err) {}
    }, 800);
  }, true);

  // ─── Select Change Capture ──────────────────────
  document.addEventListener('change', function(e) {
    const target = e.target;
    if (!target || target.tagName !== 'SELECT') return;
    if (isPopupElement(target)) return;

    try {
      window.__recordEvent(JSON.stringify({
        type: 'select',
        timestamp: Date.now(),
        selector: getCssSelector(target),
        xpath: getXPath(target),
        value: target.value,
        text: target.options[target.selectedIndex]?.text || '',
        url: location.href,
      }));
    } catch(err) {}
  }, true);

  // ─── Scroll Capture (debounced) ─────────────────
  let scrollTimer = null;
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const delta = window.scrollY - lastScrollY;
      if (Math.abs(delta) < 50) return; // Ignore tiny scrolls
      try {
        window.__recordEvent(JSON.stringify({
          type: 'scroll',
          timestamp: Date.now(),
          direction: delta > 0 ? 'down' : 'up',
          pixels: Math.abs(Math.round(delta)),
          url: location.href,
        }));
      } catch(err) {}
      lastScrollY = window.scrollY;
    }, 500);
  }, true);

  // ─── Keyboard Shortcut Capture ──────────────────
  document.addEventListener('keydown', function(e) {
    // Only capture Enter, Tab, Escape
    if (!['Enter', 'Tab', 'Escape'].includes(e.key)) return;
    if (isPopupElement(e.target)) return;

    try {
      window.__recordEvent(JSON.stringify({
        type: 'keyboard',
        timestamp: Date.now(),
        key: e.key,
        selector: getCssSelector(e.target),
        url: location.href,
      }));
    } catch(err) {}
  }, true);

  // Show recording indicator
  const indicator = document.createElement('div');
  indicator.id = '__recorder-indicator';
  indicator.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:rgba(239,68,68,0.9);color:white;padding:8px 16px;border-radius:20px;font-family:sans-serif;font-size:13px;font-weight:600;pointer-events:none;display:flex;align-items:center;gap:8px;box-shadow:0 4px 15px rgba(239,68,68,0.4);';
  indicator.innerHTML = '<span style="width:10px;height:10px;border-radius:50%;background:white;animation:recBlink 1s infinite"></span> REC';
  const style = document.createElement('style');
  style.textContent = '@keyframes recBlink{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(style);
  document.body.appendChild(indicator);

  console.log('[RECORDER] Recording script injected');
})();
`;

class Recorder {
  constructor() {
    this.browserManager = null;
    this.page = null;
    this.isRecording = false;
    this.recordedSteps = [];
    this.lastEventTime = null;
    this.onEvent = null; // WebSocket broadcast callback
    this.profileName = 'default';
    this.popupDismissInterval = null;
    this.screenStreamInterval = null;
    this.screenStreamFPS = 4; // frames per second for screen streaming
    this._isStreaming = false;
  }

  /**
   * Start a recording session
   * @param {object} options
   * @param {string} options.profileName — Browser profile for session persistence
   * @param {function} options.onEvent — Callback for live events (WebSocket broadcast)
   * @returns {object} { success, message }
   */
  async start(options = {}) {
    // If already recording, force cleanup the old session first
    if (this.isRecording) {
      logger.warn('Previous recording session still active — force cleaning up...');
      try {
        this._stopScreenStream();
        if (this.popupDismissInterval) {
          clearInterval(this.popupDismissInterval);
          this.popupDismissInterval = null;
        }
        if (this.browserManager) {
          await this.browserManager.close().catch(() => {});
        }
      } catch (e) {}
      this.browserManager = null;
      this.page = null;
      this.isRecording = false;
      this.recordedSteps = [];
      logger.info('Old recording session cleaned up');
    }

    this.profileName = options.profileName || 'default';
    this.onEvent = options.onEvent || (() => {});
    this.recordedSteps = [];
    this.lastEventTime = null;

    try {
      // Launch browser — headful on server (uses Xvfb), headful locally
      this.browserManager = new BrowserManager();
      const { page } = await this.browserManager.launch({
        profileName: this.profileName,
        headless: false, // HEADFUL — renders to Xvfb on server
      });
      this.page = page;

      // Load saved session cookies if available
      const hadSession = await SessionManager.loadCookies(this.profileName, this.page);
      if (hadSession) {
        logger.info('Loaded existing session cookies');
      }

      // Expose the recording event bridge
      await this.page.exposeFunction('__recordEvent', (eventJson) => {
        this._handleRecordedEvent(eventJson);
      });

      // Inject recording script on every page
      await this.page.evaluateOnNewDocument(RECORDING_SCRIPT);

      // Also inject into current page
      await this.page.evaluate(RECORDING_SCRIPT).catch(() => {});

      // Listen for navigation events
      this.page.on('framenavigated', (frame) => {
        if (frame === this.page.mainFrame()) {
          this._handleNavigation(frame.url());
        }
      });

      // Start popup auto-dismiss background watcher
      this._startPopupWatcher();

      // Navigate to start URL if provided
      const startUrl = options.startUrl || '';
      if (startUrl) {
        let url = startUrl;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        logger.info(`Navigating to start URL: ${url}`);
        try {
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          logger.info('Start URL loaded successfully');
        } catch (navErr) {
          logger.warn(`Start URL navigation issue: ${navErr.message}`);
          // Continue anyway — page might still be usable
        }
      }

      // Start screen streaming to frontend
      this._startScreenStream();

      this.isRecording = true;

      logger.info(`Recording started for profile: ${this.profileName}`);
      return { success: true, message: 'Recording started. Use the Remote Browser Viewer to interact.' };
    } catch (err) {
      logger.error('Failed to start recording', { error: err.message });
      return { success: false, message: `Failed to start: ${err.message}` };
    }
  }

  /**
   * Stop recording and return captured steps
   * @returns {object} { success, steps, stepCount }
   */
  async stop() {
    this.isRecording = false;

    // Stop screen streaming
    this._stopScreenStream();

    // Stop popup watcher
    if (this.popupDismissInterval) {
      clearInterval(this.popupDismissInterval);
      this.popupDismissInterval = null;
    }

    // Save session cookies before closing
    if (this.page && this.browserManager?.isAlive()) {
      try {
        await SessionManager.saveCookies(this.profileName, this.page);
      } catch (e) {
        logger.warn('Failed to save cookies on stop', { error: e.message });
      }
    }

    // Close browser
    if (this.browserManager) {
      try {
        await this.browserManager.close();
      } catch (e) {
        logger.warn('Browser close failed on stop', { error: e.message });
      }
      this.browserManager = null;
      this.page = null;
    }

    // Convert raw events to flow steps
    const steps = this._convertToFlowSteps();

    logger.info(`Recording stopped. Captured ${steps.length} steps.`);
    return { success: true, steps, stepCount: steps.length };
  }

  /**
   * Discard recording without saving
   */
  async discard() {
    // Stop everything
    this._stopScreenStream();
    
    if (this.popupDismissInterval) {
      clearInterval(this.popupDismissInterval);
      this.popupDismissInterval = null;
    }

    this.isRecording = false;
    this.recordedSteps = [];

    if (this.browserManager) {
      try {
        await this.browserManager.close();
      } catch (e) {
        logger.warn('Browser close failed on discard', { error: e.message });
      }
      this.browserManager = null;
      this.page = null;
    }

    logger.info('Recording discarded and state fully reset');
    return { success: true, message: 'Recording discarded' };
  }

  /**
   * Force reset everything (emergency cleanup)
   */
  async forceReset() {
    this._stopScreenStream();
    if (this.popupDismissInterval) {
      clearInterval(this.popupDismissInterval);
      this.popupDismissInterval = null;
    }
    this.isRecording = false;
    this.recordedSteps = [];
    this.lastEventTime = null;
    if (this.browserManager) {
      try { await this.browserManager.close(); } catch (e) {}
      this.browserManager = null;
      this.page = null;
    }
    logger.info('Recorder force reset complete');
    return { success: true, message: 'Recorder reset' };
  }

  /**
   * Get current recording status
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      stepCount: this.recordedSteps.length,
      profileName: this.profileName,
      steps: this._convertToFlowSteps(),
    };
  }

  // ─── Remote Input Handlers ─────────────────────

  /**
   * Handle remote click from frontend browser viewer
   */
  async handleRemoteClick(x, y) {
    if (!this.isRecording || !this.page || !this.browserManager?.isAlive()) return;
    try {
      // Get element info BEFORE clicking (for selector capture)
      let elementInfo = {};
      try {
        elementInfo = await this.page.evaluate((cx, cy) => {
          const el = document.elementFromPoint(cx, cy);
          if (!el) return {};

          function getCssSelector(el) {
            if (!el || el === document.body) return 'body';
            if (el.id) return '#' + CSS.escape(el.id);
            for (const attr of ['data-testid', 'name', 'aria-label', 'placeholder', 'role']) {
              const val = el.getAttribute(attr);
              if (val) {
                const sel = el.tagName.toLowerCase() + '[' + attr + '="' + val.replace(/"/g, '\\"') + '"]';
                if (document.querySelectorAll(sel).length === 1) return sel;
              }
            }
            let path = [];
            let current = el;
            while (current && current !== document.body) {
              let s = current.tagName.toLowerCase();
              if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
              const parent = current.parentElement;
              if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) s += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
              }
              path.unshift(s);
              current = current.parentElement;
            }
            return path.join(' > ');
          }

          return {
            selector: getCssSelector(el),
            tag: el.tagName,
            text: (el.textContent || '').trim().substring(0, 80),
            href: el.href || '',
          };
        }, x, y);
      } catch (e) {
        logger.debug('Could not get element info for click');
      }

      await this.page.mouse.click(x, y);

      // Server-side event capture — always record the click
      const clickEvent = {
        type: 'click',
        timestamp: Date.now(),
        x, y,
        selector: elementInfo.selector || `coords(${x},${y})`,
        tag: elementInfo.tag || 'unknown',
        text: elementInfo.text || '',
        url: this.page.url(),
        _serverCaptured: true,
      };
      this._handleRecordedEvent(JSON.stringify(clickEvent));

      logger.debug(`Remote click at (${x}, ${y}) → ${elementInfo.selector || 'unknown'}`);
    } catch (err) {
      logger.warn(`Remote click failed: ${err.message}`);
    }
  }

  /**
   * Handle remote typing from frontend
   */
  async handleRemoteType(text) {
    if (!this.isRecording || !this.page || !this.browserManager?.isAlive()) return;
    try {
      // Get the currently focused element selector
      let selector = 'body';
      try {
        selector = await this.page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return 'body';
          if (el.id) return '#' + CSS.escape(el.id);
          const name = el.getAttribute('name');
          if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
          const type = el.getAttribute('type');
          if (type) return el.tagName.toLowerCase() + '[type="' + type + '"]';
          return el.tagName.toLowerCase();
        });
      } catch (e) {}

      await this.page.keyboard.type(text, { delay: 30 });

      // Server-side capture
      const isPassword = selector.includes('password');
      const typeEvent = {
        type: isPassword ? 'type_password' : 'type',
        timestamp: Date.now(),
        selector,
        value: isPassword ? '{{PASSWORD}}' : text,
        tag: 'INPUT',
        url: this.page.url(),
        _serverCaptured: true,
      };
      this._handleRecordedEvent(JSON.stringify(typeEvent));

      logger.debug(`Remote type: "${text.substring(0, 20)}..." → ${selector}`);
    } catch (err) {
      logger.warn(`Remote type failed: ${err.message}`);
    }
  }

  /**
   * Handle remote key press from frontend
   */
  async handleRemoteKeyPress(key) {
    if (!this.isRecording || !this.page || !this.browserManager?.isAlive()) return;
    try {
      await this.page.keyboard.press(key);

      // Server-side capture
      const keyEvent = {
        type: 'keyboard',
        timestamp: Date.now(),
        key,
        url: this.page.url(),
        _serverCaptured: true,
      };
      this._handleRecordedEvent(JSON.stringify(keyEvent));

      logger.debug(`Remote key press: ${key}`);
    } catch (err) {
      logger.warn(`Remote key press failed: ${err.message}`);
    }
  }

  /**
   * Handle remote scroll from frontend
   */
  async handleRemoteScroll(deltaX, deltaY) {
    if (!this.isRecording || !this.page || !this.browserManager?.isAlive()) return;
    try {
      await this.page.mouse.wheel({ deltaX, deltaY });

      // Server-side capture (only for significant scrolls)
      if (Math.abs(deltaY) > 50) {
        const scrollEvent = {
          type: 'scroll',
          timestamp: Date.now(),
          direction: deltaY > 0 ? 'down' : 'up',
          pixels: Math.abs(Math.round(deltaY)),
          url: this.page.url(),
          _serverCaptured: true,
        };
        this._handleRecordedEvent(JSON.stringify(scrollEvent));
      }

      logger.debug(`Remote scroll: (${deltaX}, ${deltaY})`);
    } catch (err) {
      logger.warn(`Remote scroll failed: ${err.message}`);
    }
  }

  /**
   * Handle remote URL navigation from frontend
   */
  async handleRemoteNavigate(url) {
    if (!this.page || !this.browserManager?.isAlive()) {
      logger.warn('Cannot navigate — no active page/browser');
      return;
    }
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      // Dedup: prevent double navigate (WebSocket + REST API both fire)
      if (this._lastNavigateUrl === url && Date.now() - (this._lastNavigateTime || 0) < 3000) {
        logger.debug(`Skipping duplicate navigate to: ${url}`);
        return;
      }
      this._lastNavigateUrl = url;
      this._lastNavigateTime = Date.now();

      logger.info(`Remote navigate → ${url}`);

      // PRIMARY: Use window.location.href (most reliable, works on all pages)
      try {
        await this.page.evaluate((targetUrl) => {
          window.location.href = targetUrl;
        }, url);
        logger.info(`Navigation triggered via window.location: ${url}`);
      } catch (e1) {
        logger.warn(`window.location failed (${e1.message}), trying page.goto...`);
        // FALLBACK: Use page.goto
        try {
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
          logger.info(`Navigation via page.goto succeeded: ${url}`);
        } catch (e2) {
          logger.warn(`page.goto also failed: ${e2.message}`);
        }
      }

      // Wait a moment for navigation to begin, then re-inject recording script
      setTimeout(() => {
        if (this.page) {
          this.page.evaluate(RECORDING_SCRIPT).catch(() => {});
        }
      }, 3000);
    } catch (err) {
      logger.error(`Remote navigate failed completely: ${err.message}`);
    }
  }

  /**
   * Handle remote mouse move from frontend (for hover effects)
   */
  async handleRemoteMouseMove(x, y) {
    if (!this.isRecording || !this.page || !this.browserManager?.isAlive()) return;
    try {
      await this.page.mouse.move(x, y);
    } catch (err) {
      // Ignore — mouse move errors are non-critical
    }
  }

  // ─── Screen Streaming ──────────────────────────

  /**
   * Start streaming browser screenshots to frontend via WebSocket
   */
  _startScreenStream() {
    if (this._isStreaming) return;
    this._isStreaming = true;

    const interval = Math.round(1000 / this.screenStreamFPS);

    this.screenStreamInterval = setInterval(async () => {
      if (!this.isRecording || !this.page || !this.browserManager?.isAlive()) return;

      try {
        // Capture screenshot as base64 JPEG (smaller than PNG)
        const screenshot = await this.page.screenshot({
          encoding: 'base64',
          type: 'jpeg',
          quality: 70, // Good quality for clear viewing
          fullPage: false,
        });

        // Get current URL for the address bar
        let currentUrl = '';
        try {
          currentUrl = await this.page.url();
        } catch (e) {}

        // Broadcast frame to frontend
        if (this.onEvent) {
          this.onEvent({
            type: 'screen_frame',
            frame: screenshot,
            url: currentUrl,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        // Page might be navigating, skip this frame
      }
    }, interval);

    logger.info(`Screen streaming started at ${this.screenStreamFPS} FPS`);
  }

  /**
   * Stop screen streaming
   */
  _stopScreenStream() {
    if (this.screenStreamInterval) {
      clearInterval(this.screenStreamInterval);
      this.screenStreamInterval = null;
    }
    this._isStreaming = false;
    logger.info('Screen streaming stopped');
  }

  // ─── Private Methods ────────────────────────────

  /**
   * Handle a recorded event from the injected script
   */
  _handleRecordedEvent(eventJson) {
    try {
      const event = JSON.parse(eventJson);

      // Dedup: if this is a browser-side event and we already have a matching server-side event, skip
      if (!event._serverCaptured) {
        const lastStep = this.recordedSteps[this.recordedSteps.length - 1];
        if (lastStep && lastStep._serverCaptured && lastStep.type === event.type) {
          const timeDiff = Math.abs(event.timestamp - lastStep.timestamp);
          if (timeDiff < 1500) {
            logger.debug(`Skipping duplicate browser-side event: ${event.type} (server already captured)`);
            return;
          }
        }
      }

      // Calculate wait time since last event
      if (this.lastEventTime) {
        const waitMs = event.timestamp - this.lastEventTime;
        if (waitMs > 2000) {
          this.recordedSteps.push({
            type: 'wait',
            timestamp: this.lastEventTime,
            duration: Math.min(waitMs, 30000),
          });
        }
      }
      this.lastEventTime = event.timestamp;

      // Don't record duplicate clicks on same element within 1s
      const lastStep = this.recordedSteps[this.recordedSteps.length - 1];
      if (lastStep && lastStep.type === 'click' && event.type === 'click') {
        if (lastStep.selector === event.selector && (event.timestamp - lastStep.timestamp) < 1000) {
          return;
        }
      }

      // Don't record type events followed by keyboard Enter (already included)
      if (event.type === 'keyboard' && event.key === 'Enter' && lastStep?.type === 'type') {
        // Merge: the type step already captured the value
      }

      this.recordedSteps.push(event);

      // Broadcast to frontend for live preview
      const step = this._eventToFlowStep(event);
      if (step && this.onEvent) {
        this.onEvent({
          type: 'recorder_event',
          step,
          stepIndex: this.recordedSteps.length,
        });
      }

      logger.debug(`Recorded: ${event.type} — ${event.selector || event.key || event.url || ''}`);
    } catch (err) {
      logger.warn('Failed to process recorded event', { error: err.message });
    }
  }

  /**
   * Handle page navigation
   */
  _handleNavigation(url) {
    if (!this.isRecording) return;
    if (!url || url === 'about:blank') return;

    // Don't duplicate if last step was same URL
    const lastStep = this.recordedSteps[this.recordedSteps.length - 1];
    if (lastStep && lastStep.type === 'navigate' && lastStep.url === url) return;

    const now = Date.now();
    if (this.lastEventTime) {
      const waitMs = now - this.lastEventTime;
      if (waitMs > 2000) {
        this.recordedSteps.push({ type: 'wait', timestamp: this.lastEventTime, duration: Math.min(waitMs, 30000) });
      }
    }
    this.lastEventTime = now;

    this.recordedSteps.push({
      type: 'navigate',
      timestamp: now,
      url,
    });

    // Re-inject recording script (page.evaluateOnNewDocument handles future pages,
    // but for the current navigation we need to re-inject)
    if (this.page) {
      setTimeout(async () => {
        try {
          await this.page.evaluate(RECORDING_SCRIPT);
        } catch (e) {
          // Page might not be ready yet, that's OK
        }
      }, 1500);
    }

    if (this.onEvent) {
      this.onEvent({
        type: 'recorder_event',
        step: { action: 'navigate', description: `Navigate to ${url}`, params: { url } },
        stepIndex: this.recordedSteps.length,
      });
    }

    logger.debug(`Recorded navigation: ${url}`);
  }

  /**
   * Background popup watcher — dismisses popups without recording them
   */
  _startPopupWatcher() {
    this.popupDismissInterval = setInterval(async () => {
      if (!this.isRecording || !this.page || !this.browserManager?.isAlive()) return;

      try {
        await this.page.evaluate(() => {
          const closeSelectors = [
            'button[aria-label="Close"]', 'button[aria-label="Dismiss"]',
            '.modal-close', '.popup-close', '[class*="close-button"]',
            'button.close', '[class*="dismiss"]',
          ];
          for (const sel of closeSelectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
              el.click();
              return;
            }
          }
          // Check for dismiss text buttons
          const btns = document.querySelectorAll('button, a[role="button"]');
          const dismissTexts = ['not now', 'skip', 'dismiss', 'later', 'no thanks', 'got it', 'maybe later'];
          for (const btn of btns) {
            const text = btn.textContent.trim().toLowerCase();
            if (dismissTexts.some(t => text === t) && btn.offsetParent !== null) {
              btn.click();
              return;
            }
          }
        });
      } catch (e) {
        // Page might be navigating
      }
    }, 3000);
  }

  /**
   * Convert raw recorded events into structured flow steps
   */
  _convertToFlowSteps() {
    const steps = [];

    for (const event of this.recordedSteps) {
      const step = this._eventToFlowStep(event);
      if (step) steps.push(step);
    }

    return steps;
  }

  /**
   * Convert a single raw event to a flow step
   */
  _eventToFlowStep(event) {
    switch (event.type) {
      case 'navigate':
        return {
          action: 'navigate',
          description: `Navigate to ${new URL(event.url).hostname}`,
          params: { url: event.url },
        };

      case 'click':
        return {
          action: 'click',
          description: `Click "${event.text || event.selector}"`,
          params: {
            selector: event.text ? `text=${event.text}` : event.selector,
            xpath: event.xpath,
            coordinates: { x: event.x, y: event.y },
          },
        };

      case 'type':
        return {
          action: 'type',
          description: `Type "${event.value?.substring(0, 40) || ''}" into ${event.selector}`,
          params: {
            selector: event.selector,
            text: event.value,
            clear: true,
          },
        };

      case 'type_password':
        return {
          action: 'type',
          description: `Type password into ${event.selector}`,
          params: {
            selector: event.selector,
            text: event.value, // Will be {{PASSWORD}} placeholder
            clear: true,
            isPassword: true,
          },
        };

      case 'select':
        return {
          action: 'select',
          description: `Select "${event.text}" in ${event.selector}`,
          params: {
            selector: event.selector,
            value: event.value,
          },
        };

      case 'scroll':
        return {
          action: 'scroll',
          description: `Scroll ${event.direction} ${event.pixels}px`,
          params: {
            direction: event.direction,
            pixels: event.pixels,
          },
        };

      case 'keyboard':
        return {
          action: 'keyboard',
          description: `Press ${event.key}`,
          params: { key: event.key },
        };

      case 'wait':
        return {
          action: 'wait',
          description: `Wait ${(event.duration / 1000).toFixed(1)}s`,
          params: { duration: event.duration },
        };

      default:
        return null;
    }
  }
}

// Singleton instance
module.exports = new Recorder();
