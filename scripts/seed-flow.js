/**
 * Seed script — Adds the Google Workspace subscription flow.
 * Run once: node scripts/seed-flow.js
 * Or called from server startup.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Initialize DB
require('../src/models/database');
const Flow = require('../src/models/Flow');

// Check if flow already exists
const existing = Flow.search('Cancel & Renew AI Ultra');
if (existing.length > 0) {
  console.log('Flow already exists, skipping seed.');
  process.exit(0);
}

const flow = Flow.create({
  name: 'Cancel & Renew AI Ultra Subscription',
  description: 'Cancel Google AI Ultra subscription and buy a new one from Workspace store',
  category: 'google-admin',
  steps: [
    {
      action: 'navigate',
      description: 'Open Google Admin Console',
      params: { url: 'https://admin.google.com/' }
    },
    {
      action: 'conditional_login',
      description: 'Login if required (using stored Google Admin credentials)',
      params: { credential_key: 'google_admin' }
    },
    {
      action: 'click',
      description: 'Click on Billing in the sidebar',
      params: { selector: 'text=Billing' }
    },
    {
      action: 'wait',
      description: 'Wait for page to load',
      params: { duration: 3000 }
    },
    {
      action: 'click',
      description: 'Click on Subscriptions',
      params: { selector: 'text=Subscriptions' }
    },
    {
      action: 'wait',
      description: 'Wait for subscriptions to load',
      params: { duration: 3000 }
    },
    {
      action: 'click',
      description: 'Click on AI Ultra Access subscription',
      params: { selector: 'text=AI Ultra Access' }
    },
    {
      action: 'wait',
      description: 'Wait for subscription details',
      params: { duration: 2000 }
    },
    {
      action: 'click',
      description: 'Click Cancel subscription',
      params: { selector: 'text=Cancel subscription' }
    },
    {
      action: 'wait',
      description: 'Wait for cancellation dialog',
      params: { duration: 2000 }
    },
    {
      action: 'click',
      description: 'Select reason: Too expensive',
      params: { selector: 'text=Too expensive' }
    },
    {
      action: 'click',
      description: 'Check confirmation: I have read the information above and want to proceed',
      params: { selector: 'text=I have read the information above and want to proceed with canceling my subscription' }
    },
    {
      action: 'wait',
      description: 'Wait for confirmation options',
      params: { duration: 1000 }
    },
    {
      action: 'type',
      description: 'Enter email address for confirmation',
      params: { 
        selector: 'input[type="email"], input[name="email"], input[aria-label*="email"]',
        text: 'antigravity97732@gmail.com',
        clear: true
      }
    },
    {
      action: 'click',
      description: 'Click Cancel my subscription button',
      params: { selector: 'text=Cancel my subscription' }
    },
    {
      action: 'wait',
      description: 'Wait 1 minute for cancellation to process',
      params: { duration: 60000 }
    },
    {
      action: 'navigate',
      description: 'Open Google Workspace AI Ultra plans page',
      params: { url: 'https://workspace.google.com/intl/en_in/products/ai-ultra/#plans' }
    },
    {
      action: 'wait',
      description: 'Wait for plans page to load',
      params: { duration: 3000 }
    },
    {
      action: 'click',
      description: 'Click Buy now button',
      params: { selector: 'text=Buy now' }
    },
    {
      action: 'wait',
      description: 'Wait for checkout page',
      params: { duration: 3000 }
    },
    {
      action: 'click',
      description: 'Click Continue button',
      params: { selector: 'text=Continue' }
    },
    {
      action: 'wait',
      description: 'Wait for Review and checkout page',
      params: { duration: 3000 }
    },
    {
      action: 'click',
      description: 'Click Agree and continue on Review page',
      params: { selector: 'text=Agree and continue' }
    },
    {
      action: 'wait',
      description: 'Wait for Add funds popup',
      params: { duration: 3000 }
    },
    {
      action: 'click',
      description: 'Click Continue on Add funds popup',
      params: { selector: 'text=Continue' }
    },
    {
      action: 'wait',
      description: 'Wait for admin console redirect',
      params: { duration: 3000 }
    },
    {
      action: 'click',
      description: 'Click Continue to admin console',
      params: { selector: 'text=Continue to admin console' }
    },
    {
      action: 'wait',
      description: 'Wait for success page',
      params: { duration: 3000 }
    },
    {
      action: 'screenshot',
      description: 'Take screenshot of success message',
      params: {}
    }
  ],
});

console.log(`✅ Flow created: "${flow.name}" (ID: ${flow.id}) — ${flow.steps.length} steps`);
process.exit(0);
