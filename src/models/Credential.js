/**
 * AI Flow Builder — Credential Model
 * Encrypted credential storage with AES-256-GCM.
 * Passwords/usernames are NEVER stored in plaintext.
 */

const db = require('./database');
const { encrypt, decrypt } = require('../utils/crypto');
const config = require('../config');

const Credential = {
  /**
   * Create a new credential (encrypts username + password)
   */
  create({ name, label = '', username, password, totpSecret = null, extra = null }) {
    const mp = config.masterPassword;

    const stmt = db.prepare(`
      INSERT INTO credentials (name, label, username_encrypted, password_encrypted, totp_secret_encrypted, extra_encrypted)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      label,
      encrypt(username, mp),
      encrypt(password, mp),
      totpSecret ? encrypt(totpSecret, mp) : null,
      extra ? encrypt(JSON.stringify(extra), mp) : null
    );

    return this.findById(result.lastInsertRowid, false);
  },

  /**
   * Find credential by ID
   * @param {boolean} decrypted - If true, decrypt sensitive fields
   */
  findById(id, decrypted = false) {
    const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
    if (!row) return null;
    return decrypted ? this._decrypt(row) : this._sanitize(row);
  },

  /**
   * Find credential by name
   * @param {boolean} decrypted - If true, decrypt sensitive fields
   */
  findByName(name, decrypted = false) {
    const row = db.prepare('SELECT * FROM credentials WHERE name = ?').get(name);
    if (!row) return null;
    return decrypted ? this._decrypt(row) : this._sanitize(row);
  },

  /**
   * Get all credentials (sanitized — no passwords)
   */
  findAll() {
    const rows = db.prepare('SELECT * FROM credentials ORDER BY name ASC').all();
    return rows.map(row => this._sanitize(row));
  },

  /**
   * Update a credential
   */
  update(id, { name, label, username, password, totpSecret, extra }) {
    const mp = config.masterPassword;
    const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
    if (!existing) return null;

    const stmt = db.prepare(`
      UPDATE credentials SET
        name = COALESCE(?, name),
        label = COALESCE(?, label),
        username_encrypted = COALESCE(?, username_encrypted),
        password_encrypted = COALESCE(?, password_encrypted),
        totp_secret_encrypted = COALESCE(?, totp_secret_encrypted),
        extra_encrypted = COALESCE(?, extra_encrypted),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      name || null,
      label !== undefined ? label : null,
      username ? encrypt(username, mp) : null,
      password ? encrypt(password, mp) : null,
      totpSecret ? encrypt(totpSecret, mp) : null,
      extra ? encrypt(JSON.stringify(extra), mp) : null,
      id
    );

    return this.findById(id, false);
  },

  /**
   * Delete a credential
   */
  delete(id) {
    return db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
  },

  /**
   * Decrypt sensitive fields from a credential row
   * @private
   */
  _decrypt(row) {
    const mp = config.masterPassword;
    return {
      id: row.id,
      name: row.name,
      label: row.label,
      username: decrypt(row.username_encrypted, mp),
      password: decrypt(row.password_encrypted, mp),
      totpSecret: row.totp_secret_encrypted ? decrypt(row.totp_secret_encrypted, mp) : null,
      extra: row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted, mp)) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },

  /**
   * Sanitize a credential row (remove encrypted fields, show only safe info)
   * @private
   */
  _sanitize(row) {
    return {
      id: row.id,
      name: row.name,
      label: row.label,
      hasUsername: !!row.username_encrypted,
      hasPassword: !!row.password_encrypted,
      hasTotpSecret: !!row.totp_secret_encrypted,
      hasExtra: !!row.extra_encrypted,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },
};

module.exports = Credential;
