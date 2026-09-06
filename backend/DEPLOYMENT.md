# Production Deployment Guide

## Runtime

This app must run on Node 22 LTS in production.

Command:

npx --yes -p node@22 node server.js

Or on Windows:

powershell -ExecutionPolicy Bypass -File .\start-production.ps1

For Ubuntu VPS deployment, use the Docker Compose stack behind Nginx. The API is bound to `127.0.0.1:3000`; only Nginx ports 80/443 should be public.

## Required environment

Use a production environment file with real values. Example:

- .env.production
- JWT_SECRET must be at least 32 characters
- DEVICE_SECRET_ENCRYPTION_KEY must be a separate random secret of at least 32 characters
- FRONTEND_URL must use HTTPS
- DB credentials must be production-safe

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
- Keep PostgreSQL private on the Docker network; do not publish port 5432.
- Keep Node port 3000 private; expose the application through HTTPS Nginx only.
- Apply OS updates and enable UFW with SSH plus Nginx Full only.
- Keep `.env.docker` at mode `600` and never expose PostgreSQL or port 3000 publicly.

## Post-deploy smoke checks

- GET /health
- GET /api/v1/esims/packages
- POST /api/v1/auth/login
- GET /api/v1/auth/me
- POST /api/v1/admin/login

## Restart strategy

Use a process manager such as PM2 or Windows service management to restart the app automatically after crashes.
