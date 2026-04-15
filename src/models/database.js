/**
 * AI Flow Builder — SQLite Database
 * Auto-creates tables on first run. Zero-config persistence.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

// Ensure data directory exists
const dirs = [config.paths.data, config.paths.profiles, config.paths.screenshots, path.join(config.paths.data, 'logs')];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created directory: ${dir}`);
  }
});

const db = new Database(config.paths.db);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Migrations ──────────────────────────────────────────────────

function migrate() {
  logger.info('Running database migrations...');

  db.exec(`
    -- Flows table
    CREATE TABLE IF NOT EXISTS flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      steps TEXT NOT NULL DEFAULT '[]',
      category TEXT DEFAULT 'general',
      is_favorite INTEGER DEFAULT 0,
      timer_enabled INTEGER DEFAULT 0,
      timer_interval_min INTEGER DEFAULT 0,
      warm_up_enabled INTEGER DEFAULT 1,
      profile_name TEXT DEFAULT 'default',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Credentials table (all values AES-256 encrypted)
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT DEFAULT '',
      username_encrypted TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      totp_secret_encrypted TEXT DEFAULT NULL,
      extra_encrypted TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Executions table
    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id INTEGER NOT NULL,
      flow_name TEXT NOT NULL,
      status TEXT DEFAULT 'queued',
      current_step INTEGER DEFAULT 0,
      total_steps INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT NULL,
      completed_at DATETIME DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );

    -- Execution steps log
    CREATE TABLE IF NOT EXISTS execution_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      action TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      screenshot_path TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      duration_ms INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT NULL,
      completed_at DATETIME DEFAULT NULL,
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
    );

    -- Sessions table (saved browser sessions)
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_name TEXT NOT NULL UNIQUE,
      domain TEXT DEFAULT '',
      cookies_path TEXT DEFAULT '',
      last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_valid INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Settings table (key-value store)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_executions_flow_id ON executions(flow_id);
    CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
    CREATE INDEX IF NOT EXISTS idx_execution_steps_exec_id ON execution_steps(execution_id);
  `);

  // Migration: Add timer columns to existing flows table if not exists
  try {
    db.prepare('SELECT timer_enabled FROM flows LIMIT 1').get();
  } catch (e) {
    logger.info('Migrating flows table: adding timer columns...');
    db.exec('ALTER TABLE flows ADD COLUMN timer_enabled INTEGER DEFAULT 0');
    db.exec('ALTER TABLE flows ADD COLUMN timer_interval_min INTEGER DEFAULT 0');
    db.exec('ALTER TABLE flows ADD COLUMN profile_name TEXT DEFAULT \'default\'');
  }

  // Migration: Add warm_up_enabled column
  try {
    db.prepare('SELECT warm_up_enabled FROM flows LIMIT 1').get();
  } catch (e) {
    logger.info('Migrating flows table: adding warm_up_enabled column...');
    db.exec('ALTER TABLE flows ADD COLUMN warm_up_enabled INTEGER DEFAULT 1');
  }

  logger.info('Database migrations complete.');
}

// Run migrations on load
migrate();

module.exports = db;
