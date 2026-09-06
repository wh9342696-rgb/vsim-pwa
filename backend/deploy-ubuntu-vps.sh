#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-your-domain.com}"
APP_DIR="${APP_DIR:-/opt/vsim-app}"
EMAIL="${EMAIL:-admin@${DOMAIN}}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$EUID" -eq 0 ]]; then
  echo "Run this script as a non-root deploy user with sudo access."
  exit 1
fi

if [[ "$DOMAIN" == "your-domain.com" || "$DOMAIN" != *.* ]]; then
  echo "Usage: $0 app.example.com"
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx docker.io docker-compose-plugin

sudo systemctl enable --now docker nginx

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude '.env' --exclude '.env.*' --exclude 'node_modules' --exclude 'database/*.db*' --exclude '*.log' --exclude 'logs' "$SOURCE_DIR/" "$APP_DIR/"
sudo chown -R "$USER":"$USER" "$APP_DIR"
cd "$APP_DIR"

if [[ ! -f .env.docker ]]; then
  cp .env.docker.example .env.docker
fi

sed -i "s|FRONTEND_URL=https://app.example.com|FRONTEND_URL=https://${DOMAIN}|g" .env.docker
sed -i "s|WEBAUTHN_RP_ID=app.example.com|WEBAUTHN_RP_ID=${DOMAIN}|g" .env.docker
sed -i "s|WEBAUTHN_ORIGIN=https://app.example.com|WEBAUTHN_ORIGIN=https://${DOMAIN}|g" .env.docker
sed -i "s|JWT_SECRET=replace_with_at_least_32_random_characters|JWT_SECRET=$(openssl rand -hex 32)|g" .env.docker
sed -i "s|DEVICE_SECRET_ENCRYPTION_KEY=replace_with_a_different_random_secret_at_least_32_characters|DEVICE_SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)|g" .env.docker
sed -i "s|POSTGRES_PASSWORD=replace_with_a_long_random_database_password|POSTGRES_PASSWORD=$(openssl rand -hex 24)|g" .env.docker

if grep -Eq 'replace_with|example\.com|your-domain\.com' .env.docker; then
  echo "Replace all production placeholders in .env.docker before deployment."
  exit 1
fi
chmod 600 .env.docker

sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl stop nginx
sudo certbot certonly --standalone -d "$DOMAIN" -d "www.${DOMAIN}" --non-interactive --agree-tos -m "$EMAIL"

sudo cp nginx.conf /etc/nginx/conf.d/vsim.conf
sudo sed -i "s/your-domain.com/${DOMAIN}/g" /etc/nginx/conf.d/vsim.conf
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

docker compose --env-file .env.docker up -d --build

echo "Deployment complete. Health check: https://${DOMAIN}/health"
