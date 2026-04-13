/**
 * AI Flow Builder — Background Worker
 * Processes flow execution jobs from the BullMQ queue.
 * Runs as a separate process or within the main server.
 */

const { Worker } = require('bullmq');
const config = require('../config');
const logger = require('../utils/logger');
const FlowExecutor = require('../core/flow-executor');

// WebSocket broadcast function (set from server.js)
let wsBroadcast = () => {};

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

/**
 * Start the background worker
 */
function startWorker() {
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
          // Broadcast progress to all connected WebSocket clients
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
      concurrency: 1, // Only one flow at a time (one browser)
      limiter: {
        max: 1,
        duration: 5000, // Max 1 job per 5 seconds
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
    logger.error('Worker error', { error: err.message });
  });

  logger.info('Background worker started (concurrency=1)');

  return worker;
}

module.exports = { startWorker, setWsBroadcast };
