/**
 * AI Flow Builder — Credential Vault
 * High-level credential management with encryption.
 * Wraps the Credential model with additional security layers.
 */

const Credential = require('../models/Credential');
const { encrypt, decrypt } = require('../utils/crypto');
const config = require('../config');
const logger = require('../utils/logger');

const CredentialVault = {
  /**
   * Store a new credential securely
   */
  store({ name, label, username, password, totpSecret, extra }) {
    // Validate
    if (!name || !username || !password) {
      throw new Error('Name, username, and password are required');
    }

    // Check if name already exists
    const existing = Credential.findByName(name);
    if (existing) {
      throw new Error(`Credential "${name}" already exists. Use update instead.`);
    }

    const result = Credential.create({ name, label, username, password, totpSecret, extra });
    logger.info(`Credential stored: "${name}"`);
    return result;
  },

  /**
   * Retrieve decrypted credentials (for automation use only)
   */
  retrieve(name) {
    const cred = Credential.findByName(name, true);
    if (!cred) {
      throw new Error(`Credential "${name}" not found`);
    }
    return cred;
  },

  /**
   * List all credentials (safe — no passwords shown)
   */
  list() {
    return Credential.findAll();
  },

  /**
   * Update a credential
   */
  update(id, data) {
    const result = Credential.update(id, data);
    if (!result) throw new Error('Credential not found');
    logger.info(`Credential updated: ID ${id}`);
    return result;
  },

  /**
   * Delete a credential
   */
  delete(id) {
    const result = Credential.delete(id);
    logger.info(`Credential deleted: ID ${id}`);
    return result;
  },

  /**
   * Verify master password is correct by trying to decrypt first credential
   */
  verifyMasterPassword() {
    try {
      const all = Credential.findAll();
      if (all.length === 0) return true; // No credentials to verify against
      
      // Try to decrypt the first credential
      const first = Credential.findById(all[0].id, true);
      return !!first;
    } catch (err) {
      return false;
    }
  },
};

module.exports = CredentialVault;
