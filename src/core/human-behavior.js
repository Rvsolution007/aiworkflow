/**
 * AI Flow Builder — Human Behavior Engine
 * Simulates realistic human interactions to avoid bot detection.
 * Uses ghost-cursor for Bezier curve mouse movements.
 */

const { createCursor } = require('ghost-cursor');
const { sleep, randomInt, randomFloat } = require('../utils/helpers');
const logger = require('../utils/logger');

class HumanBehavior {
  constructor(page) {
    this.page = page;
    this.cursor = null;
    this._initialized = false;
  }

  /**
   * Initialize the cursor on the page
   */
  async init() {
    if (this._initialized) return;
    try {
      this.cursor = createCursor(this.page, await this._getRandomStartPoint());
      this._initialized = true;
      logger.debug('Human behavior engine initialized');
    } catch (err) {
      logger.warn('Could not initialize ghost-cursor, falling back to basic clicks', { error: err.message });
      this._initialized = false;
    }
  }

  /**
   * Move mouse to element and click with human-like behavior
   * @param {string} selector - CSS selector or element handle
   * @param {object} options - Click options
   */
  async click(selector, options = {}) {
    await this._preActionDelay();

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
   * @param {string} selector - Input selector
   * @param {string} text - Text to type
   * @param {object} options - Typing options
   */
  async type(selector, text, options = {}) {
    await this._preActionDelay();

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

    // Type character by character with variable speed
    const baseWPM = options.wpm || randomInt(40, 70); // Words per minute
    const charDelay = 60000 / (baseWPM * 5); // Average delay per character

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Variable delay per character (some chars are typed faster)
      let delay = charDelay + randomInt(-charDelay * 0.4, charDelay * 0.4);
      
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
   */
  async warmUp() {
    logger.debug('Warming up page (simulating natural browse)...');
    
    // Random idle mouse movements
    for (let i = 0; i < randomInt(2, 4); i++) {
      await this.idleMovement();
      await sleep(randomInt(200, 600));
    }

    // Small scroll to show "interest"
    await this.scroll(randomInt(100, 300), 'down');
    await sleep(randomInt(500, 1500));

    // Scroll back up sometimes
    if (Math.random() < 0.4) {
      await this.scroll(randomInt(50, 150), 'up');
      await sleep(randomInt(300, 800));
    }
  }

  // ─── Private Helpers ─────────────────────────────────

  async _preActionDelay() {
    // Simulate human reaction time before each action
    await sleep(randomInt(200, 800));
  }

  async _postActionDelay(baseMs = 500) {
    // Simulate observation time after action
    await sleep(randomInt(baseMs, baseMs * 2.5));
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
