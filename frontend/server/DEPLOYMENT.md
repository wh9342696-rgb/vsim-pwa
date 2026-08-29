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
