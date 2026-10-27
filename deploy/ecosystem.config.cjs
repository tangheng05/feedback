/**
 * pm2 process definition (.cjs because pm2 loads it with require()).
 *
 * Install:
 *   npm install -g pm2
 *   cd /path/to/feedback
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup        # survive reboots (run the line it prints)
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'feedback',
      cwd: ROOT,
      script: 'src/server.js',

      // One process: SQLite, caches and the webhook all assume a single worker.
      instances: 1,
      exec_mode: 'fork',

      // The app reads .env itself; changes need `pm2 restart feedback`.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 5000,

      max_memory_restart: '300M',

      time: true, // timestamp every log line
      merge_logs: true,
      out_file: path.join(ROOT, 'logs/out.log'),
      error_file: path.join(ROOT, 'logs/error.log'),

      // Watching would restart on every database write.
      watch: false,
    },
  ],
};
