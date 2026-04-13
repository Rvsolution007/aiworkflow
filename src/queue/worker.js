/**
 * AI Flow Builder — Background Worker
 * Processes flow execution jobs from the BullMQ queue.
 * Gracefully handles Redis connection failures.
 */

const config = require('../config');
const logger = require('../utils/logger');

// WebSocket broadcast function (set from server.js)
let wsBroadcast = () => {};

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

let workerInstance = null;

/**
 * Start the background worker (only if Redis is reachable)
 */
async function startWorker() {
  // First test Redis connectivity before creating the worker
  const IORedis = require('ioredis');
  const testConn = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Don't retry — fail fast
    lazyConnect: true,
  });

  try {
    await testConn.connect();
    await testConn.ping();
    await testConn.disconnect();
    logger.info(`Redis connected successfully at ${config.redis.host}:${config.redis.port}`);
  } catch (err) {
    await testConn.disconnect().catch(() => {});
    logger.warn(`Redis not available at ${config.redis.host}:${config.redis.port} — worker disabled`, {
      error: err.message,
    });
    logger.info('Dashboard and Flow management will work. Execution requires Redis.');
    return null;
  }

  // Redis is available — start the actual worker
  const { Worker } = require('bullmq');
  const FlowExecutor = require('../core/flow-executor');

  const worker = new Worker(
    'flow-execution',
    async (job) => {
      const { flow, executionId } = job.data;

      logger.info(`Worker processing job: ${job.id}`, {
        flowName: flow.name,
        executionId,
      });

      // Create executor with progress reporting
      const executor = new FlowExecutor({
        onProgress: (data) => {
          wsBroadcast(JSON.stringify({
            type: 'execution_progress',
            ...data,
          }));
        },
      });

      // Execute flow
      const result = await executor.execute(flow, executionId);

      // Broadcast final status
      wsBroadcast(JSON.stringify({
        type: 'execution_complete',
        executionId,
        result,
      }));

      return result;
    },
    {
      connection: {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
      },
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 5000,
      },
    }
  );

  worker.on('completed', (job, result) => {
    logger.info(`Job completed: ${job.id}`, { result });
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job failed: ${job?.id}`, { error: err.message });
  });

  worker.on('error', (err) => {
    // Only log once per minute to avoid log spam
    if (!worker._lastErrorLog || Date.now() - worker._lastErrorLog > 60000) {
      logger.error('Worker error', { error: err.message });
      worker._lastErrorLog = Date.now();
    }
  });

  workerInstance = worker;
  logger.info('Background worker started (concurrency=1)');

  return worker;
}

module.exports = { startWorker, setWsBroadcast };
