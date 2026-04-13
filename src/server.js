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

    // Start background worker
    try {
      startWorker();
      logger.info('Background worker started');
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
