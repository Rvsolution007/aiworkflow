/**
 * AI Flow Builder — Browser Manager
 * Launches anti-detect browser using rebrowser-puppeteer-core.
 * Manages browser lifecycle, profiles, and stealth configuration.
 * 
 * v2 — Enhanced anti-detection: removed bot flags, enabled extensions,
 *       realistic Chrome args matching real desktop user.
 */

const puppeteer = require('rebrowser-puppeteer-core');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
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
   * Launch browser with retry logic for Docker stability
   */
  async launch(options = {}) {
    const { profileName = 'default', headless } = options;

    // Select fingerprint profile
    this.profile = getRandomProfile();
    logger.info('Selected fingerprint profile', {
      ua: this.profile.userAgent.substring(0, 50) + '...',
      viewport: `${this.profile.viewport.width}x${this.profile.viewport.height}`,
    });

    // Setup persistent profile directory
    this.profileDir = path.join(config.paths.profiles, sanitizeFilename(profileName));
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }

    // Clean up before launch
    this._cleanupBeforeLaunch();

    const executablePath = this._findChromePath();
    const isHeadless = headless !== undefined ? headless : config.browser.headless;
    const isRecordingMode = headless === false; // Explicit false = recording mode
    const args = this._buildLaunchArgs();

    // Retry launch up to 3 times
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        logger.info(`Launching browser (attempt ${attempt}/3)...`);

        // Build environment for browser process
        const browserEnv = { ...process.env };

        // On Linux server, always use headless 'new' mode for recording
        // Chrome's "new" headless mode has FULL rendering — no Xvfb needed!
        const useHeadless = process.platform === 'linux' ? 'new' : (isHeadless ? 'new' : false);

        if (process.platform === 'linux') {
          logger.info('Linux detected — using headless "new" mode (full rendering, no display needed)');
        }

        this.browser = await puppeteer.launch({
          executablePath,
          headless: useHeadless,
          args,
          defaultViewport: {
            width: this.profile.viewport.width,
            height: this.profile.viewport.height,
          },
          ignoreDefaultArgs: ['--enable-automation'],
          protocolTimeout: 120000,
          timeout: 60000,
          // Handle browser disconnection
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
          env: browserEnv,
        });

        // Get the first page or create one
        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();

        // Apply anti-detection measures
        await this._applyStealthMeasures();
        await this.page.setUserAgent(this.profile.userAgent);

        // Configure proxy authentication if needed
        if (config.proxy.enabled && config.proxy.username) {
          await this.page.authenticate({
            username: config.proxy.username,
            password: config.proxy.password,
          });
        }

        // Monitor browser for unexpected disconnection
        this.browser.on('disconnected', () => {
          logger.warn('Browser disconnected unexpectedly');
          this.browser = null;
          this.page = null;
        });

        logger.info('Browser launched successfully');
        return { browser: this.browser, page: this.page, profile: this.profile };

      } catch (err) {
        lastError = err;
        logger.error(`Browser launch attempt ${attempt} failed: ${err.message}`);

        // Cleanup failed browser
        try { if (this.browser) await this.browser.close(); } catch (e) {}
        this.browser = null;
        this.page = null;

        if (attempt < 3) {
          // Kill any stuck processes and wait before retry
          this._cleanupBeforeLaunch();
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    throw lastError;
  }

  /**
   * Take a screenshot safely (won't crash if browser died)
   */
  async screenshot(filename = 'screenshot') {
    if (!this.page) {
      logger.warn('Cannot take screenshot — page is null');
      return null;
    }

    try {
      const screenshotPath = path.join(
        config.paths.screenshots,
        `${sanitizeFilename(filename)}_${Date.now()}.png`
      );

      await this.page.screenshot({ path: screenshotPath, fullPage: false });
      logger.debug(`Screenshot saved: ${screenshotPath}`);
      return screenshotPath;
    } catch (err) {
      logger.warn(`Screenshot failed (non-fatal): ${err.message}`);
      return null;
    }
  }

  /**
   * Close browser gracefully + force kill any orphans
   */
  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('Browser closed');
      } catch (err) {
        logger.warn('Error closing browser, force killing', { error: err.message });
        // Force kill if graceful close fails
        try {
          const proc = this.browser.process();
          if (proc) proc.kill('SIGKILL');
        } catch (e) {}
      }
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Check if browser is still alive
   */
  isAlive() {
    return this.browser !== null && this.browser.isConnected();
  }

  // ─── Private Methods ─────────────────────────────────

  /**
   * Kill zombie processes + remove lock files before launch
   */
  _cleanupBeforeLaunch() {
    // Kill zombie Chromium processes (Linux/Docker only)
    if (process.platform === 'linux') {
      try {
        execSync('pkill -9 -f "chromium.*--type=" 2>/dev/null || true', { stdio: 'ignore' });
        execSync('pkill -9 -f "chromium.*--user-data-dir" 2>/dev/null || true', { stdio: 'ignore' });
        execSync('sleep 1', { stdio: 'ignore' });
      } catch (e) {}
    }

    // Remove lock files
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const file of lockFiles) {
      try { fs.unlinkSync(path.join(this.profileDir, file)); } catch (e) {}
    }
    logger.debug('Pre-launch cleanup complete');
  }

  /**
   * Build Chrome launch arguments — STEALTH OPTIMIZED
   * 
   * Key changes from v1:
   * - REMOVED: --disable-extensions (biggest bot flag!)
   * - REMOVED: --disable-gpu (suspicious on desktop)
   * - REMOVED: --disable-background-networking (real users have it)
   * - REMOVED: --disable-sync (real users have sync)
   * - ADDED: Realistic flags matching a normal Chrome desktop session
   */
  _buildLaunchArgs() {
    const args = [
      // ─── Security (required for Docker/headless) ───
      '--no-sandbox',
      '--disable-setuid-sandbox',

      // ─── Anti-detection (CRITICAL) ───
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      '--use-mock-keychain',

      // ─── DO NOT disable extensions — real users have extensions! ───
      // '--disable-extensions',    // REMOVED — this is the #1 bot flag
      // '--disable-gpu',           // REMOVED — suspicious on desktop
      // '--disable-background-networking',  // REMOVED — real browsers have it
      // '--disable-sync',          // REMOVED — real browsers use sync

      // ─── Performance (safe ones that don't flag as bot) ───
      '--disable-dev-shm-usage',
      '--disable-default-apps',
      '--disable-translate',
      '--disable-features=TranslateUI',

      // ─── Realistic Chrome flags (what real users have) ───
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--disable-features=IsolateOrigins,site-per-process',
      '--metrics-recording-only',  // Chrome sends telemetry — we look real

      // ─── WebRTC leak prevention ───
      '--enforce-webrtc-ip-permission-check',
      '--disable-webrtc-hw-encoding',
      '--disable-webrtc-hw-decoding',

      // ─── Misc realism ───
      '--disable-component-update',
      '--disable-domain-reliability',  // Prevents telemetry that reveals automation

      // ─── Crash prevention ───
      '--disable-crashpad',
      '--crash-dumps-dir=/tmp/.chromium/crashes',

      // ─── Profile ───
      `--user-data-dir=${this.profileDir}`,
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
   * Enhanced v2 — adds focus/visibility simulation + better headers
   */
  async _applyStealthMeasures() {
    // Inject fingerprint overrides before any page loads
    await this.page.evaluateOnNewDocument(generateFingerprintScript(this.profile));

    // Override timezone
    await this.page.emulateTimezone(this.profile.timezone);

    // Set geolocation (India — slight random offset)
    await this.page.setGeolocation({
      latitude: 28.6139 + (Math.random() * 0.1 - 0.05),
      longitude: 77.2090 + (Math.random() * 0.1 - 0.05),
      accuracy: 100,
    });

    // ─── Dynamic sec-ch-ua based on profile's Chrome version ───
    const chromeVersion = this.profile.userAgent.match(/Chrome\/(\d+)/)?.[1] || '135';
    const secChUa = `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="24"`;

    // Set extra HTTP headers (matching real Chrome exactly)
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': this.profile.languages.join(','),
      'sec-ch-ua': secChUa,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });

    // ─── Page visibility simulation ───
    // Ensure document.visibilityState always reports "visible"
    // (headless mode sometimes reports "hidden" which flags as bot)
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true,
      });
      Object.defineProperty(document, 'hidden', {
        get: () => false,
        configurable: true,
      });

      // Prevent headless detection via document.hasFocus()
      document.hasFocus = () => true;

      // Prevent detection via Notification.permission
      if (typeof Notification !== 'undefined') {
        Object.defineProperty(Notification, 'permission', {
          get: () => 'default',
          configurable: true,
        });
      }
    });

    logger.debug('Stealth measures applied (v2 — enhanced)');
  }

  /**
   * Find Chrome/Chromium executable path
   */
  _findChromePath() {
    if (config.browser.executablePath) {
      return config.browser.executablePath;
    }

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
        return chromePath;
      }
    }

    throw new Error('Chrome/Chromium not found. Set CHROME_EXECUTABLE_PATH in .env');
  }
}

module.exports = BrowserManager;
