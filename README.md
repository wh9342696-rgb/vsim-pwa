# VSIM Global eSIM Platform - Monorepo

A complete mobile money wallet and global eSIM platform with integrated fintech backend, user PWA frontend, and admin dashboard.

## 📁 Project Structure

```
esim/
├── backend/                    # Main Node.js/Express fintech backend
│   ├── src/
│   │   ├── app.js             # Express app factory
│   │   ├── server.js          # Entry point
│   │   ├── config/            # Config (env, logger, PocketBase, Redis)
│   │   ├── middleware/        # Auth, validation, rate-limit, etc.
│   │   ├── modules/           # 11 feature modules (auth, wallet, deposit, etc.)
│   │   ├── jobs/              # Background jobs (8 cron jobs)
│   │   ├── errors/            # Error handling
│   │   ├── utils/             # Utilities
│   │   ├── repositories/      # Data access layer
│   │   └── websockets/        # Real-time updates
│   ├── nginx/                 # Nginx reverse proxy config
│   ├── tests/                 # Test files
│   ├── package.json
│   ├── ecosystem.config.js    # PM2 cluster config
│   ├── pb_schema.json         # PocketBase schema
│   ├── POCKETBASE_IMPORT.md   # PocketBase setup guide
│   └── README.md
│
├── frontend/                  # User PWA (Node.js express + static files)
│   ├── server/                # Express.js backend server
│   │   ├── routes/            # API routes (auth, esims, wallet, etc.)
│   │   ├── config/            # Database & config
│   │   ├── middleware/        # Auth middleware
│   │   ├── jobs/              # Background jobs
│   │   ├── package.json
│   │   └── server.js          # Express entry point (port 3000)
│   ├── js/
│   │   ├── app.js             # Main app logic & navigation
│   │   ├── api.js             # API client
│   │   └── admin.js           # Admin panel logic
│   ├── css/
│   │   ├── app.css            # User app styles
│   │   └── admin.css          # Admin styles
│   ├── icons/                 # App icons
│   ├── index.html             # User PWA entry point
│   ├── admin.html             # Admin panel entry point
│   ├── manifest.json          # PWA manifest
│   ├── service-worker.js      # Offline support
│   └── admin-sw.js            # Admin service worker
│
└── admin/                     # Standalone admin PWA
    ├── js/
    │   ├── admin-api.js       # Admin API client
    │   └── admin.js           # Admin interface logic
    ├── css/
    │   └── admin.css          # Admin styles
    ├── index.html             # Admin entry point
    ├── manifest.json          # PWA manifest
    └── service-worker.js      # Offline support
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** v18+ ([download](https://nodejs.org/))
- **npm** (included with Node.js)
- **PocketBase** (running instance) - [docs](https://pocketbase.io/)
- **Redis** (for locks & rate-limiting)

### 1. Backend Setup

```bash
cd backend
npm install

# Create .env file with required variables
cp .env.example .env
# Edit .env and fill in:
#  - PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD
#  - JWT_*_SECRET (min 16 chars each)
#  - REDIS_URL

# Development (single process, auto-restart)
npm run dev

# Production (PM2 cluster: API + Jobs)
npm run pm2:start
```

**Ports:**
- `4000` - HTTP API
- `4001` - WebSocket gateway

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Development (with file watch)
npm run dev
# Opens at http://localhost:3000/

# Production
npm start
```

**Ports:**
- `3000` - User PWA + Backend API

### 3. Admin Panel

Admin panel is built into the frontend and accessible at:
- **Development:** `http://localhost:3000/admin.html`
- **Production:** `/admin` route (served by frontend server)

---

## 🏗️ Architecture Overview

### Three-Tier System

```
┌─────────────────────────────────────┐
│  User PWA (frontend) + Admin UI     │
│  Port 3000                          │
└───────────────┬─────────────────────┘
                │
        ┌───────▼───────┐
        │ Frontend API  │
        │ Express.js    │
        │ (SQLite DB)   │
        └───────┬───────┘
                │
┌───────────────┼───────────────────────────────────┐
│               │                                   │
│   Backend API │  (PocketBase + Redis)             │
│   Express     │  ✓ Fintech Logic                  │
│   Port 4000   │  ✓ Distributed Locking             │
│   WebSocket   │  ✓ Immutable Ledger                │
│   Port 4001   │  ✓ Job Scheduler                   │
│               │                                   │
└───────────────┼───────────────────────────────────┘
                │
        ┌───────▼────────────┐
        │ Data Layer         │
        │ PocketBase + Redis │
        └────────────────────┘
```

### Core Modules (Backend)

| Module | Purpose | Status |
|--------|---------|--------|
| **auth** | Register, login, refresh tokens | ✅ Fully Implemented |
| **wallet** | Balance management with distributed locking | ✅ Fully Implemented |
| **deposit** | Auto-match deposits + manual review | ✅ Fully Implemented |
| **withdrawal** | 3-phase withdrawal flow (request→hold→complete) | ✅ Fully Implemented |
| **esim** | Browse, activate, track eSIM usage | ⚠️ Provider mocked |
| **referral** | 2-level commission system | ✅ Fully Implemented |
| **rewards** | Daily earnings + reward distribution | ✅ Fully Implemented |
| **notifications** | Real-time notifications + history | ✅ Fully Implemented |
| **admin** | User management, wallet adjustments, audits | ✅ Fully Implemented |
| **android** | HMAC-signed device integration | ✅ Fully Implemented |
| **profile** | User profile & settings management | ✅ Fully Implemented |

---

## 🔒 Security Highlights

✅ **Distributed Wallet Locking** - Redis-based locks prevent race conditions  
✅ **Immutable Ledger** - Every balance change is audited  
✅ **Separate JWT Secrets** - Users & admins use different secrets (leaked user token ≠ admin access)  
✅ **Android HMAC Signing** - Devices sign requests with provisioned secrets  
✅ **Replay Protection** - Nonce + timestamp validation on critical requests  
✅ **Rate Limiting** - Redis-backed request throttling  
✅ **Input Validation** - Zod schemas on all endpoints  

---

## 📊 Background Jobs (Backend)

Runs as separate PM2 process to prevent blocking API:

| Job | Schedule | Purpose |
|-----|----------|---------|
| `dailyEarnings` | 00:05 daily | Calculate daily % earnings |
| `referralCalculation` | Hourly | Process referral rewards |
| `rewardDistribution` | 01:00 daily | Credit rewards to wallets |
| `depositCleanup` | Every 5 min | Expire old deposits |
| `withdrawalRetry` | Every 10 min | Retry failed withdrawals |
| `notificationCleanup` | 02:00 daily | Remove old notifications |
| `androidMonitoring` | Every 2 min | Check device heartbeats |
| `walletAuditing` | 03:00 daily | Verify ledger integrity |

---

## 🔌 API Endpoints

### User Endpoints

```
POST   /api/auth/register           # Create account
POST   /api/auth/login              # User login
POST   /api/auth/refresh            # Refresh JWT token
POST   /api/auth/logout             # Clear session

GET    /api/wallet/balance          # Get wallet balance
GET    /api/wallet/transactions     # Transaction history

POST   /api/deposit/initiate        # Start deposit
POST   /api/deposit/submit          # Submit payment proof
GET    /api/deposit/{id}            # Get deposit status

POST   /api/withdrawal/request      # Request withdrawal
GET    /api/withdrawal/{id}         # Get withdrawal status
GET    /api/withdrawal/history      # Withdrawal history

GET    /api/esims/available         # Browse eSIM packages
POST   /api/esims/activate          # Purchase & activate
GET    /api/esims/my                # My eSIM profiles
GET    /api/esims/usage/{id}        # Data usage

GET    /api/referral/code           # Get referral code
POST   /api/referral/link           # Link referral
GET    /api/referral/earnings       # Referral commissions

GET    /api/rewards/pending         # Pending rewards
GET    /api/rewards/history         # Completed rewards

GET    /api/notifications           # Notification history
PATCH  /api/notifications/read      # Mark as read

GET    /api/profile/me              # User profile
PATCH  /api/profile/me              # Update profile
```

### Admin Endpoints

```
GET    /api/admin/users             # List users
POST   /api/admin/wallet/adjust     # Adjust user wallet
GET    /api/admin/deposits/pending  # Review pending deposits
GET    /api/admin/withdrawals       # Review withdrawals
GET    /api/admin/devices           # Manage Android devices
GET    /api/admin/audit-logs        # Audit trail
```

### Android Device Endpoints

```
POST   /api/android/sms/ingest      # Receive SMS deposit notifications
POST   /api/android/heartbeat       # Device status update
GET    /api/android/withdrawals     # Get pending withdrawals
POST   /api/android/withdrawal/{id}/complete  # Complete withdrawal
POST   /api/android/logs            # Push device logs
```

---

## 🔧 Configuration Files

### Backend (`.env`)

```bash
NODE_ENV=production
PORT=4000
WS_PORT=4001

PB_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=***

JWT_ACCESS_SECRET=*** (min 16 chars)
JWT_REFRESH_SECRET=***
JWT_ADMIN_SECRET=***
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d

REDIS_URL=redis://127.0.0.1:6379

ANDROID_REPLAY_WINDOW_SECONDS=60
DEPOSIT_EXPIRY_MINUTES=30
DEPOSIT_MATCH_WINDOW_MINUTES=15

ALLOWED_ORIGINS=http://localhost:3000,https://example.com
```

### Frontend (`.env`)

```bash
# Configured in frontend/server/.env if separate SQLite backend
# Or set API_BASE in frontend/js/api.js
```

---

## 📋 Prerequisites Setup

### 1. PocketBase

```bash
# Download from https://pocketbase.io/
# Run PocketBase
./pocketbase serve

# Visit http://localhost:8090
# Create admin account
# Import schema from backend/pb_schema.json
```

### 2. Redis

```bash
# Install Redis (Windows/Mac/Linux)
# macOS: brew install redis
# Windows: https://github.com/microsoftarchive/redis/releases

# Start Redis
redis-server

# Default: localhost:6379
```

### 3. Environment Variables

Copy example files and fill in secrets:

```bash
cd backend
cp .env.example .env
# Edit .env with real secrets
```

---

## 🛠️ Development Workflow

### Running Everything Locally

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Terminal 3 - PocketBase:**
```bash
./pocketbase serve
```

**Terminal 4 - Redis:**
```bash
redis-server
```

Then open:
- **User App:** http://localhost:3000/
- **Admin Panel:** http://localhost:3000/admin.html
- **Backend API:** http://localhost:4000/health
- **PocketBase:** http://localhost:8090

### Testing API Endpoints

```bash
# Health check
curl http://localhost:3000/health
curl http://localhost:4000/health

# User registration
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"John","phone":"+256700123456","password":"Test123"}'

# Get wallet balance (requires JWT token)
curl http://localhost:3000/api/wallet/balance \
  -H "Authorization: Bearer {JWT_TOKEN}"
```

---

## 🚢 Production Deployment

### Backend (PM2 Cluster)

```bash
cd backend
npm install --production
npm run pm2:start

# Monitor
pm2 monit

# Logs
pm2 logs momo-api
pm2 logs momo-jobs

# Graceful reload
pm2 gracefulReload ecosystem.config.js
```

### Frontend

```bash
cd frontend
npm install --production
npm start
# Listens on port 3000
```

### Nginx Reverse Proxy

See `backend/nginx/app.conf` for reverse proxy configuration.

---

## 🐛 Troubleshooting

### "EADDRINUSE: address already in use :::3000"
Port 3000 is already in use. Kill the process or use a different port:
```bash
npx kill-port 3000
```

### "Cannot connect to PocketBase"
- Ensure PocketBase is running: `./pocketbase serve`
- Check `PB_URL` in `.env` (default: `http://localhost:8090`)
- Verify admin credentials in `.env`

### "Cannot connect to Redis"
- Ensure Redis is running: `redis-server`
- Check `REDIS_URL` in `.env` (default: `redis://127.0.0.1:6379`)

### "Failed to fetch from API"
- Check backend is running on port 4000
- Check frontend server is running on port 3000
- Verify `API_BASE` in `frontend/js/api.js` points to correct backend
- Open DevTools (F12) → Console for CORS or network errors

---

## 📚 Documentation

- [Backend README](backend/README.md) - Architecture, modules, security
- [PocketBase Setup](backend/POCKETBASE_IMPORT.md) - Collection schema
- [Frontend README](frontend/README.md) - PWA structure, screens
- [Admin Guide](frontend/README.md#admin-panel) - Admin features

---

## 📄 License

All rights reserved © VSIM Global 2026

---

## 🤝 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the relevant README in each folder
3. Check browser console (F12) for frontend errors
4. Check terminal logs for backend errors
5. Review PocketBase admin panel for data issues

