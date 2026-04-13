/**
 * AI Flow Builder — General Helpers
 */

/**
 * Sleep for given milliseconds
 * @param {number} ms - Milliseconds to wait
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random integer between min and max (inclusive)
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float between min and max
 */
function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Human-like random delay (jittered)
 * @param {number} baseMs - Base delay in milliseconds
 * @param {number} jitter - Jitter percentage (0-1)
 */
function humanDelay(baseMs = 1000, jitter = 0.5) {
  const variation = baseMs * jitter;
  return baseMs + randomInt(-variation, variation);
}

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Sanitize filename (remove unsafe chars)
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9_\-]/gi, '_').substring(0, 100);
}

/**
 * Truncate string with ellipsis
 */
function truncate(str, maxLen = 100) {
  if (!str || str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

module.exports = {
  sleep,
  randomInt,
  randomFloat,
  humanDelay,
  formatDuration,
  sanitizeFilename,
  truncate,
};
