/**
 * AI Flow Builder — Scheduler
 * Auto-repeat flows after successful execution.
 * Timer starts counting AFTER successful completion.
 * Example: 30min interval, flow completes at 9:30 → next run at 10:00.
 * Loop continues until user turns off auto-execution.
 */

const logger = require('../utils/logger');
const sessionWarmer = require('./session-warmer');
const BrowserManager = require('./browser-manager');

class Scheduler {
  constructor() {
    this.timers = new Map();       // flowId -> { timer, nextRun, interval, enabled, running }
    this.executeCallback = null;   // Function to call to execute a flow
    this.wsBroadcast = null;       // WebSocket broadcast for real-time updates
  }

  /**
   * Set the execution callback (called from server.js)
   * @param {function} callback — (flowId) => Promise
   */
  setExecuteCallback(callback) {
    this.executeCallback = callback;
  }

  /**
   * Set WebSocket broadcast function for real-time timer updates
   */
  setWsBroadcast(fn) {
    this.wsBroadcast = fn;
  }

  /**
   * Schedule the next execution of a flow after X minutes
   * Called internally after a successful execution completes.
   * @param {number} flowId
   * @param {number} intervalMinutes
   */
  schedule(flowId, intervalMinutes) {
    // Cancel any existing timer for this flow
    this._clearTimer(flowId);

    if (!intervalMinutes || intervalMinutes <= 0) {
      logger.warn(`Invalid interval for flow ${flowId}: ${intervalMinutes}`);
      return;
    }

    const ms = intervalMinutes * 60 * 1000;
    const nextRun = new Date(Date.now() + ms);

    // ─── Schedule warm-up during the break period ───
    // Run warm-up 5 minutes before the actual execution
    // This builds browsing history during idle time
    let warmupTimer = null;
    const warmupMs = Math.max(ms - (5 * 60 * 1000), ms * 0.5); // 5 min before, or halfway
    if (warmupMs > 60000) { // Only if break is longer than 1 minute
      warmupTimer = setTimeout(async () => {
        try {
          const Flow = require('../models/Flow');
          const flow = Flow.findById(flowId);
          if (!flow || flow.warmUpEnabled === false) return;

          const profileName = flow.profileName || `flow_${flowId}`;
          logger.info(`[SCHEDULER] 🔥 Running break-time warm-up for flow ${flowId}`);

          this._broadcastTimerUpdate(flowId, { warmupStatus: 'running' });

          const bm = new BrowserManager();
          await sessionWarmer.warmUpDuringBreak(bm, profileName);

          this._broadcastTimerUpdate(flowId, { warmupStatus: 'completed' });
          logger.info(`[SCHEDULER] ✅ Break-time warm-up done for flow ${flowId}`);
        } catch (err) {
          logger.warn(`[SCHEDULER] Break-time warm-up failed: ${err.message}`);
          this._broadcastTimerUpdate(flowId, { warmupStatus: 'failed' });
        }
      }, warmupMs);
    }

    const timer = setTimeout(async () => {
      await this._executeAndReschedule(flowId, intervalMinutes);
    }, ms);

    // Preserve enabled state
    const existing = this.timers.get(flowId);
    this.timers.set(flowId, {
      timer,
      warmupTimer,
      nextRun,
      interval: intervalMinutes,
      enabled: true,
      running: false,
      waitingForExecution: false,
    });

    logger.info(`[SCHEDULER] Flow ${flowId} → next execution at ${nextRun.toLocaleTimeString()} (in ${intervalMinutes} min)`);
    this._broadcastTimerUpdate(flowId);
  }

  /**
   * Cancel a scheduled timer (clears timeout only, keeps config if needed)
   */
  _clearTimer(flowId) {
    const existing = this.timers.get(flowId);
    if (existing) {
      if (existing.timer) {
        clearTimeout(existing.timer);
        existing.timer = null;
      }
      if (existing.warmupTimer) {
        clearTimeout(existing.warmupTimer);
        existing.warmupTimer = null;
      }
    }
  }

  /**
   * Cancel and remove a flow's timer completely
   */
  cancel(flowId) {
    this._clearTimer(flowId);
    this.timers.delete(flowId);
    logger.info(`[SCHEDULER] Cancelled timer for flow ${flowId}`);
    this._broadcastTimerUpdate(flowId);
  }

  /**
   * Enable or disable auto-execution for a flow.
   * When enabled, execution does NOT start immediately — it waits for
   * the first manual/triggered execution to complete, then starts the loop.
   */
  setEnabled(flowId, enabled, intervalMinutes) {
    if (enabled && intervalMinutes > 0) {
      // Don't start timer yet — store config and wait for first successful execution
      this._clearTimer(flowId);
      this.timers.set(flowId, {
        timer: null,
        nextRun: null,
        interval: intervalMinutes,
        enabled: true,
        running: false,
        waitingForExecution: true,
      });
      logger.info(`[SCHEDULER] Timer ENABLED for flow ${flowId}: ${intervalMinutes} min interval (waiting for first execution)`);
    } else {
      this.cancel(flowId);
      // Also update DB
      try {
        const db = require('../models/database');
        db.prepare('UPDATE flows SET timer_enabled = 0, timer_interval_min = 0 WHERE id = ?').run(flowId);
      } catch (e) {}
      logger.info(`[SCHEDULER] Timer DISABLED for flow ${flowId}`);
    }
    this._broadcastTimerUpdate(flowId);
  }

  /**
   * Called when a flow execution completes successfully.
   * If timer is enabled for this flow, schedule the next run.
   */
  onFlowCompleted(flowId) {
    const config = this.timers.get(flowId);
    if (!config || !config.enabled) return;

    config.running = false;
    config.waitingForExecution = false;

    logger.info(`[SCHEDULER] Flow ${flowId} completed successfully. Scheduling next run in ${config.interval} minutes.`);
    this.schedule(flowId, config.interval);
  }

  /**
   * Called when a flow execution fails.
   * Timer stays enabled but doesn't re-schedule (waits for manual retry).
   */
  onFlowFailed(flowId) {
    const config = this.timers.get(flowId);
    if (!config || !config.enabled) return;

    config.running = false;
    config.waitingForExecution = true;
    config.nextRun = null;
    this._clearTimer(flowId);

    logger.info(`[SCHEDULER] Flow ${flowId} failed. Timer paused — will resume after next successful execution.`);
    this._broadcastTimerUpdate(flowId);
  }

  /**
   * Get timer status for a specific flow
   */
  getStatus(flowId) {
    const config = this.timers.get(flowId);
    if (!config) {
      return { enabled: false, interval: 0, nextRun: null, running: false, waitingForExecution: false };
    }

    return {
      enabled: config.enabled,
      interval: config.interval,
      nextRun: config.nextRun ? config.nextRun.toISOString() : null,
      running: config.running || false,
      waitingForExecution: config.waitingForExecution || false,
      timeRemaining: config.nextRun ? Math.max(0, config.nextRun.getTime() - Date.now()) : null,
    };
  }

  /**
   * Get all active timer statuses
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
        logger.info(`[SCHEDULER] Loaded timer: flow "${row.name}" → ${row.timer_interval_min} min`);
      }

      if (rows.length > 0) {
        logger.info(`[SCHEDULER] Loaded ${rows.length} timer(s) from database`);
      }
    } catch (err) {
      logger.warn('[SCHEDULER] Could not load timer configs from DB', { error: err.message });
    }
  }

  // ─── Private ────────────────────────────────────

  async _executeAndReschedule(flowId, intervalMinutes) {
    try {
      const Flow = require('../models/Flow');
      const flow = Flow.findById(flowId);
      if (!flow) {
        logger.warn(`[SCHEDULER] Flow ${flowId} not found, cancelling timer`);
        this.cancel(flowId);
        return;
      }

      if (!this.executeCallback) {
        logger.warn('[SCHEDULER] No execute callback set, cannot auto-run flow');
        return;
      }

      // Mark as running
      const config = this.timers.get(flowId);
      if (config) {
        config.running = true;
        config.nextRun = null;
      }
      this._broadcastTimerUpdate(flowId);

      logger.info(`[SCHEDULER] ⏱️ Auto-executing flow "${flow.name}" (ID: ${flowId})`);
      await this.executeCallback(flowId);

      // Note: onFlowCompleted() will be called by the worker when execution succeeds,
      // which will re-schedule. If it fails, onFlowFailed() is called.
    } catch (err) {
      logger.error(`[SCHEDULER] Auto-execution failed for flow ${flowId}`, { error: err.message });
      // Mark as waiting (failed)
      const config = this.timers.get(flowId);
      if (config) {
        config.running = false;
        config.waitingForExecution = true;
      }
      this._broadcastTimerUpdate(flowId);
    }
  }

  /**
   * Broadcast timer status update via WebSocket
   */
  _broadcastTimerUpdate(flowId, extra = {}) {
    if (!this.wsBroadcast) return;
    try {
      this.wsBroadcast(JSON.stringify({
        type: 'timer_update',
        flowId,
        ...this.getStatus(flowId),
        ...extra,
      }));
    } catch (e) {}
  }
}

// Singleton
module.exports = new Scheduler();
