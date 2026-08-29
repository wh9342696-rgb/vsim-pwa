# 🚀 VSIM Monorepo - Complete Setup Guide

This guide walks you through setting up the entire VSIM platform from scratch.

## Prerequisites

Install these globally first:

### 1. Node.js (v18+)
- **Download:** https://nodejs.org/
- **Verify:** `node --version` && `npm --version`

### 2. Git
- **Download:** https://git-scm.com/
- **Verify:** `git --version`

### 3. PocketBase (Standalone Database)
- **Download:** https://pocketbase.io/
- **Extract:** to any folder (e.g., `C:\pocketbase\`)
- **Verify:** `cd C:\pocketbase && ./pocketbase.exe --version`

### 4. Redis (Cache & Locks)
- **Windows:** Download from https://github.com/microsoftarchive/redis/releases
- **macOS:** `brew install redis`
- **Linux:** `sudo apt-get install redis-server`
- **Verify:** `redis-cli ping` (should return `PONG`)

---

## Step 1: Clone / Extract Project

```bash
cd c:\users\username\Desktop
git clone <repo-url> esim
cd esim
```

Or if already extracted, navigate to the folder:

```bash
cd c:\Users\This PC\Desktop\esim
```

## Step 2: Verify Monorepo Structure

Check that you have three folders:

```bash
ls -la
# Should show:
# admin/
# backend/
# frontend/
# README.md
# .gitignore
```

---

## Step 3: Start External Services

### Start PocketBase (Terminal 1)

```bash
cd C:\pocketbase
./pocketbase.exe serve

# Output should show:
# Admin UI:   http://127.0.0.1:8090/admin
# API:        http://127.0.0.1:8090
```

Keep this terminal open.

### Start Redis (Terminal 2)

```bash
redis-server

# Output should show:
# Ready to accept connections
# Listening on port 6379
```

Keep this terminal open.

---

## Step 4: Setup Backend

Open a new terminal (Terminal 3):

```bash
cd c:\Users\This PC\Desktop\esim\backend
npm install
```

### Configure Backend

```bash
# Copy example env file
copy .env.example .env

# Edit .env with your settings (open in VS Code)
code .env
```

**Fill in these fields:**

```env
NODE_ENV=development
PORT=4000
WS_PORT=4001

# PocketBase Admin Credentials
PB_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@localhost.com
PB_ADMIN_PASSWORD=YourSecurePassword123

# JWT Secrets (use at least 16 random characters)
JWT_ACCESS_SECRET=your_random_access_secret_min_16_chars_here
JWT_REFRESH_SECRET=your_random_refresh_secret_min_16_chars_here
JWT_ADMIN_SECRET=your_random_admin_secret_min_16_chars_here

JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d

# Redis Connection
REDIS_URL=redis://127.0.0.1:6379

# Security
ANDROID_REPLAY_WINDOW_SECONDS=60
DEPOSIT_EXPIRY_MINUTES=30
DEPOSIT_MATCH_WINDOW_MINUTES=15

# CORS Origins
ALLOWED_ORIGINS=http://localhost:3000
```

**Generate Strong Secrets:**

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copy the output into each *_SECRET field
```

### Start Backend Dev Server

```bash
npm run dev
# Should output:
# API listening on port 4000
```

Keep this terminal open.

---

## Step 5: Setup PocketBase Schema

While PocketBase is running:

1. Open browser: http://localhost:8090/admin
2. Login with credentials from `.env`
3. Import schema from `backend/pb_schema.json`
   - Click "Settings" → "Import Collections"
   - Select `backend/pb_schema.json`
4. Verify all 13 collections are created:
   - `users`, `admin_users`, `wallets`, `wallet_transactions`
   - `deposit_claims`, `incoming_sms`, `withdrawals`
   - `esim_profiles`, `esim_activations`
   - `referral_codes`, `referral_rewards`
   - `rewards`, `notifications`, `android_devices`, `audit_logs`, `system_settings`, `application_settings`

---

## Step 6: Setup Frontend

Open a new terminal (Terminal 4):

```bash
cd c:\Users\This PC\Desktop\esim\frontend
npm install
```

### Start Frontend Dev Server

```bash
npm run dev
# Should output:
# 🚀 VSIM API Server running on http://localhost:3000
# 📡 Health Check: http://localhost:3000/health
```

Keep this terminal open.

---

## Step 7: Verify Everything Works

### Check All Endpoints

**Terminal 5 (or browser):**

```bash
# Health check - Backend
curl http://localhost:4000/health

# Health check - Frontend
curl http://localhost:3000/health

# PocketBase admin
# Already open at http://localhost:8090/admin
```

### Open the App

**Browser:**
- User App: http://localhost:3000/
- Admin Panel: http://localhost:3000/admin.html

### Test Sign Up

1. Click "Get Started" on splash screen
2. Click "Sign Up"
3. Enter:
   - Name: `Test User`
   - Phone: `+256700123456`
   - Password: `Test@123`
   - Referral Code: (leave empty)
4. Click "Create Account"
5. Should redirect to home screen ✅

---

## Step 8: Create Admin User (Optional)

To access admin features:

### Option A: Via PocketBase Admin UI

1. Go to http://localhost:8090/admin
2. Click "admin_users" collection
3. Create new record with:
   - `email`: `admin@vsim.local`
   - `password`: `AdminPass123`
   - `role`: `superadmin`

### Option B: Via Backend API

```bash
curl -X POST http://localhost:4000/api/admin/create-user \
  -H "Authorization: Bearer {ADMIN_JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@vsim.local",
    "password": "AdminPass123",
    "role": "superadmin"
  }'
```

### Login as Admin

1. Open http://localhost:3000/admin.html
2. Login with admin email/password
3. Access admin dashboard ✅

---

## Terminal Reference

When everything is running, you should have these terminals open:

| Terminal | Process | Port | Command |
|----------|---------|------|---------|
| 1 | PocketBase | 8090 | `./pocketbase serve` |
| 2 | Redis | 6379 | `redis-server` |
| 3 | Backend | 4000/4001 | `cd backend && npm run dev` |
| 4 | Frontend | 3000 | `cd frontend && npm run dev` |
| 5 | Testing | - | `curl` / browser |

---

## Common Issues & Fixes

### ❌ "EADDRINUSE: address already in use :::3000"

**Cause:** Port 3000 already in use

**Fix:**
```bash
# Kill process on port 3000
npx kill-port 3000

# Or use a different port
PORT=3001 npm run dev
```

### ❌ "Cannot connect to PocketBase"

**Cause:** PocketBase not running or wrong URL

**Fix:**
1. Check PocketBase is running (`terminal 1`)
2. Verify `PB_URL` in `.env` is `http://localhost:8090`
3. Check credentials match PocketBase admin user

### ❌ "Cannot connect to Redis"

**Cause:** Redis not running

**Fix:**
1. Start Redis (`redis-server` in terminal 2)
2. Verify `REDIS_URL=redis://127.0.0.1:6379` in `.env`

### ❌ "API calls returning 401/403"

**Cause:** JWT token issue or wrong secret

**Fix:**
1. Generate new secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Update all three secrets in `.env`
3. Restart backend
4. Clear browser localStorage: Open DevTools (F12) → Application → Clear All

### ❌ "Cannot read property 'getToken' of undefined"

**Cause:** API client not loaded

**Fix:**
1. Open DevTools (F12) → Console
2. Check for errors loading `api.js`
3. Hard refresh browser: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)

### ❌ "Splash screen not responding to Get Started"

**Cause:** Frontend server not running or backend unreachable

**Fix:**
1. Verify frontend running: `npm run dev` in terminal 4
2. Verify backend running: `npm run dev` in terminal 3
3. Test: `curl http://localhost:3000/health`

---

## Production Deployment

### Backend (PM2)

```bash
cd backend

# Install PM2 globally
npm install -g pm2

# Start cluster
npm run pm2:start

# Monitor
pm2 monit

# View logs
pm2 logs

# Graceful reload
pm2 gracefulReload ecosystem.config.js

# Stop all
pm2 stop all
```

### Frontend (PM2)

```bash
cd frontend

# Start
npm install -g pm2
pm2 start "npm start" --name "vsim-frontend"

# Monitor
pm2 monit
```

### Nginx Reverse Proxy

Use configuration from `backend/nginx/app.conf`:

```bash
# Copy to Nginx config
cp backend/nginx/app.conf /etc/nginx/sites-available/vsim
ln -s /etc/nginx/sites-available/vsim /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

---

## Development Best Practices

### 1. Branch Protection
- Never push directly to `main`
- Always create feature branches: `git checkout -b feature/my-feature`
- Create pull requests for review

### 2. Env Secrets
- Never commit `.env` files
- Use `.env.example` as template
- Generate new secrets for production

### 3. Logging
- Backend uses Winston logger: `logger.info()`, `logger.error()`
- Check logs: `pm2 logs momo-api`
- Frontend console: DevTools (F12) → Console tab

### 4. Testing
- Backend: `npm test` (in backend/)
- Frontend: Browser console for errors
- Manual testing via curl or Postman

### 5. Database
- PocketBase: Auto-syncing with backend
- Never modify collections without schema updates
- Always backup PocketBase data before major changes

---

## Next Steps

1. ✅ Complete setup (this guide)
2. 📖 Read [README.md](README.md) for architecture overview
3. 📝 Review [backend/README.md](backend/README.md) for API details
4. 🧪 Test endpoints with curl/Postman
5. 💻 Start developing features!

---

## Support & Troubleshooting

- **Backend Issues:** Check `backend/README.md`
- **Frontend Issues:** Check browser console (F12)
- **Data Issues:** Check PocketBase admin UI (http://localhost:8090/admin)
- **Redis Issues:** Check `redis-cli` connection: `redis-cli ping`
- **General:** Review logs in respective terminals

---

**Good luck! 🚀**

