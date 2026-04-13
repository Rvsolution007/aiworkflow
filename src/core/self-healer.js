/**
 * AI Flow Builder — Self Healer
 * When a step fails, captures screenshot and asks AI for alternative approach.
 * Provides "self-healing" capability — adapts to UI changes automatically.
 */

const AIEngine = require('./ai-engine');
const logger = require('../utils/logger');

class SelfHealer {
  constructor() {
    this.ai = new AIEngine();
    this.maxRetries = 3;
  }

  /**
   * Attempt to heal a failed step
   * @param {object} browserManager - BrowserManager instance
   * @param {object} failedStep - The step that failed
   * @param {string} errorMessage - Error description
   * @returns {object|null} Healed step or null if healing failed
   */
  async heal(browserManager, failedStep, errorMessage) {
    logger.info('Self-healer activated', {
      action: failedStep.action,
      error: errorMessage,
    });

    try {
      // Take a screenshot of current state
      const screenshotPath = await browserManager.screenshot(`heal_${Date.now()}`);

      // Ask AI for alternative approach
      const fix = await this.ai.healStep(screenshotPath, failedStep, errorMessage);

      if (fix && fix.confidence > 0.5) {
        logger.info('Self-healer found fix', {
          action: fix.action,
          confidence: fix.confidence,
          description: fix.description,
        });
        return fix;
      }

      logger.warn('Self-healer could not find confident fix', { confidence: fix?.confidence });
      return null;
    } catch (err) {
      logger.error('Self-healer error', { error: err.message });
      return null;
    }
  }
}

module.exports = SelfHealer;
