/**
 * AI Flow Builder — Express Server
 * Main application entry point.
 * Serves the web dashboard + REST API + WebSocket for live updates.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const config = require('./config');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const { startWorker, setWsBroadcast } = require('./queue/worker');

// ─── Express App ───────────────────────────────────────

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files (dashboard)
app.use(express.static(config.paths.public));

// Serve screenshots
app.use('/screenshots', express.static(config.paths.screenshots));

// API routes
app.use('/api', apiRoutes);

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

// ─── WebSocket Server ──────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  logger.info(`WebSocket client connected (total: ${clients.size})`);

  ws.on('close', () => {
    clients.delete(ws);
    logger.info(`WebSocket client disconnected (total: ${clients.size})`);
  });

  ws.on('error', (err) => {
    logger.error('WebSocket error', { error: err.message });
    clients.delete(ws);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to AI Flow Builder',
    timestamp: new Date().toISOString(),
  }));
});

// Broadcast function for worker
function broadcast(data) {
  const message = typeof data === 'string' ? data : JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  }
}

// Share broadcast with worker
setWsBroadcast(broadcast);

// ─── Start Server + Worker ─────────────────────────────

async function start() {
  try {
    // Initialize database (happens on require)
    require('./models/database');

    // Auto-seed default flow if it doesn't exist yet
    try {
      const Flow = require('./models/Flow');
      const existing = Flow.search('Cancel & Renew AI Ultra');
      if (existing.length === 0) {
        logger.info('Seeding default Google Workspace flow...');
        Flow.create({
          name: 'Cancel & Renew AI Ultra Subscription',
          description: 'Cancel Google AI Ultra subscription and buy a new one from Workspace store',
          category: 'google-admin',
          steps: [
            { action: 'navigate', description: 'Open Google Admin Console', params: { url: 'https://admin.google.com/' } },
            { action: 'conditional_login', description: 'Login if required', params: { credential_key: 'google_admin' } },
            { action: 'click', description: 'Click Billing', params: { selector: 'text=Billing' } },
            { action: 'wait', description: 'Wait for page load', params: { duration: 3000 } },
            { action: 'click', description: 'Click Subscriptions', params: { selector: 'text=Subscriptions' } },
            { action: 'wait', description: 'Wait for subscriptions', params: { duration: 3000 } },
            { action: 'click', description: 'Click AI Ultra Access', params: { selector: 'text=AI Ultra Access' } },
            { action: 'wait', description: 'Wait for details', params: { duration: 2000 } },
            { action: 'click', description: 'Click Cancel subscription', params: { selector: 'text=Cancel subscription' } },
            { action: 'wait', description: 'Wait for dialog', params: { duration: 2000 } },
            { action: 'click', description: 'Select Too expensive', params: { selector: 'text=Too expensive' } },
            { action: 'click', description: 'Check confirmation checkbox', params: { selector: 'text=I have read the information above and want to proceed with canceling my subscription' } },
            { action: 'wait', description: 'Wait', params: { duration: 1000 } },
            { action: 'type', description: 'Enter email for confirmation', params: { selector: 'input[type="email"], input[name="email"]', text: 'antigravity97732@gmail.com', clear: true } },
            { action: 'click', description: 'Click Cancel my subscription', params: { selector: 'text=Cancel my subscription' } },
            { action: 'wait', description: 'Wait 1 min for cancellation', params: { duration: 60000 } },
            { action: 'navigate', description: 'Open AI Ultra plans page', params: { url: 'https://workspace.google.com/intl/en_in/products/ai-ultra/#plans' } },
            { action: 'wait', description: 'Wait for plans page', params: { duration: 3000 } },
            { action: 'click', description: 'Click Buy now', params: { selector: 'text=Buy now' } },
            { action: 'wait', description: 'Wait for checkout', params: { duration: 3000 } },
            { action: 'click', description: 'Click Continue', params: { selector: 'text=Continue' } },
            { action: 'wait', description: 'Wait for Review page', params: { duration: 3000 } },
            { action: 'click', description: 'Click Agree and continue', params: { selector: 'text=Agree and continue' } },
            { action: 'wait', description: 'Wait for Add funds popup', params: { duration: 3000 } },
            { action: 'click', description: 'Click Continue (Add funds)', params: { selector: 'text=Continue' } },
            { action: 'wait', description: 'Wait for redirect', params: { duration: 3000 } },
            { action: 'click', description: 'Click Continue to admin console', params: { selector: 'text=Continue to admin console' } },
            { action: 'wait', description: 'Wait for success', params: { duration: 3000 } },
            { action: 'screenshot', description: 'Screenshot success page', params: {} },
          ],
        });
        logger.info('Default flow seeded successfully!');
      } else {
        logger.info(`Default flow already exists (${existing.length} found), skipping seed.`);
      }
    } catch (seedErr) {
      logger.warn('Flow seed failed', { error: seedErr.message });
    }

    // Start background worker (async — won't crash if Redis is down)
    try {
      await startWorker();
    } catch (err) {
      logger.warn('Could not start background worker (Redis may not be running)', {
        error: err.message,
      });
      logger.info('Flows will still be created/managed, but execution requires Redis');
    }

    // Start HTTP server
    server.listen(config.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║           AI Flow Builder Started! 🚀             ║
╠══════════════════════════════════════════════════╣
║  Dashboard:  http://localhost:${config.port}              ║
║  API:        http://localhost:${config.port}/api           ║
║  WebSocket:  ws://localhost:${config.port}/ws              ║
║  Mode:       ${config.isDev ? 'Development' : 'Production'}                       ║
╚══════════════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});

start();
