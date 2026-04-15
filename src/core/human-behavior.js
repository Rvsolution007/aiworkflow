/**
 * AI Flow Builder — Human Behavior Engine v2
 * Simulates realistic human interactions to avoid bot detection.
 * Uses ghost-cursor for Bezier curve mouse movements.
 *
 * v2 enhancements:
 * - Typo simulation with backspace correction (non-critical fields only)
 * - Micro-jitter engine (constant subtle mouse movements)
 * - Focus/blur simulation (tab switching)
 * - Read time simulation based on page content
 * - Natural Gaussian delay distribution
 * - Random hover interactions
 */

const { createCursor } = require('ghost-cursor');
const { sleep, randomInt, randomFloat } = require('../utils/helpers');
const logger = require('../utils/logger');

// ─── Critical field patterns (NO typos in these) ───
const CRITICAL_FIELD_PATTERNS = [
  'password', 'passwd', 'pwd',
  'email', 'mail',
  'username', 'user',
  'login', 'signin',
  'otp', 'code', 'token',
  'phone', 'mobile',
  'captcha', 'verify',
  'card', 'cvv', 'expir',
  'account', 'routing',
  'ssn', 'pan', 'aadhaar',
];

class HumanBehavior {
  constructor(page) {
    this.page = page;
    this.cursor = null;
    this._initialized = false;
    this._jitterInterval = null;
    this._lastActivityTime = Date.now();
  }

  /**
   * Initialize the cursor on the page
   */
  async init() {
    if (this._initialized) return;
    try {
      this.cursor = createCursor(this.page, await this._getRandomStartPoint());
      this._initialized = true;
      logger.debug('Human behavior engine initialized (v2)');

      // Start micro-jitter engine
      this._startMicroJitter();
    } catch (err) {
      logger.warn('Could not initialize ghost-cursor, falling back to basic clicks', { error: err.message });
      this._initialized = false;
    }
  }

  /**
   * Stop all background behaviors (cleanup)
   */
  destroy() {
    this._stopMicroJitter();
  }

  /**
   * Move mouse to element and click with human-like behavior
   * @param {string} selector - CSS selector or element handle
   * @param {object} options - Click options
   */
  async click(selector, options = {}) {
    await this._preActionDelay();
    this._lastActivityTime = Date.now();

    if (this.cursor) {
      try {
        await this.cursor.click(selector, {
          hesitate: randomInt(50, 200),     // hesitate before clicking
          waitForClick: randomInt(30, 120),  // wait between mouse down and mouse up
          ...options,
        });
        await this._postActionDelay();
        return;
      } catch (err) {
        logger.debug(`ghost-cursor click failed for "${selector}", falling back`, { error: err.message });
      }
    }

    // Fallback: basic click with small delay
    await this.page.click(selector);
    await this._postActionDelay();
  }

  /**
   * Click on an element matching text content
   * @param {string} text - Visible text to find and click
   */
  async clickText(text) {
    await this._preActionDelay();
    this._lastActivityTime = Date.now();

    // Try multiple strategies to find element by text
    const strategies = [
      // XPath text match
      async () => {
        const [el] = await this.page.$x(`//*[contains(text(), "${text}")]`);
        return el;
      },
      // aria-label match
      async () => await this.page.$(`[aria-label*="${text}" i]`),
      // Button/link text
      async () => await this.page.$(`::-p-text(${text})`),
      // Value attribute
      async () => await this.page.$(`[value*="${text}" i]`),
    ];

    for (const strategy of strategies) {
      try {
        const element = await strategy();
        if (element) {
          if (this.cursor) {
            await this.cursor.click(element, {
              hesitate: randomInt(50, 200),
              waitForClick: randomInt(30, 120),
            });
          } else {
            await element.click();
          }
          await this._postActionDelay();
          return true;
        }
      } catch (err) {
        // Try next strategy
      }
    }

    logger.warn(`Could not find clickable element with text: "${text}"`);
    return false;
  }

  /**
   * Type text with realistic human-like speed
   * v2: Includes typo simulation for non-critical fields
   * @param {string} selector - Input selector
   * @param {string} text - Text to type
   * @param {object} options - Typing options
   */
  async type(selector, text, options = {}) {
    await this._preActionDelay();
    this._lastActivityTime = Date.now();

    // Click on the input first (human behavior)
    await this.click(selector);
    await sleep(randomInt(100, 300));

    // Clear existing content if needed
    if (options.clear !== false) {
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.value = '';
      }, selector);
      // Triple click to select all, then type
      await this.page.click(selector, { clickCount: 3 });
      await sleep(randomInt(50, 150));
    }

    // Check if this is a critical field (no typos allowed)
    const isCritical = this._isCriticalField(selector, text);

    // Type character by character with variable speed
    const baseWPM = options.wpm || randomInt(40, 70); // Words per minute
    const charDelay = 60000 / (baseWPM * 5); // Average delay per character

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // ─── Typo simulation (only for non-critical fields) ───
      if (!isCritical && Math.random() < 0.035) { // 3.5% typo rate
        await this._simulateTypo(char, charDelay);
        continue;
      }

      // Variable delay per character (some chars are typed faster)
      let delay = this._gaussianDelay(charDelay, charDelay * 0.35);

      // Longer pause after spaces and punctuation
      if (char === ' ') delay *= randomFloat(1.2, 1.8);
      if (['.', ',', '!', '?', '@'].includes(char)) delay *= randomFloat(1.3, 2.0);

      // Occasional longer pause (thinking moment)
      if (Math.random() < 0.03) delay += randomInt(300, 800);

      await this.page.keyboard.type(char, { delay: Math.max(20, delay) });
    }

    await this._postActionDelay();
  }

  /**
   * Scroll the page naturally
   * @param {number} pixels - Pixels to scroll
   * @param {string} direction - 'down' or 'up'
   */
  async scroll(pixels = 300, direction = 'down') {
    await this._preActionDelay();
    this._lastActivityTime = Date.now();

    const scrollAmount = direction === 'up' ? -pixels : pixels;
    const steps = randomInt(3, 8); // Break scroll into steps for natural feel
    const stepAmount = scrollAmount / steps;

    for (let i = 0; i < steps; i++) {
      await this.page.evaluate((amount) => {
        window.scrollBy({ top: amount, behavior: 'smooth' });
      }, stepAmount + randomInt(-20, 20));
      await sleep(randomInt(50, 150));
    }

    await this._postActionDelay(300);
  }

  /**
   * Move mouse to a random position (idle movement)
   */
  async idleMovement() {
    if (!this.cursor) return;

    try {
      const viewport = await this.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));

      const target = {
        x: randomInt(100, viewport.width - 100),
        y: randomInt(100, viewport.height - 100),
      };

      await this.cursor.moveTo(target);
    } catch (err) {
      // Idle movement is non-critical
    }
  }

  /**
   * Warm up the page — simulate natural browsing behavior before taking action
   * v2: Enhanced with more realistic patterns
   */
  async warmUp() {
    logger.debug('Warming up page (simulating natural browse)...');

    // Random idle mouse movements
    for (let i = 0; i < randomInt(2, 5); i++) {
      await this.idleMovement();
      await sleep(randomInt(200, 800));
    }

    // Small scroll to show "interest"
    await this.scroll(randomInt(100, 400), 'down');
    await sleep(randomInt(500, 2000));

    // Scroll back up sometimes
    if (Math.random() < 0.5) {
      await this.scroll(randomInt(50, 200), 'up');
      await sleep(randomInt(300, 1000));
    }

    // Random hover over elements (without clicking)
    await this._randomHover();
  }

  /**
   * Simulate natural reading time for a page
   * Based on average reading speed of 200-250 WPM
   */
  async simulateReadTime() {
    try {
      const wordCount = await this.page.evaluate(() => {
        const text = document.body.innerText;
        return text.split(/\s+/).length;
      });

      // Average reading speed 200-250 WPM
      const readingWPM = randomInt(180, 280);
      const readTimeMs = Math.min((wordCount / readingWPM) * 60000, 15000); // Max 15 seconds
      const actualWait = Math.max(readTimeMs, 2000); // Min 2 seconds

      logger.debug(`Simulating read time: ${Math.round(actualWait / 1000)}s for ${wordCount} words`);

      // During reading, do subtle mouse movements
      const readEnd = Date.now() + actualWait;
      while (Date.now() < readEnd) {
        await this.idleMovement();
        await sleep(randomInt(500, 2000));
      }
    } catch (err) {
      // Fallback: just wait a bit
      await sleep(randomInt(2000, 5000));
    }
  }

  /**
   * Simulate tab switching (focus/blur)
   * Google checks if the tab loses focus (real users do this)
   */
  async simulateTabSwitch() {
    try {
      logger.debug('Simulating tab switch (blur/focus)');

      // Dispatch blur event (user "switched tabs")
      await this.page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // "Away" for 2-8 seconds
      await sleep(randomInt(2000, 8000));

      // Come back
      await this.page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await sleep(randomInt(500, 1500));
    } catch (err) {
      logger.debug('Tab switch simulation failed (non-critical)');
    }
  }

  /**
   * Natural idle behavior between steps
   * Does random browsing-like activities
   */
  async naturalIdle(minMs = 3000, maxMs = 15000) {
    const idleTime = randomInt(minMs, maxMs);
    const endTime = Date.now() + idleTime;

    logger.debug(`Natural idle for ${Math.round(idleTime / 1000)}s`);

    while (Date.now() < endTime) {
      const action = Math.random();

      if (action < 0.4) {
        // Idle mouse movement
        await this.idleMovement();
      } else if (action < 0.6) {
        // Small scroll
        await this.scroll(randomInt(50, 150), Math.random() > 0.5 ? 'down' : 'up');
      } else if (action < 0.75) {
        // Hover over a random element
        await this._randomHover();
      } else {
        // Just wait (thinking pause)
        await sleep(randomInt(500, 2000));
      }

      await sleep(randomInt(300, 1500));
    }
  }

  // ─── Private Helpers ─────────────────────────────────

  /**
   * Check if a field is critical (no typos allowed)
   */
  _isCriticalField(selector, text) {
    const selectorLower = selector.toLowerCase();

    // Check selector-based patterns
    for (const pattern of CRITICAL_FIELD_PATTERNS) {
      if (selectorLower.includes(pattern)) return true;
    }

    // Check if text looks like an email or structured data
    if (text && (
      text.includes('@') ||       // email
      text.match(/^\d+$/) ||      // pure numbers
      text.includes('://') ||     // URL
      text.length < 5             // very short (probably code/OTP)
    )) {
      return true;
    }

    return false;
  }

  /**
   * Simulate a typo and backspace correction
   * Types a wrong character, pauses, then backspaces and types correct one
   */
  async _simulateTypo(correctChar, baseDelay) {
    // Pick a nearby key on QWERTY keyboard
    const nearbyKeys = {
      'a': ['s', 'q', 'w', 'z'],
      'b': ['v', 'n', 'g', 'h'],
      'c': ['x', 'v', 'd', 'f'],
      'd': ['s', 'f', 'e', 'r', 'c', 'x'],
      'e': ['w', 'r', 'd', 's'],
      'f': ['d', 'g', 'r', 't', 'v', 'c'],
      'g': ['f', 'h', 't', 'y', 'b', 'v'],
      'h': ['g', 'j', 'y', 'u', 'n', 'b'],
      'i': ['u', 'o', 'k', 'j'],
      'j': ['h', 'k', 'u', 'i', 'n', 'm'],
      'k': ['j', 'l', 'i', 'o', 'm'],
      'l': ['k', 'p', 'o'],
      'm': ['n', 'k', 'j'],
      'n': ['b', 'm', 'h', 'j'],
      'o': ['i', 'p', 'l', 'k'],
      'p': ['o', 'l'],
      'q': ['w', 'a'],
      'r': ['e', 't', 'd', 'f'],
      's': ['a', 'd', 'w', 'e', 'x', 'z'],
      't': ['r', 'y', 'f', 'g'],
      'u': ['y', 'i', 'h', 'j'],
      'v': ['c', 'b', 'f', 'g'],
      'w': ['q', 'e', 'a', 's'],
      'x': ['z', 'c', 's', 'd'],
      'y': ['t', 'u', 'g', 'h'],
      'z': ['a', 'x', 's'],
    };

    const lower = correctChar.toLowerCase();
    const nearby = nearbyKeys[lower];

    if (!nearby) {
      // No nearby key data — just type correctly
      await this.page.keyboard.type(correctChar, { delay: Math.max(20, baseDelay) });
      return;
    }

    // Type wrong character
    const wrongChar = nearby[randomInt(0, nearby.length - 1)];
    const isUpper = correctChar !== lower;
    const typoChar = isUpper ? wrongChar.toUpperCase() : wrongChar;

    await this.page.keyboard.type(typoChar, { delay: Math.max(20, baseDelay) });

    // Pause — "realize the mistake"
    await sleep(randomInt(100, 400));

    // Backspace
    await this.page.keyboard.press('Backspace');
    await sleep(randomInt(50, 200));

    // Type correct character
    await this.page.keyboard.type(correctChar, { delay: Math.max(20, baseDelay * 0.8) });
  }

  /**
   * Micro-jitter engine — constant subtle mouse movements
   * Real users never keep their mouse perfectly still
   */
  _startMicroJitter() {
    if (this._jitterInterval) return;

    this._jitterInterval = setInterval(async () => {
      if (!this.cursor) return;

      // Only jitter when idle (no recent action)
      const timeSinceActivity = Date.now() - this._lastActivityTime;
      if (timeSinceActivity < 2000) return; // Don't jitter during active use

      try {
        const viewport = await this.page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }));

        // Very small movement (3-12 pixels)
        const jitterX = randomInt(-12, 12);
        const jitterY = randomInt(-12, 12);

        // Get current position (approximate)
        const currentX = randomInt(200, viewport.width - 200);
        const currentY = randomInt(200, viewport.height - 200);

        await this.page.mouse.move(
          Math.max(10, Math.min(viewport.width - 10, currentX + jitterX)),
          Math.max(10, Math.min(viewport.height - 10, currentY + jitterY)),
          { steps: randomInt(2, 5) }
        );
      } catch (err) {
        // Non-critical
      }
    }, randomInt(3000, 8000));
  }

  /**
   * Stop micro-jitter
   */
  _stopMicroJitter() {
    if (this._jitterInterval) {
      clearInterval(this._jitterInterval);
      this._jitterInterval = null;
    }
  }

  /**
   * Randomly hover over elements on the page (without clicking)
   */
  async _randomHover() {
    if (!this.cursor) return;

    try {
      // Find some interactive elements
      const elements = await this.page.$$('a, button, [role="button"], [role="link"], img');
      if (elements.length === 0) return;

      // Pick a random element
      const el = elements[randomInt(0, Math.min(elements.length - 1, 10))];
      const box = await el.boundingBox();
      if (!box) return;

      // Move to it (hover)
      await this.cursor.moveTo({
        x: box.x + box.width / 2 + randomInt(-5, 5),
        y: box.y + box.height / 2 + randomInt(-5, 5),
      });

      // Hover for a moment
      await sleep(randomInt(200, 800));
    } catch (err) {
      // Non-critical
    }
  }

  /**
   * Gaussian (bell curve) delay instead of uniform random
   * More realistic — most delays are near the mean
   */
  _gaussianDelay(mean, stddev) {
    // Box-Muller transform
    let u1, u2;
    do {
      u1 = Math.random();
      u2 = Math.random();
    } while (u1 === 0);

    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(mean * 0.3, mean + normal * stddev); // Clamp to minimum
  }

  async _preActionDelay() {
    // Simulate human reaction time before each action (gaussian distribution)
    const delay = this._gaussianDelay(400, 150);
    await sleep(Math.max(150, Math.min(1200, delay)));
  }

  async _postActionDelay(baseMs = 500) {
    // Simulate observation time after action
    const delay = this._gaussianDelay(baseMs * 1.5, baseMs * 0.5);
    await sleep(Math.max(baseMs * 0.5, Math.min(baseMs * 3, delay)));
  }

  async _getRandomStartPoint() {
    const viewport = await this.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    return {
      x: randomInt(viewport.width * 0.2, viewport.width * 0.8),
      y: randomInt(viewport.height * 0.2, viewport.height * 0.8),
    };
  }
}

module.exports = HumanBehavior;
