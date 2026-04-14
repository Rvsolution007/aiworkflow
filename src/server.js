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

// Import recorder for remote browser control
const recorder = require('./core/recorder');

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

  // Handle incoming messages from frontend (remote browser control)
  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());

      switch (msg.type) {
        case 'remote_click':
          recorder.handleRemoteClick(msg.x, msg.y);
          break;
        case 'remote_type':
          recorder.handleRemoteType(msg.text);
          break;
        case 'remote_key':
          recorder.handleRemoteKeyPress(msg.key);
          break;
        case 'remote_scroll':
          recorder.handleRemoteScroll(msg.deltaX || 0, msg.deltaY || 0);
          break;
        case 'remote_navigate':
          recorder.handleRemoteNavigate(msg.url);
          break;
        case 'remote_mousemove':
          recorder.handleRemoteMouseMove(msg.x, msg.y);
          break;
        default:
          // Ignore unknown messages
          break;
      }
    } catch (err) {
      logger.warn('WebSocket message handler error', { error: err.message });
    }
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

// Share broadcast with recorder
const { setRecorderBroadcast } = require('./routes/recorder');
setRecorderBroadcast(broadcast);

// Setup scheduler
const scheduler = require('./core/scheduler');
const Execution = require('./models/Execution');
scheduler.setWsBroadcast(broadcast);

// ─── Start Server + Worker ─────────────────────────────

async function start() {
  try {
    // Initialize database (happens on require)
    require('./models/database');

    // Auto-seed or update default flow
    try {
      const Flow = require('./models/Flow');
      const FLOW_VERSION = 2; // Increment this when steps change
      const flowSteps = [
        { action: 'navigate', description: 'Open Google Admin Console', params: { url: 'https://admin.google.com/' } },
        { action: 'conditional_login', description: 'Login if required', params: { credential_key: 'google_admin' } },
        // Direct URL navigation — bypasses sidebar popups!
        { action: 'navigate', description: 'Go to Billing > Subscriptions', params: { url: 'https://admin.google.com/ac/billing/subscriptions' } },
        { action: 'wait', description: 'Wait for subscriptions page', params: { duration: 5000 } },
        { action: 'click', description: 'Click AI Ultra Access', params: { selector: 'text=AI Ultra Access' } },
        { action: 'wait', description: 'Wait for details', params: { duration: 3000 } },
        { action: 'click', description: 'Click Cancel subscription', params: { selector: 'text=Cancel subscription' } },
        { action: 'wait', description: 'Wait for dialog', params: { duration: 3000 } },
        { action: 'click', description: 'Select Too expensive', params: { selector: 'text=Too expensive' } },
        { action: 'wait', description: 'Wait', params: { duration: 2000 } },
        { action: 'click', description: 'Check confirmation checkbox', params: { selector: 'text=I have read the information above and want to proceed with canceling my subscription' } },
        { action: 'wait', description: 'Wait', params: { duration: 1000 } },
        { action: 'type', description: 'Enter email for confirmation', params: { selector: 'input[type="email"], input[name="email"]', text: 'antigravity97732@gmail.com', clear: true } },
        { action: 'click', description: 'Click Cancel my subscription', params: { selector: 'text=Cancel my subscription' } },
        { action: 'wait', description: 'Wait 1 min for cancellation', params: { duration: 60000 } },
        { action: 'navigate', description: 'Open AI Ultra plans page', params: { url: 'https://workspace.google.com/intl/en_in/products/ai-ultra/#plans' } },
        { action: 'wait', description: 'Wait for plans page', params: { duration: 5000 } },
        { action: 'click', description: 'Click Buy now', params: { selector: 'text=Buy now' } },
        { action: 'wait', description: 'Wait for checkout', params: { duration: 5000 } },
        { action: 'click', description: 'Click Continue', params: { selector: 'text=Continue' } },
        { action: 'wait', description: 'Wait for Review page', params: { duration: 5000 } },
        { action: 'click', description: 'Click Agree and continue', params: { selector: 'text=Agree and continue' } },
        { action: 'wait', description: 'Wait for Add funds popup', params: { duration: 5000 } },
        { action: 'click', description: 'Click Continue (Add funds)', params: { selector: 'text=Continue' } },
        { action: 'wait', description: 'Wait for redirect', params: { duration: 5000 } },
        { action: 'click', description: 'Click Continue to admin console', params: { selector: 'text=Continue to admin console' } },
        { action: 'wait', description: 'Wait for success', params: { duration: 3000 } },
        { action: 'screenshot', description: 'Screenshot success page', params: {} },
      ];

      const existing = Flow.search('Cancel & Renew AI Ultra');
      if (existing.length === 0) {
        logger.info('Seeding default Google Workspace flow...');
        Flow.create({
          name: 'Cancel & Renew AI Ultra Subscription',
          description: 'Cancel Google AI Ultra subscription and buy a new one from Workspace store',
          category: 'google-admin',
          steps: flowSteps,
        });
        logger.info('Default flow seeded successfully!');
      } else {
        // Auto-update flow steps if version changed
        const flow = existing[0];
        if (!flow.description?.includes(`v${FLOW_VERSION}`)) {
          Flow.update(flow.id, {
            steps: flowSteps,
            description: `Cancel Google AI Ultra subscription and buy a new one from Workspace store (v${FLOW_VERSION})`,
          });
          logger.info(`Flow updated to v${FLOW_VERSION} (direct URL navigation)`);
        } else {
          logger.info(`Default flow already up-to-date (v${FLOW_VERSION}), skipping.`);
        }
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

    // Start scheduler (auto-repeat timer)
    scheduler.setExecuteCallback(async (flowId) => {
      const flow = Flow.findById(flowId);
      if (!flow) return;
      const execution = Execution.create({
        flow_id: flowId,
        flow_name: flow.name,
        total_steps: flow.steps.length,
      });
      try {
        const { addFlowJob } = require('./queue/queue');
        await addFlowJob({ flow, executionId: execution.id });
        logger.info(`[SCHEDULER] Auto-queued flow "${flow.name}" (exec: ${execution.id})`);
      } catch (err) {
        logger.error(`[SCHEDULER] Failed to queue flow ${flowId}`, { error: err.message });
      }
    });
    scheduler.loadFromDB();

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
