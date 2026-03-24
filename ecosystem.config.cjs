module.exports = {
  apps: [
    {
      name: 'restream-panel',
      script: 'server.js',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      error_file: '/home/user/webapp/logs/pm2-error.log',
      out_file: '/home/user/webapp/logs/pm2-out.log'
    }
  ]
}
