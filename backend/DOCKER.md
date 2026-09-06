# Secure Docker deployment

1. Copy `.env.docker.example` to `.env.docker` and replace every placeholder with production values. Generate secrets with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Set `FRONTEND_URL` to the exact HTTPS origin serving the PWA and `CORS_ORIGINS` to a comma-separated list of every production/Pages preview origin. Do not use `*` for production CORS.

3. Set `TRUST_PROXY=1`; the application must only be reachable through the local Nginx reverse proxy. Use a different random value for `DEVICE_SECRET_ENCRYPTION_KEY` than for `JWT_SECRET`. Keep `.env.docker` owned by the deploy user with mode `600`.

4. Build and start the API and private PostgreSQL service:

   ```bash
   docker compose --env-file .env.docker up -d --build
   ```

5. Check the API health endpoint:

   ```bash
   curl http://127.0.0.1:3000/health
   ```

The API binds to loopback by default, runs as a non-root user with dropped Linux capabilities, and does not copy `.env` files or database files into the image. PostgreSQL is not published outside the Compose network. Back up the `postgres-data` volume before upgrades or destructive maintenance.

On Ubuntu, allow only SSH and Nginx through UFW. Configure automated PostgreSQL backups, test restoring them, apply security updates, and monitor disk space, container health, authentication failures, and certificate renewal.