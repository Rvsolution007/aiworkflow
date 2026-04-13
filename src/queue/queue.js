/**
 * AI Flow Builder — Job Queue
 * Manages background flow execution using BullMQ + Redis.
 */

const { Queue } = require('bullmq');
const config = require('../config');
const logger = require('../utils/logger');

let flowQueue = null;

/**
 * Get or create the flow execution queue
 */
function getQueue() {
  if (!flowQueue) {
    flowQueue = new Queue('flow-execution', {
      connection: {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        attempts: 1,            // Don't auto-retry flows (we handle retries per-step)
        removeOnComplete: 100,  // Keep last 100 completed jobs
        removeOnFail: 100,      // Keep last 100 failed jobs
        timeout: 600000,        // 10 minute max per flow
      },
    });

    logger.info('Flow execution queue initialized');
  }

  return flowQueue;
}

/**
 * Add a flow execution job to the queue
 * @param {object} data - { flow, executionId }
 * @returns {object} Job
 */
async function addFlowJob(data) {
  const queue = getQueue();
  const job = await queue.add('execute-flow', data, {
    jobId: `exec_${data.executionId}`,
  });
  logger.info(`Flow job added to queue`, { jobId: job.id, executionId: data.executionId });
  return job;
}

/**
 * Get queue stats
 */
async function getQueueStats() {
  const queue = getQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

module.exports = { getQueue, addFlowJob, getQueueStats };
