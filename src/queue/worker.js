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
  const Execution = require('../models/Execution');

  const worker = new Worker(
    'flow-execution',
    async (job) => {
      const { flow, executionId } = job.data;

      logger.info(`[WORKER] ===== Processing job: ${job.id} =====`, {
        flowName: flow.name,
        executionId,
        totalSteps: flow.steps?.length,
      });

      // Broadcast that we started
      wsBroadcast(JSON.stringify({
        type: 'execution_progress',
        event: 'status',
        executionId,
        status: 'running',
        message: 'Worker picked up job — Launching browser...',
      }));

      try {
        // Create executor with progress reporting
        const executor = new FlowExecutor({
          onProgress: (data) => {
            logger.info(`[WORKER] Progress event: ${data.event}`, {
              executionId,
              step: data.step,
              status: data.status,
            });
            wsBroadcast(JSON.stringify({
              type: 'execution_progress',
              ...data,
            }));
          },
        });

        // Execute flow
        const result = await executor.execute(flow, executionId);

        logger.info(`[WORKER] Flow execution finished`, {
          executionId,
          status: result.status,
          error: result.error || null,
        });

        // Broadcast final status
        wsBroadcast(JSON.stringify({
          type: 'execution_complete',
          executionId,
          result,
        }));

        return result;
      } catch (execError) {
        logger.error(`[WORKER] Flow execution crashed`, {
          executionId,
          error: execError.message,
          stack: execError.stack,
        });

        // Update execution status to failed
        try {
          Execution.updateStatus(executionId, 'failed', execError.message);
        } catch (e) { /* ignore */ }

        // Broadcast error to frontend
        wsBroadcast(JSON.stringify({
          type: 'execution_progress',
          event: 'status',
          executionId,
          status: 'failed',
          message: `❌ ${execError.message}`,
        }));

        wsBroadcast(JSON.stringify({
          type: 'execution_complete',
          executionId,
          result: {
            status: 'failed',
            error: execError.message,
            failedStep: 0,
            details: execError.stack?.split('\n').slice(0, 3).join(' → '),
          },
        }));

        throw execError; // Re-throw so BullMQ marks it as failed
      }
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
    logger.info(`[WORKER] Job completed: ${job.id}`, { 
      status: result?.status,
      duration: result?.duration,
    });
    // Notify scheduler for auto-repeat
    if (result?.status === 'completed' && job?.data?.flow?.id) {
      try {
        const scheduler = require('../core/scheduler');
        scheduler.onFlowCompleted(job.data.flow.id);
      } catch (e) {}
    }
  });

  worker.on('failed', (job, err) => {
    logger.error(`[WORKER] Job failed: ${job?.id}`, { 
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join(' | '),
    });

    // Also broadcast failure to frontend with full error details
    if (job?.data?.executionId) {
      wsBroadcast(JSON.stringify({
        type: 'execution_complete',
        executionId: job.data.executionId,
        result: {
          status: 'failed',
          error: err.message,
          details: err.stack?.split('\n').slice(0, 3).join(' → '),
        },
      }));
    }
  });

  worker.on('error', (err) => {
    // Only log once per minute to avoid log spam
    if (!worker._lastErrorLog || Date.now() - worker._lastErrorLog > 60000) {
      logger.error('[WORKER] Worker error', { error: err.message });
      worker._lastErrorLog = Date.now();
    }
  });

  worker.on('active', (job) => {
    logger.info(`[WORKER] Job active: ${job.id}`);
  });

  workerInstance = worker;
  logger.info('[WORKER] Background worker started (concurrency=1)');

  return worker;
}

module.exports = { startWorker, setWsBroadcast };
