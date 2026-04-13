/**
 * AI Flow Builder — Scheduler
 * Auto-repeat flows after successful execution.
 * User sets interval (e.g., 40 minutes), flow loops until turned off.
 */

const logger = require('../utils/logger');
const Flow = require('../models/Flow');

class Scheduler {
  constructor() {
    this.timers = new Map();       // flowId -> { timer, nextRun, interval, enabled }
    this.executeCallback = null;   // Function to call to execute a flow
  }

  /**
   * Set the execution callback (called from server.js)
   * @param {function} callback — (flowId) => Promise
   */
  setExecuteCallback(callback) {
    this.executeCallback = callback;
  }

  /**
   * Schedule a flow to repeat after X minutes
   * @param {number} flowId
   * @param {number} intervalMinutes
   */
  schedule(flowId, intervalMinutes) {
    // Cancel existing timer
    this.cancel(flowId);

    if (!intervalMinutes || intervalMinutes <= 0) {
      logger.warn(`Invalid interval for flow ${flowId}: ${intervalMinutes}`);
      return;
    }

    const ms = intervalMinutes * 60 * 1000;
    const nextRun = new Date(Date.now() + ms);

    const timer = setTimeout(async () => {
      await this._executeAndReschedule(flowId, intervalMinutes);
    }, ms);

    this.timers.set(flowId, {
      timer,
      nextRun,
      interval: intervalMinutes,
      enabled: true,
    });

    logger.info(`Scheduled flow ${flowId} to repeat every ${intervalMinutes} minutes. Next run: ${nextRun.toLocaleTimeString()}`);
  }

  /**
   * Cancel a scheduled flow
   */
  cancel(flowId) {
    const existing = this.timers.get(flowId);
    if (existing) {
      clearTimeout(existing.timer);
      this.timers.delete(flowId);
      logger.info(`Cancelled schedule for flow ${flowId}`);
    }
  }

  /**
   * Enable/disable timer for a flow
   */
  setEnabled(flowId, enabled, intervalMinutes) {
    if (enabled && intervalMinutes > 0) {
      // Note: don't schedule immediately — schedule after next successful execution
      // Just store the config
      this.timers.set(flowId, {
        timer: null,
        nextRun: null,
        interval: intervalMinutes,
        enabled: true,
        waitingForExecution: true,
      });
      logger.info(`Timer enabled for flow ${flowId}: ${intervalMinutes} min interval (will start after next successful execution)`);
    } else {
      this.cancel(flowId);
      logger.info(`Timer disabled for flow ${flowId}`);
    }
  }

  /**
   * Called when a flow execution completes successfully.
   * If timer is enabled, schedule the next run.
   */
  onFlowCompleted(flowId) {
    const config = this.timers.get(flowId);
    if (!config || !config.enabled) return;

    logger.info(`Flow ${flowId} completed. Scheduling next run in ${config.interval} minutes.`);
    this.schedule(flowId, config.interval);
  }

  /**
   * Get timer status for a flow
   */
  getStatus(flowId) {
    const config = this.timers.get(flowId);
    if (!config) {
      return { enabled: false, interval: 0, nextRun: null };
    }

    return {
      enabled: config.enabled,
      interval: config.interval,
      nextRun: config.nextRun ? config.nextRun.toISOString() : null,
      waitingForExecution: config.waitingForExecution || false,
      timeRemaining: config.nextRun ? Math.max(0, config.nextRun.getTime() - Date.now()) : null,
    };
  }

  /**
   * Get all active timers
   */
  getAllTimers() {
    const result = [];
    for (const [flowId, config] of this.timers) {
      result.push({
        flowId,
        ...this.getStatus(flowId),
      });
    }
    return result;
  }

  /**
   * Load saved timer configs from database on startup
   */
  loadFromDB() {
    try {
      const db = require('../models/database');
      const rows = db.prepare(`
        SELECT id, name, timer_enabled, timer_interval_min 
        FROM flows 
        WHERE timer_enabled = 1 AND timer_interval_min > 0
      `).all();

      for (const row of rows) {
        this.setEnabled(row.id, true, row.timer_interval_min);
        logger.info(`Loaded timer config for flow "${row.name}": ${row.timer_interval_min} min`);
      }

      if (rows.length > 0) {
        logger.info(`Loaded ${rows.length} timer config(s) from database`);
      }
    } catch (err) {
      logger.warn('Could not load timer configs from DB', { error: err.message });
    }
  }

  // ─── Private ────────────────────────────────────

  async _executeAndReschedule(flowId, intervalMinutes) {
    try {
      const flow = Flow.findById(flowId);
      if (!flow) {
        logger.warn(`Scheduled flow ${flowId} not found, cancelling timer`);
        this.cancel(flowId);
        return;
      }

      if (!this.executeCallback) {
        logger.warn('No execute callback set, cannot auto-run flow');
        return;
      }

      logger.info(`[SCHEDULER] Auto-executing flow "${flow.name}" (ID: ${flowId})`);
      await this.executeCallback(flowId);

      // Note: onFlowCompleted() will be called by the worker when execution succeeds,
      // which will re-schedule. If it fails, it won't re-schedule.
    } catch (err) {
      logger.error(`[SCHEDULER] Auto-execution failed for flow ${flowId}`, { error: err.message });
      // Don't re-schedule on failure
    }
  }
}

// Singleton
module.exports = new Scheduler();
