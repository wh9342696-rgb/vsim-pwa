# VSIM Production Readiness Checklist

## Required before deployment

1. Use Node 22 LTS as the app runtime.
2. Run the app with PostgreSQL as the primary database.
3. Set NODE_ENV=production and a strong JWT_SECRET.
4. Set FRONTEND_URL to the production HTTPS origin.
5. Use HTTPS-only access through a reverse proxy or TLS terminator.
6. Restrict CORS to trusted origins only.
7. Keep secrets out of the repository and out of `.env` files in production.
8. Enable monitoring, logs, and alerting.
9. Configure regular database backups and restore testing.
10. Validate admin login, user login, package listing, wallet balance, and health checks after each deployment.

## Startup command

Use the application startup script with the correct runtime:

npx --yes -p node@22 node server.js

## Smoke tests

 - GET https://api.vsime.uk/health
 - GET https://api.vsime.uk/api/v1/esims/packages
 - POST https://api.vsime.uk/api/v1/admin/login
 - POST https://api.vsime.uk/api/v1/auth/login
 - GET https://api.vsime.uk/api/v1/auth/me

## Production notes

- Do not rely on SQLite for the production database path.
- Do not store production secrets in the repo.
- Do not expose the app without TLS.
- Do not use the default admin credentials in a real deployment.
