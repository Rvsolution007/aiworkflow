/**
 * AI Flow Builder — Session Routes
 * Manage saved browser sessions (cookies).
 */

const express = require('express');
const router = express.Router();
const sessionManager = require('../core/session-manager');
const logger = require('../utils/logger');

/**
 * GET /api/sessions
 * List all saved sessions
 */
router.get('/', (req, res) => {
  try {
    const sessions = sessionManager.listSessions();
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/sessions/:profileName
 * Delete a saved session
 */
router.delete('/:profileName', (req, res) => {
  try {
    const deleted = sessionManager.clearSession(req.params.profileName);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sessions/:profileName
 * Get session info
 */
router.get('/:profileName', (req, res) => {
  try {
    const info = sessionManager.getSessionInfo(req.params.profileName);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    res.json({ success: true, session: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
