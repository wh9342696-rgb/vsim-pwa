# Secure Docker deployment

1. Copy `.env.docker.example` to `.env.docker` and replace every placeholder with production values. Generate secrets with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Set `FRONTEND_URL` to the exact HTTPS origin serving the PWA. Do not use `*` for production CORS.

3. Build and start the API and private PostgreSQL service:

   ```bash
   docker compose --env-file .env.docker up -d --build
   ```

4. Check the API health endpoint:

   ```bash
   curl http://127.0.0.1:3000/health
   ```

The API binds to loopback by default, runs as a non-root user with dropped Linux capabilities, and does not copy `.env` files or database files into the image. PostgreSQL is not published outside the Compose network. Back up the `postgres-data` volume before upgrades or destructive maintenance.