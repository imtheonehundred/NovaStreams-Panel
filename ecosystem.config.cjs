const path = require('path');

module.exports = {
  apps: [
    {
      name: 'novastreams-panel',
      script: path.join(__dirname, 'server.js'),
      cwd: __dirname,
      env_file: path.join(__dirname, '.env'),
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      error_file: path.join(__dirname, 'logs', 'pm2-error.log'),
      out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
    },
  ],
};
