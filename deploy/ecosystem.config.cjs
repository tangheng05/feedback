/**
 * pm2 process definition.
 *
 * .cjs, not .js: package.json sets "type": "module", and pm2 loads this file
 * with require().
 *
 * Install:
 *   npm install -g pm2
 *   cd /path/to/feedback
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup        # survive reboots (run the line it prints)
 */
const path = require('node:path');

// The repo root, one level up from deploy/. Resolved from this file so the
// config works regardless of the directory pm2 happens to be started from.
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'feedback',
      cwd: ROOT,
      script: 'src/server.js',

      /*
       * One process, fork mode. NOT cluster.
       *
       * better-sqlite3 is synchronous and holds the database open in-process;
       * several workers would each keep their own QR cache and their own
       * connection, and the Telegram webhook would be delivered to whichever
       * worker happened to get it. There is nothing here that needs more than
       * one core -- a shop submits a few dozen messages a day.
       */
      instances: 1,
      exec_mode: 'fork',

      // The app reads .env itself (see src/config.js), so pm2 does not need
      // env_file. It does mean a .env change needs `pm2 restart feedback`.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 5000,

      // A leak would otherwise take the form down silently.
      max_memory_restart: '300M',

      time: true, // timestamp every log line
      merge_logs: true,
      out_file: path.join(ROOT, 'logs/out.log'),
      error_file: path.join(ROOT, 'logs/error.log'),

      // Never watch: a write to data/feedback.db would restart the process
      // on every single submission.
      watch: false,
    },
  ],
};
