#!/bin/bash
# ═══════════════════════════════════════════════════════
# AI Flow Builder — VPS Setup Script
# For Hostinger KVM 2 (Ubuntu 22.04/24.04)
# ═══════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║   AI Flow Builder — VPS Setup Script         ║"
echo "╚══════════════════════════════════════════════╝"

# 1. System Update
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# 2. Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install Chromium dependencies
echo "🌐 Installing Chromium and dependencies..."
apt install -y --no-install-recommends \
  chromium-browser \
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
  libxshmfence1

# 4. Install Redis
echo "🔴 Installing Redis..."
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server

# 5. Install PM2
echo "⚡ Installing PM2..."
npm install -g pm2

# 6. Install Nginx (reverse proxy)
echo "🌐 Installing Nginx..."
apt install -y nginx

# 7. Configure Nginx reverse proxy
echo "📝 Configuring Nginx..."
cat > /etc/nginx/sites-available/ai-flow-builder << 'EOF'
server {
    listen 80;
    server_name _;  # Replace with your domain

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/ai-flow-builder /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# 8. Increase file limits
echo "📝 Increasing system limits..."
echo "fs.inotify.max_user_watches=524288" >> /etc/sysctl.conf
sysctl -p

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✅ VPS Setup Complete!                     ║"
echo "║                                              ║"
echo "║   Next steps:                                ║"
echo "║   1. cd /var/www/ai-flow-builder             ║"
echo "║   2. cp .env.example .env                    ║"
echo "║   3. Edit .env with your settings            ║"
echo "║   4. Add service-account.json to credentials/║"
echo "║   5. npm install                             ║"
echo "║   6. pm2 start ecosystem.config.js           ║"
echo "║   7. pm2 save && pm2 startup                 ║"
echo "╚══════════════════════════════════════════════╝"
