/**
 * AI Flow Builder — Centralized Configuration
 * Loads all settings from environment variables with sensible defaults.
 */

require('dotenv').config();
const path = require('path');

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  // Master Password for credential encryption
  masterPassword: process.env.MASTER_PASSWORD || 'default-change-me-immediately',

  // Google Vertex AI
  google: {
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || './credentials/service-account.json',
    projectId: process.env.GOOGLE_PROJECT_ID || '',
    location: process.env.GOOGLE_LOCATION || 'us-central1',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // Browser
  browser: {
    executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
    headless: process.env.HEADLESS !== 'false',
    viewport: {
      width: parseInt(process.env.DEFAULT_VIEWPORT_WIDTH, 10) || 1366,
      height: parseInt(process.env.DEFAULT_VIEWPORT_HEIGHT, 10) || 768,
    },
  },

  // Proxy
  proxy: {
    host: process.env.PROXY_HOST || '',
    port: process.env.PROXY_PORT || '',
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || '',
    get enabled() {
      return !!(this.host && this.port);
    },
    get url() {
      if (!this.enabled) return null;
      if (this.username && this.password) {
        return `http://${this.username}:${this.password}@${this.host}:${this.port}`;
      }
      return `http://${this.host}:${this.port}`;
    },
  },

  // Paths
  paths: {
    root: path.resolve(__dirname, '../..'),
    data: path.resolve(__dirname, '../../data'),
    db: path.resolve(__dirname, '../../data/db.sqlite'),
    profiles: path.resolve(__dirname, '../../data/profiles'),
    screenshots: path.resolve(__dirname, '../../data/screenshots'),
    public: path.resolve(__dirname, '../../public'),
    credentials: path.resolve(__dirname, '../../credentials'),
  },

  // Session
  sessionSecret: process.env.SESSION_SECRET || 'default-session-secret',
};

module.exports = config;
