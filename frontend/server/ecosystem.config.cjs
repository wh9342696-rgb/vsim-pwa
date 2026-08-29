module.exports = {
  apps: [
    {
      name: 'vsim-api',
      cwd: __dirname,
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        JWT_SECRET: 'vsim_super_secret_production_key_2026',
        FRONTEND_URL: 'https://localhost',
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_NAME: 'vsim_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'joel'
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
