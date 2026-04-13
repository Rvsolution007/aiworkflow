/**
 * AI Flow Builder — Main API Router
 * Mounts all sub-routes.
 */

const express = require('express');
const router = express.Router();
const config = require('../config');

router.use('/flows', require('./flows'));
router.use('/credentials', require('./credentials'));
router.use('/execute', require('./execution'));
router.use('/recorder', require('./recorder'));
router.use('/sessions', require('./sessions'));

// Execution listing also at /api/executions
router.use('/executions', require('./execution'));

// Timer/scheduler status
const scheduler = require('../core/scheduler');
router.get('/timers', (req, res) => {
  res.json({ success: true, timers: scheduler.getAllTimers() });
});

router.post('/timers/:flowId', (req, res) => {
  const { enabled, intervalMinutes } = req.body;
  const flowId = parseInt(req.params.flowId);
  
  // Save to database
  const db = require('../models/database');
  db.prepare('UPDATE flows SET timer_enabled = ?, timer_interval_min = ? WHERE id = ?')
    .run(enabled ? 1 : 0, intervalMinutes || 0, flowId);

  // Update scheduler
  scheduler.setEnabled(flowId, enabled, intervalMinutes);

  res.json({ success: true, status: scheduler.getStatus(flowId) });
});

// Health check — includes Redis status
router.get('/health', async (req, res) => {
  let redisStatus = 'unknown';
  let redisError = null;

  try {
    const IORedis = require('ioredis');
    const testConn = new IORedis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      connectTimeout: 3000,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    await testConn.connect();
    await testConn.ping();
    redisStatus = 'connected';
    await testConn.disconnect();
  } catch (err) {
    redisStatus = 'disconnected';
    redisError = err.message;
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    redis: {
      status: redisStatus,
      host: config.redis.host,
      port: config.redis.port,
      error: redisError,
    },
    env: {
      NODE_ENV: config.nodeEnv,
      PORT: config.port,
      REDIS_HOST: config.redis.host,
    },
  });
});

module.exports = router;
