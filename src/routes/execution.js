/**
 * AI Flow Builder — Execution Routes
 * Flow execution control and history.
 */

const express = require('express');
const router = express.Router();
const Flow = require('../models/Flow');
const Execution = require('../models/Execution');
const logger = require('../utils/logger');

/**
 * POST /api/execute/:flowId
 * Queue a flow for background execution
 */
router.post('/:flowId', async (req, res) => {
  try {
    const flowId = parseInt(req.params.flowId);
    const flow = Flow.findById(flowId);

    if (!flow) {
      return res.status(404).json({ success: false, error: 'Flow not found' });
    }

    // Create execution record
    const execution = Execution.create({
      flow_id: flowId,
      flow_name: flow.name,
      total_steps: flow.steps.length,
    });

    // Try to add to background queue (Redis required)
    try {
      const { addFlowJob } = require('../queue/queue');
      await addFlowJob({
        flow,
        executionId: execution.id,
      });

      logger.info(`Flow queued for execution`, {
        flowId,
        executionId: execution.id,
      });

      res.json({
        success: true,
        execution,
        message: 'Flow queued for execution',
      });
    } catch (queueErr) {
      // Redis/Queue error — update execution status and return clear error
      logger.error('Queue error — Redis may not be available', { error: queueErr.message });
      
      // Update execution to failed
      try {
        Execution.updateStatus(execution.id, 'failed');
      } catch (e) { /* ignore */ }

      res.status(503).json({
        success: false,
        error: `Redis connection failed: ${queueErr.message}`,
        details: 'The background job queue requires Redis. Please ensure the Redis service is running and REDIS_HOST is correctly configured in EasyPanel environment variables.',
        execution,
      });
    }
  } catch (err) {
    logger.error('Execution route error', { error: err.message, stack: err.stack });
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: 'An unexpected error occurred while trying to execute the flow.',
    });
  }
});

/**
 * GET /api/executions
 * List all executions
 */
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const executions = Execution.findAll(limit);
    res.json({ success: true, executions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/executions/:id
 * Get execution details with step logs
 */
router.get('/:id', (req, res) => {
  try {
    const execution = Execution.findById(parseInt(req.params.id));
    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' });
    }
    res.json({ success: true, execution });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/executions/queue/stats
 * Get queue statistics
 */
router.get('/queue/stats', async (req, res) => {
  try {
    const { getQueueStats } = require('../queue/queue');
    const stats = await getQueueStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(503).json({ 
      success: false, 
      error: 'Queue not available',
      details: err.message,
      stats: { waiting: 0, active: 0, completed: 0, failed: 0 },
    });
  }
});

/**
 * GET /api/executions/:id/screenshot/:stepIndex
 * Get screenshot for a specific step
 */
router.get('/:id/screenshot/:stepIndex', (req, res) => {
  try {
    const execution = Execution.findById(parseInt(req.params.id));
    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' });
    }

    const step = execution.steps.find(s => s.step_index === parseInt(req.params.stepIndex));
    if (!step || !step.screenshot_path) {
      return res.status(404).json({ success: false, error: 'Screenshot not found' });
    }

    res.sendFile(step.screenshot_path);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
