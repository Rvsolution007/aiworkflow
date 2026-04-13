/**
 * AI Flow Builder — Flow Model
 * CRUD operations for automation flows.
 */

const db = require('./database');

const Flow = {
  /**
   * Create a new flow
   */
  create({ name, description = '', steps = [], category = 'general' }) {
    const stmt = db.prepare(`
      INSERT INTO flows (name, description, steps, category)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(name, description, JSON.stringify(steps), category);
    return this.findById(result.lastInsertRowid);
  },

  /**
   * Find flow by ID
   */
  findById(id) {
    const row = db.prepare('SELECT * FROM flows WHERE id = ?').get(id);
    if (row) row.steps = JSON.parse(row.steps);
    return row || null;
  },

  /**
   * Get all flows (with optional category filter)
   */
  findAll(category = null) {
    let rows;
    if (category) {
      rows = db.prepare('SELECT * FROM flows WHERE category = ? ORDER BY updated_at DESC').all(category);
    } else {
      rows = db.prepare('SELECT * FROM flows ORDER BY updated_at DESC').all();
    }
    return rows.map(row => ({ ...row, steps: JSON.parse(row.steps) }));
  },

  /**
   * Update a flow
   */
  update(id, { name, description, steps, category, is_favorite }) {
    const existing = this.findById(id);
    if (!existing) return null;

    const stmt = db.prepare(`
      UPDATE flows SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        steps = COALESCE(?, steps),
        category = COALESCE(?, category),
        is_favorite = COALESCE(?, is_favorite),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      name || null,
      description !== undefined ? description : null,
      steps ? JSON.stringify(steps) : null,
      category || null,
      is_favorite !== undefined ? (is_favorite ? 1 : 0) : null,
      id
    );
    return this.findById(id);
  },

  /**
   * Delete a flow
   */
  delete(id) {
    return db.prepare('DELETE FROM flows WHERE id = ?').run(id);
  },

  /**
   * Search flows by name
   */
  search(query) {
    const rows = db.prepare('SELECT * FROM flows WHERE name LIKE ? ORDER BY updated_at DESC').all(`%${query}%`);
    return rows.map(row => ({ ...row, steps: JSON.parse(row.steps) }));
  },
};

module.exports = Flow;
