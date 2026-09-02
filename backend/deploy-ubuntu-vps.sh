#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-your-domain.com}"
APP_DIR="${APP_DIR:-/opt/vsim-app}"
EMAIL="${EMAIL:-admin@${DOMAIN}}"

if [[ "$EUID" -eq 0 ]]; then
  echo "This script must run as a non-root user with sudo access."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx docker.io docker-compose-plugin

sudo systemctl enable --now docker nginx

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [[ ! -f .env.production ]]; then
  cp /path/to/this/project/.env.production.example .env.production
fi

sed -i "s|FRONTEND_URL=https://your-domain.com|FRONTEND_URL=https://${DOMAIN}|g" .env.production
sed -i "s|JWT_SECRET=replace_with_a_strong_random_secret_at_least_32_chars|JWT_SECRET=$(openssl rand -hex 32)|g" .env.production || true

sudo cp /path/to/this/project/nginx.conf /etc/nginx/conf.d/vsim.conf
sudo sed -i "s/your-domain.com/${DOMAIN}/g" /etc/nginx/conf.d/vsim.conf

sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" --non-interactive --agree-tos -m "$EMAIL"

sudo systemctl reload nginx

docker compose up -d --build

echo "Deployment complete. Health check: https://${DOMAIN}/health"
