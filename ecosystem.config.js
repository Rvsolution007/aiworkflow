/**
 * PM2 Ecosystem Configuration
 * For non-Docker deployments directly on VPS
 */
module.exports = {
  apps: [
    {
      name: 'ai-flow-builder',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './data/logs/pm2-error.log',
      out_file: './data/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
