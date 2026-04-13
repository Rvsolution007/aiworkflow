/**
 * AI Flow Builder — Credential Routes
 * Secure credential management API.
 * Passwords are NEVER returned in responses.
 */

const express = require('express');
const router = express.Router();
const CredentialVault = require('../core/credential-vault');
const logger = require('../utils/logger');

/**
 * GET /api/credentials
 * List all credentials (safe — no passwords)
 */
router.get('/', (req, res) => {
  try {
    const credentials = CredentialVault.list();
    res.json({ success: true, credentials });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/credentials
 * Add a new credential
 */
router.post('/', (req, res) => {
  try {
    const { name, label, username, password, totpSecret, extra } = req.body;
    
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'name, username, and password are required' });
    }

    const credential = CredentialVault.store({ name, label, username, password, totpSecret, extra });
    res.status(201).json({ success: true, credential });
  } catch (err) {
    logger.error('Credential creation failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/credentials/:id
 * Update a credential
 */
router.put('/:id', (req, res) => {
  try {
    const { name, label, username, password, totpSecret, extra } = req.body;
    const credential = CredentialVault.update(parseInt(req.params.id), {
      name, label, username, password, totpSecret, extra,
    });
    res.json({ success: true, credential });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/credentials/:id
 * Delete a credential
 */
router.delete('/:id', (req, res) => {
  try {
    CredentialVault.delete(parseInt(req.params.id));
    res.json({ success: true, message: 'Credential deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
