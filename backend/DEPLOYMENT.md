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

## Separate VPS backend deployment

For a production VPS, keep this API as a standalone service and serve the frontend from a different origin or a separate static host.

Recommended setup:

- Backend API on VPS: `https://api.example.com`
- Frontend PWA on same VPS or another static host: `https://app.example.com`
- In the frontend HTML, set a meta tag or global variable before the app loads:

```html
<meta name="vsim-api-base" content="https://api.example.com/api/v1" />
```

or in JS before app bootstrap:

```js
window.VSIM_API_BASE = 'https://api.example.com/api/v1';
```

Keep `SERVE_FRONTEND=false` in the backend `.env` so the Node service does not try to serve the static files and break the frontend separation.

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

## Restart strategy

Use a process manager such as PM2 or Windows service management to restart the app automatically after crashes.
