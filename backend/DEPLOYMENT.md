# Production Deployment Guide

## Runtime

This app must run on Node 22 LTS in production.

Command:

npx --yes -p node@22 node server.js

Or on Windows:

powershell -ExecutionPolicy Bypass -File .\start-production.ps1

## Required environment

Use a production environment file with real values. Example:

- .env.production
- JWT_SECRET must be at least 32 characters
- FRONTEND_URL must use HTTPS
- DB credentials must be production-safe

PostgreSQL is mandatory. Set either `DATABASE_URL` or all of `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and `PGPASSWORD`. The API does not support SQLite or any
local database fallback.

## Reverse proxy

Use Nginx or Caddy in front of Node to provide TLS and HTTPS redirect.

Example config: nginx.conf.example

## Security requirements

- HTTPS only
- Strong JWT secret
- No secrets committed to the repository
- Restrict CORS to trusted frontend origins
- Keep the app behind a reverse proxy or load balancer
- Run with a process manager for restarts

## Post-deploy smoke checks

- GET /health
- GET /api/v1/esims/packages
- POST /api/v1/auth/login
- GET /api/v1/auth/me
- POST /api/v1/admin/login

## VPS PostgreSQL checks

```bash
cd ~/vsim-pwa/backend
set -a; . ./.env; set +a
pg_isready -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE" -U "$PGUSER"
npx --yes -p node@22 node --input-type=module -e "import('./config/db.js').then(async ({query, closeDatabase}) => { const result = await query('SELECT current_database() AS database, current_user AS user, NOW() AS server_time'); console.log(result.rows[0]); await closeDatabase(); }).catch(error => { console.error(error); process.exit(1); })"
```

## Restart strategy

Use a process manager such as PM2 or Windows service management to restart the app automatically after crashes.
