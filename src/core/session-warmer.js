/**
 * AI Flow Builder — Session Warmer
 * 
 * Warms up the browser session by visiting Google/YouTube/Gmail
 * BEFORE the actual flow runs. This builds realistic browsing history
 * and cookies that make Google see us as a real user.
 * 
 * Key benefit: Real users don't just open Chrome and go straight
 * to Admin Console. They browse around first.
 * 
 * Usage:
 * - Called automatically before flow execution
 * - Runs during the 30-min auto-repeat break
 * - Can be toggled on/off per flow via warmUpEnabled flag
 */

const logger = require('../utils/logger');
const { sleep, randomInt } = require('../utils/helpers');

class SessionWarmer {
  constructor() {
    this._lastWarmupTime = null;
    this._warmupCooldownMs = 25 * 60 * 1000; // 25 minutes minimum between warmups
  }

  /**
   * Check if warm-up is needed based on last warmup time
   * Avoids warming up too frequently
   */
  needsWarmup() {
    if (!this._lastWarmupTime) return true;
    const elapsed = Date.now() - this._lastWarmupTime;
    return elapsed > this._warmupCooldownMs;
  }

  /**
   * Perform session warm-up
   * Visits Google, YouTube, and optionally Gmail to build
   * realistic browsing history and cookies.
   * 
   * @param {object} page - Puppeteer page
   * @param {object} human - HumanBehavior instance
   * @param {function} onProgress - Progress callback
   * @returns {boolean} true if warmup completed successfully
   */
  async warmUp(page, human, onProgress = () => {}) {
    logger.info('[WARMER] 🔥 Starting session warm-up...');
    onProgress({ event: 'warmup', status: 'starting', message: '🔥 Warming up session — browsing like a real user...' });

    const startTime = Date.now();

    try {
      // ─── Step 1: Visit Google Search (30-40% of all browsing starts here) ───
      await this._visitGoogle(page, human, onProgress);

      // ─── Step 2: Visit YouTube briefly (builds Google cookies) ───
      await this._visitYouTube(page, human, onProgress);

      // ─── Step 3: Maybe visit Gmail (50% chance — not every session) ───
      if (Math.random() < 0.5) {
        await this._visitGmail(page, human, onProgress);
      }

      // ─── Step 4: Maybe visit Google News or Maps (adds variety) ───
      if (Math.random() < 0.3) {
        await this._visitRandomGoogle(page, human, onProgress);
      }

      this._lastWarmupTime = Date.now();
      const duration = Math.round((Date.now() - startTime) / 1000);

      logger.info(`[WARMER] ✅ Session warm-up completed in ${duration}s`);
      onProgress({ event: 'warmup', status: 'completed', message: `✅ Session warm-up done (${duration}s) — proceeding to flow...` });

      return true;
    } catch (err) {
      logger.warn(`[WARMER] Warm-up failed (non-fatal): ${err.message}`);
      onProgress({ event: 'warmup', status: 'failed', message: `⚠️ Warm-up partially failed — proceeding anyway...` });
      this._lastWarmupTime = Date.now(); // Don't retry immediately
      return false;
    }
  }

  /**
   * Run warm-up during the scheduler's break period
   * This is called by the scheduler during the 30-min interval
   * 
   * @param {object} browserManager - BrowserManager instance
   * @param {string} profileName - Browser profile to use
   */
  async warmUpDuringBreak(browserManager, profileName) {
    logger.info('[WARMER] 🔥 Running break-time warm-up...');

    try {
      // Launch browser
      const { page } = await browserManager.launch({
        profileName,
        headless: true,
      });

      // Load session cookies
      const SessionManager = require('./session-manager');
      await SessionManager.loadCookies(profileName, page);

      // Create a basic human behavior (no ghost-cursor needed for break warmup)
      const HumanBehavior = require('./human-behavior');
      const human = new HumanBehavior(page);
      await human.init();

      // Run warmup
      await this.warmUp(page, human);

      // Save updated cookies
      await SessionManager.saveCookies(profileName, page);

      // Cleanup
      human.destroy();
      await browserManager.close();

      logger.info('[WARMER] ✅ Break-time warm-up completed');
      return true;
    } catch (err) {
      logger.warn(`[WARMER] Break-time warm-up failed: ${err.message}`);
      try { await browserManager.close(); } catch (e) {}
      return false;
    }
  }

  // ─── Private Visit Methods ─────────────────────────────

  /**
   * Visit Google.com — search for something natural
   */
  async _visitGoogle(page, human, onProgress) {
    onProgress({ event: 'warmup', status: 'running', message: '🔍 Visiting Google Search...' });

    try {
      await page.goto('https://www.google.com/', {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      await sleep(randomInt(1500, 3000));

      // Accept cookie consent if shown
      await this._handleCookieConsent(page);

      // Do a natural search
      const searchQueries = [
        'weather today',
        'latest news india',
        'time now',
        'cricket score',
        'IPL 2026',
        'top movies 2026',
        'best restaurants near me',
        'stock market today',
        'gold price today',
        'USD to INR',
        'petrol price today',
        'what day is today',
        'festivals in april',
        'how to improve productivity',
      ];

      const query = searchQueries[randomInt(0, searchQueries.length - 1)];

      // Find search input
      const searchInput = await page.$('textarea[name="q"], input[name="q"]');
      if (searchInput) {
        // Type search query naturally
        await human.type('textarea[name="q"], input[name="q"]', query);
        await sleep(randomInt(500, 1500));

        // Press Enter
        await page.keyboard.press('Enter');
        await sleep(randomInt(2000, 5000));

        // Scroll results casually
        await human.scroll(randomInt(200, 500), 'down');
        await sleep(randomInt(1000, 3000));

        // Maybe click a result (20% chance)
        if (Math.random() < 0.2) {
          try {
            const results = await page.$$('div.g a, div[data-hveid] a');
            if (results.length > 0) {
              const resultIdx = randomInt(0, Math.min(results.length - 1, 3));
              await results[resultIdx].click();
              await sleep(randomInt(3000, 6000));
              // Go back
              await page.goBack({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
              await sleep(randomInt(1000, 2000));
            }
          } catch (e) {}
        }

        // Scroll some more
        await human.scroll(randomInt(100, 300), Math.random() > 0.5 ? 'down' : 'up');
        await sleep(randomInt(1000, 2000));
      }

      logger.debug('[WARMER] Google Search done');
    } catch (err) {
      logger.debug(`[WARMER] Google visit failed: ${err.message}`);
    }
  }

  /**
   * Visit YouTube briefly — builds Google cross-service cookies
   */
  async _visitYouTube(page, human, onProgress) {
    onProgress({ event: 'warmup', status: 'running', message: '📺 Browsing YouTube briefly...' });

    try {
      await page.goto('https://www.youtube.com/', {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      await sleep(randomInt(2000, 4000));

      // Handle YouTube consent/cookie banner
      await this._handleCookieConsent(page);

      // Scroll through feed
      await human.scroll(randomInt(300, 700), 'down');
      await sleep(randomInt(2000, 5000));

      // Maybe scroll more
      if (Math.random() < 0.5) {
        await human.scroll(randomInt(200, 400), 'down');
        await sleep(randomInt(1000, 3000));
      }

      // Scroll back up
      await human.scroll(randomInt(100, 200), 'up');
      await sleep(randomInt(1000, 2000));

      logger.debug('[WARMER] YouTube browse done');
    } catch (err) {
      logger.debug(`[WARMER] YouTube visit failed: ${err.message}`);
    }
  }

  /**
   * Visit Gmail — check inbox briefly (builds authenticated cookies)
   */
  async _visitGmail(page, human, onProgress) {
    onProgress({ event: 'warmup', status: 'running', message: '📧 Checking Gmail...' });

    try {
      await page.goto('https://mail.google.com/', {
        waitUntil: 'networkidle2',
        timeout: 25000,
      });
      await sleep(randomInt(3000, 6000));

      // If redirected to login, skip (we don't want to login during warmup)
      const url = page.url();
      if (url.includes('accounts.google.com/signin') || url.includes('accounts.google.com/v3')) {
        logger.debug('[WARMER] Gmail requires login — skipping');
        return;
      }

      // If Gmail loaded, scroll inbox
      await human.scroll(randomInt(200, 400), 'down');
      await sleep(randomInt(2000, 4000));

      // Scroll back up
      await human.scroll(randomInt(100, 200), 'up');
      await sleep(randomInt(1000, 2000));

      logger.debug('[WARMER] Gmail browse done');
    } catch (err) {
      logger.debug(`[WARMER] Gmail visit failed: ${err.message}`);
    }
  }

  /**
   * Visit a random Google service (adds variety to browsing history)
   */
  async _visitRandomGoogle(page, human, onProgress) {
    const services = [
      { name: 'Google News', url: 'https://news.google.com/' },
      { name: 'Google Maps', url: 'https://www.google.com/maps' },
      { name: 'Google Drive', url: 'https://drive.google.com/' },
    ];

    const service = services[randomInt(0, services.length - 1)];
    onProgress({ event: 'warmup', status: 'running', message: `🌐 Visiting ${service.name}...` });

    try {
      await page.goto(service.url, {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      await sleep(randomInt(2000, 5000));

      // Brief interaction
      await human.scroll(randomInt(200, 400), 'down');
      await sleep(randomInt(1500, 3000));

      logger.debug(`[WARMER] ${service.name} browse done`);
    } catch (err) {
      logger.debug(`[WARMER] ${service.name} visit failed: ${err.message}`);
    }
  }

  /**
   * Handle cookie consent banners (Google, YouTube, etc.)
   */
  async _handleCookieConsent(page) {
    try {
      // Wait a moment for banner to appear
      await sleep(1000);

      // Try common cookie consent buttons
      const consentSelectors = [
        'button[aria-label="Accept all"]',
        'button[aria-label="Accept All"]',
        '::-p-text(Accept all)',
        '::-p-text(Accept All)',
        '::-p-text(I agree)',
        '::-p-text(Agree)',
        'button#L2AGLb', // Google's consent button ID
        'form[action*="consent"] button',
        '[data-consent="accept"]',
      ];

      for (const sel of consentSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            logger.debug('[WARMER] Cookie consent accepted');
            await sleep(randomInt(1000, 2000));
            return;
          }
        } catch (e) {}
      }
    } catch (err) {
      // Non-critical
    }
  }
}

// Singleton
module.exports = new SessionWarmer();
