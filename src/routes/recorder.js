/**
 * AI Flow Builder — Recorder Routes
 * Start/stop recording sessions.
 */

const express = require('express');
const router = express.Router();
const recorder = require('../core/recorder');
const logger = require('../utils/logger');

// Store the WebSocket broadcast function
let wsBroadcast = () => {};
function setRecorderBroadcast(fn) { wsBroadcast = fn; }

/**
 * POST /api/recorder/start
 * Start a recording session
 */
router.post('/start', async (req, res) => {
  try {
    const { profileName = 'default', startUrl = '' } = req.body;

    const result = await recorder.start({
      profileName,
      startUrl,
      onEvent: (data) => {
        wsBroadcast(JSON.stringify(data));
      },
    });

    res.json({ success: result.success, message: result.message });
  } catch (err) {
    logger.error('Recorder start error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/recorder/stop
 * Stop recording and return captured steps
 */
router.post('/stop', async (req, res) => {
  try {
    const result = await recorder.stop();
    res.json({
      success: result.success,
      steps: result.steps,
      stepCount: result.stepCount,
      profileName: result.profileName || 'default',
      message: result.message,
    });
  } catch (err) {
    logger.error('Recorder stop error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/recorder/discard
 * Discard recording
 */
router.post('/discard', async (req, res) => {
  try {
    const result = await recorder.discard();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/recorder/status
 * Get current recording status
 */
router.get('/status', (req, res) => {
  const status = recorder.getStatus();
  res.json({ success: true, ...status });
});

/**
 * POST /api/recorder/reset
 * Force reset recorder (emergency cleanup for stuck sessions)
 */
router.post('/reset', async (req, res) => {
  try {
    const result = await recorder.forceReset();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/recorder/force-reset
 * Alias for reset — used by frontend force reset button
 */
router.post('/force-reset', async (req, res) => {
  try {
    const result = await recorder.forceReset();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/recorder/navigate
 * Navigate the recording browser to a URL (REST API fallback)
 */
router.post('/navigate', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL required' });
    
    recorder.handleRemoteNavigate(url);
    res.json({ success: true, message: `Navigating to ${url}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.setRecorderBroadcast = setRecorderBroadcast;
