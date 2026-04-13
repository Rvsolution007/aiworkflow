# ─── Build Stage ────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ─── Production Stage ──────────────────────────────
FROM node:20-slim

# Install Chromium and dependencies for headless browser
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path for Puppeteer
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV HEADLESS=true

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /app/data/profiles /app/data/screenshots /app/data/logs /app/credentials \
    && chown -R appuser:appuser /app

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules

# Copy application code
COPY --chown=appuser:appuser . .

# Switch to non-root user
USER appuser

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
