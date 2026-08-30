#!/bin/bash
cd /var/www/vsim
echo "=== Killing old PM2 process ==="
pm2 delete vsim-api 2>/dev/null || true

echo "=== Checking PostgreSQL ==="
pg_isready -h localhost -p 5432

echo "=== Checking .env ==="
grep -E "DB_|POSTGRES" .env || echo "No DB vars in .env"

echo "=== Starting fresh with ecosystem config ==="
pm2 start ecosystem.config.cjs --update-env
sleep 3

echo "=== Checking status ==="
pm2 status

echo "=== Testing endpoints ==="
echo "Testing /admin..."
curl -sI http://localhost:3000/admin | head -3
echo ""
echo "Testing /..."
curl -sI http://localhost:3000/ | head -3

echo "=== Logs ==="
pm2 logs vsim-api --lines 10 --nostream | head -30
echo "=== Done ==="
