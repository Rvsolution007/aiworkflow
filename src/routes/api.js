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

// Execution listing also at /api/executions
router.use('/executions', require('./execution'));

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
