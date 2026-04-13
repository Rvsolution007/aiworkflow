/**
 * AI Flow Builder — Main API Router
 * Mounts all sub-routes.
 */

const express = require('express');
const router = express.Router();

router.use('/flows', require('./flows'));
router.use('/credentials', require('./credentials'));
router.use('/execute', require('./execution'));

// Execution listing also at /api/executions
router.use('/executions', require('./execution'));

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

module.exports = router;
