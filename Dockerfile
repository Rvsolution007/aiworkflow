# ─── Build Stage ────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ─── Production Stage ──────────────────────────────
FROM node:20-slim

# Install Chromium and ALL required dependencies for headless browser
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
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
    libxss1 \
    libasound2 \
    xdg-utils \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path for Puppeteer
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV HEADLESS=true
# Fix crashpad handler issue
ENV CHROME_CRASHPAD_PIPE_NAME=
ENV CHROME_DEVEL_SANDBOX=

# Create app directories with proper permissions
RUN mkdir -p /app/data/profiles /app/data/screenshots /app/data/logs /app/credentials /tmp/.chromium \
    && chmod -R 777 /tmp/.chromium

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Ensure data dirs are writable
RUN chmod -R 777 /app/data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Use dumb-init to handle signals properly
CMD ["dumb-init", "node", "src/server.js"]
