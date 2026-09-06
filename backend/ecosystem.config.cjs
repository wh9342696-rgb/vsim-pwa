module.exports = {
  apps: [
    {
      name: 'vsim-api',
      cwd: __dirname,
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      autorestart: true,
      restartDelay: 2000,
      watch: false,
      max_restarts: 10,
      time: true,
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true
    }
  ]
};
