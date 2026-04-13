/**
 * AI Flow Builder — Session Manager
 * Saves and loads browser cookies per profile.
 * Enables login-free replays by persisting sessions.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/crypto');

// Sessions directory
const SESSIONS_DIR = path.join(config.paths.data, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

class SessionManager {

  /**
   * Save cookies from a browser page to disk
   * @param {string} profileName — e.g. "google_admin" or "client1_company"
   * @param {object} page — Puppeteer page object
   */
  async saveCookies(profileName, page) {
    try {
      const cookies = await page.cookies();
      if (!cookies || cookies.length === 0) {
        logger.debug(`No cookies to save for profile: ${profileName}`);
        return false;
      }

      const profileDir = this._getProfileDir(profileName);
      const cookiePath = path.join(profileDir, 'cookies.json');

      // Encrypt cookies before saving
      const cookieData = JSON.stringify(cookies);
      const encrypted = encrypt(cookieData, config.masterPassword);

      fs.writeFileSync(cookiePath, JSON.stringify({
        encrypted,
        savedAt: new Date().toISOString(),
        cookieCount: cookies.length,
        domains: [...new Set(cookies.map(c => c.domain))],
      }, null, 2));

      logger.info(`Saved ${cookies.length} cookies for profile: ${profileName}`);
      return true;
    } catch (err) {
      logger.error(`Failed to save cookies for ${profileName}`, { error: err.message });
      return false;
    }
  }

  /**
   * Load saved cookies into a browser page
   * @param {string} profileName
   * @param {object} page — Puppeteer page object
   * @returns {boolean} true if cookies were loaded
   */
  async loadCookies(profileName, page) {
    try {
      const profileDir = this._getProfileDir(profileName);
      const cookiePath = path.join(profileDir, 'cookies.json');

      if (!fs.existsSync(cookiePath)) {
        logger.debug(`No saved cookies for profile: ${profileName}`);
        return false;
      }

      const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      const decrypted = decrypt(raw.encrypted, config.masterPassword);
      const cookies = JSON.parse(decrypted);

      if (!cookies || cookies.length === 0) return false;

      // Filter out expired cookies
      const now = Date.now() / 1000;
      const validCookies = cookies.filter(c => {
        if (c.expires && c.expires > 0 && c.expires < now) return false;
        return true;
      });

      if (validCookies.length === 0) {
        logger.info(`All cookies expired for profile: ${profileName}`);
        return false;
      }

      await page.setCookie(...validCookies);
      logger.info(`Loaded ${validCookies.length} cookies for profile: ${profileName}`);
      return true;
    } catch (err) {
      logger.error(`Failed to load cookies for ${profileName}`, { error: err.message });
      return false;
    }
  }

  /**
   * Check if a saved session exists and is likely valid
   */
  hasSavedSession(profileName) {
    const cookiePath = path.join(this._getProfileDir(profileName), 'cookies.json');
    if (!fs.existsSync(cookiePath)) return false;

    try {
      const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      // Consider session invalid if older than 24 hours
      const savedAt = new Date(raw.savedAt);
      const hoursSinceSave = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceSave < 24;
    } catch {
      return false;
    }
  }

  /**
   * Get session info for a profile
   */
  getSessionInfo(profileName) {
    const cookiePath = path.join(this._getProfileDir(profileName), 'cookies.json');
    if (!fs.existsSync(cookiePath)) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      return {
        profileName,
        savedAt: raw.savedAt,
        cookieCount: raw.cookieCount,
        domains: raw.domains,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete saved session
   */
  clearSession(profileName) {
    const profileDir = this._getProfileDir(profileName);
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
      logger.info(`Cleared session for profile: ${profileName}`);
      return true;
    }
    return false;
  }

  /**
   * List all saved sessions
   */
  listSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) return [];

    const sessions = [];
    const dirs = fs.readdirSync(SESSIONS_DIR);

    for (const dir of dirs) {
      const fullPath = path.join(SESSIONS_DIR, dir);
      if (!fs.statSync(fullPath).isDirectory()) continue;

      const info = this.getSessionInfo(dir);
      if (info) {
        sessions.push(info);
      }
    }

    return sessions;
  }

  // ─── Private ────────────────────────────────────

  _getProfileDir(profileName) {
    const safeName = profileName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(SESSIONS_DIR, safeName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }
}

module.exports = new SessionManager();
