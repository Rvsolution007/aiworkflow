/**
 * AI Flow Builder — Browser Manager
 * Launches anti-detect headless browser using rebrowser-puppeteer-core.
 * Manages browser lifecycle, profiles, and stealth configuration.
 */

const puppeteer = require('rebrowser-puppeteer-core');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');
const { getRandomProfile, generateFingerprintScript } = require('./fingerprint');
const { sanitizeFilename } = require('../utils/helpers');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.page = null;
    this.profile = null;
    this.profileDir = null;
  }

  /**
   * Launch browser with full anti-detection configuration
   * @param {object} options - Launch options
   * @param {string} options.profileName - Name for persistent profile (reuse sessions)
   * @param {boolean} options.headless - Override headless setting
   * @returns {object} { browser, page, profile }
   */
  async launch(options = {}) {
    const { profileName = 'default', headless } = options;

    // Select fingerprint profile
    this.profile = getRandomProfile();
    logger.info('Selected fingerprint profile', {
      ua: this.profile.userAgent.substring(0, 50) + '...',
      viewport: `${this.profile.viewport.width}x${this.profile.viewport.height}`,
      gpu: this.profile.webglRenderer.substring(0, 40) + '...',
    });

    // Setup persistent profile directory
    this.profileDir = path.join(config.paths.profiles, sanitizeFilename(profileName));
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }

    // Build launch arguments
    const args = this._buildLaunchArgs();

    // Determine Chrome executable path
    const executablePath = this._findChromePath();

    const isHeadless = headless !== undefined ? headless : config.browser.headless;

    logger.info('Launching browser...', {
      headless: isHeadless,
      profile: profileName,
      chrome: executablePath,
    });

    // Launch browser
    this.browser = await puppeteer.launch({
      executablePath,
      headless: isHeadless ? 'new' : false,
      args,
      defaultViewport: {
        width: this.profile.viewport.width,
        height: this.profile.viewport.height,
      },
      ignoreDefaultArgs: ['--enable-automation'],
      // Extra anti-detect settings for rebrowser
      protocolTimeout: 120000,
      timeout: 30000,
    });

    // Get the first page or create one
    const pages = await this.browser.pages();
    this.page = pages[0] || await this.browser.newPage();

    // Apply anti-detection measures
    await this._applyStealthMeasures();

    // Set user agent
    await this.page.setUserAgent(this.profile.userAgent);

    // Configure proxy authentication if needed
    if (config.proxy.enabled && config.proxy.username) {
      await this.page.authenticate({
        username: config.proxy.username,
        password: config.proxy.password,
      });
    }

    logger.info('Browser launched successfully');

    return {
      browser: this.browser,
      page: this.page,
      profile: this.profile,
    };
  }

  /**
   * Take a screenshot and save it
   * @param {string} filename - Screenshot filename (without extension)
   * @returns {string} Full path to screenshot
   */
  async screenshot(filename = 'screenshot') {
    if (!this.page) throw new Error('Browser not launched');

    const screenshotPath = path.join(
      config.paths.screenshots,
      `${sanitizeFilename(filename)}_${Date.now()}.png`
    );

    await this.page.screenshot({
      path: screenshotPath,
      fullPage: false,
    });

    logger.debug(`Screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  }

  /**
   * Close browser gracefully
   */
  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('Browser closed');
      } catch (err) {
        logger.warn('Error closing browser', { error: err.message });
      }
      this.browser = null;
      this.page = null;
    }
  }

  // ─── Private Methods ─────────────────────────────────

  /**
   * Build Chrome launch arguments for anti-detection
   */
  _buildLaunchArgs() {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain',
      // Fix for Docker crashpad error
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-crashpad',
      '--no-zygote',
      '--disable-features=dbus',
      '--crash-dumps-dir=/tmp/.chromium/crashes',
      `--user-data-dir=${this.profileDir}`,
      // Window size
      `--window-size=${this.profile.viewport.width},${this.profile.viewport.height}`,
      `--lang=${this.profile.locale}`,
    ];

    // Proxy
    if (config.proxy.enabled) {
      args.push(`--proxy-server=${config.proxy.host}:${config.proxy.port}`);
    }

    return args;
  }

  /**
   * Apply stealth measures to avoid bot detection
   */
  async _applyStealthMeasures() {
    // Inject fingerprint overrides before any page loads
    await this.page.evaluateOnNewDocument(generateFingerprintScript(this.profile));

    // Override timezone
    await this.page.emulateTimezone(this.profile.timezone);

    // Set geolocation (India)
    await this.page.setGeolocation({
      latitude: 28.6139 + (Math.random() * 0.1 - 0.05),
      longitude: 77.2090 + (Math.random() * 0.1 - 0.05),
      accuracy: 100,
    });

    // Block known fingerprinting resources (optional — can cause issues)
    // await this._blockFingerprinters();

    // Set extra HTTP headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': this.profile.languages.join(','),
      'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });

    logger.debug('Stealth measures applied');
  }

  /**
   * Find Chrome/Chromium executable path
   */
  _findChromePath() {
    // If explicitly configured, use that
    if (config.browser.executablePath) {
      return config.browser.executablePath;
    }

    // Try common paths
    const possiblePaths = process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : [
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/snap/bin/chromium',
        ];

    for (const chromePath of possiblePaths) {
      if (chromePath && fs.existsSync(chromePath)) {
        logger.info(`Found Chrome at: ${chromePath}`);
        return chromePath;
      }
    }

    throw new Error(
      'Chrome/Chromium not found. Set CHROME_EXECUTABLE_PATH in .env or install Chrome.'
    );
  }
}

module.exports = BrowserManager;
