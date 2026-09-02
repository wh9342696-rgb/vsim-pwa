module.exports = {
  apps: [
    {
      name: 'vsim-api',
      cwd: __dirname,
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        JWT_SECRET: process.env.JWT_SECRET,
        FRONTEND_URL: 'https://vsime.uk',
        ALLOWED_ORIGINS: 'https://vsime.uk,https://www.vsime.uk,https://*.pages.dev',
        PGHOST: process.env.PGHOST,
        PGPORT: process.env.PGPORT || 5432,
        PGDATABASE: process.env.PGDATABASE,
        PGUSER: process.env.PGUSER,
        PGPASSWORD: process.env.PGPASSWORD,
        PGSSL: process.env.PGSSL || 'false'
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
