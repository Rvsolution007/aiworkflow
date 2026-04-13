/**
 * AI Flow Builder — Execution Model
 * Tracks flow execution history, step-by-step progress, and screenshots.
 */

const db = require('./database');

const Execution = {
  /**
   * Create a new execution record
   */
  create({ flow_id, flow_name, total_steps }) {
    const stmt = db.prepare(`
      INSERT INTO executions (flow_id, flow_name, status, total_steps)
      VALUES (?, ?, 'queued', ?)
    `);
    const result = stmt.run(flow_id, flow_name, total_steps);
    return this.findById(result.lastInsertRowid);
  },

  /**
   * Find execution by ID (with steps)
   */
  findById(id) {
    const execution = db.prepare('SELECT * FROM executions WHERE id = ?').get(id);
    if (!execution) return null;

    execution.steps = db.prepare(
      'SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY step_index ASC'
    ).all(id);

    return execution;
  },

  /**
   * Get all executions (without steps, for listing)
   */
  findAll(limit = 50) {
    return db.prepare(
      'SELECT * FROM executions ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  },

  /**
   * Update execution status
   */
  updateStatus(id, status, errorMessage = null) {
    const updates = { status };
    if (status === 'running') updates.started_at = new Date().toISOString();
    if (['completed', 'failed', 'cancelled'].includes(status)) updates.completed_at = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE executions SET
        status = ?,
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        error_message = COALESCE(?, error_message)
      WHERE id = ?
    `);

    stmt.run(
      updates.status,
      updates.started_at || null,
      updates.completed_at || null,
      errorMessage,
      id
    );
  },

  /**
   * Update current step progress
   */
  updateProgress(id, currentStep) {
    db.prepare('UPDATE executions SET current_step = ? WHERE id = ?').run(currentStep, id);
  },

  /**
   * Add a step log entry
   */
  addStep({ execution_id, step_index, action, description }) {
    const stmt = db.prepare(`
      INSERT INTO execution_steps (execution_id, step_index, action, description, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)
    `);
    return stmt.run(execution_id, step_index, action, description, new Date().toISOString());
  },

  /**
   * Update a step's status
   */
  updateStep(execution_id, step_index, { status, screenshot_path, error_message, duration_ms }) {
    const stmt = db.prepare(`
      UPDATE execution_steps SET
        status = COALESCE(?, status),
        screenshot_path = COALESCE(?, screenshot_path),
        error_message = COALESCE(?, error_message),
        duration_ms = COALESCE(?, duration_ms),
        completed_at = ?
      WHERE execution_id = ? AND step_index = ?
    `);

    stmt.run(
      status || null,
      screenshot_path || null,
      error_message || null,
      duration_ms || null,
      ['completed', 'failed', 'skipped'].includes(status) ? new Date().toISOString() : null,
      execution_id,
      step_index
    );
  },

  /**
   * Delete old executions (cleanup)
   */
  cleanup(keepDays = 30) {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
    return db.prepare('DELETE FROM executions WHERE created_at < ?').run(cutoff);
  },
};

module.exports = Execution;
