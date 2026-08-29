# 🚀 VSIM - Quick Startup Guide

## ⚡ Quick Start (4 Terminals Required)

This guide gets you from zero to testing in 5 minutes.

---

## Prerequisites Checklist

Before starting, verify you have these installed:

```powershell
# Check Node.js
node --version     # Should be v18+

# Check Redis
redis-cli --version

# Check PocketBase
cd C:\pocketbase && ./pocketbase.exe --version
```

If any are missing, follow [SETUP_GUIDE.md](./SETUP_GUIDE.md)

---

## 🎬 Step 1: Start PocketBase (Terminal 1)

```powershell
cd C:\pocketbase
./pocketbase.exe serve
```

**Expected Output:**
```
Admin UI:   http://127.0.0.1:8090/admin
API:        http://127.0.0.1:8090
```

✅ Keep this terminal open and proceed to Step 2

---

## 🎬 Step 2: Start Redis (Terminal 2)

```powershell
redis-server
```

**Expected Output:**
```
Ready to accept connections
```

✅ Keep this terminal open and proceed to Step 3

---

## 🎬 Step 3: Start Backend (Terminal 3)

```powershell
cd "C:\Users\This PC\Desktop\esim\backend"
npm install
npm run dev
```

**Expected Output:**
```
✓ [backend] Server running on port 4000
✓ [backend] WebSocket running on port 4001
✓ [backend] PocketBase connected
✓ [backend] Redis connected
```

Wait for "Server running" message. Then proceed to Step 4.

---

## 🎬 Step 4: Start Frontend (Terminal 4)

```powershell
cd "C:\Users\This PC\Desktop\esim\frontend\server"
npm install
node server.js
```

**Expected Output:**
```
✓ Frontend server running on http://localhost:3000
```

---

## ✅ Verify Everything is Running

### Check All Services (New Terminal)

```powershell
# PocketBase
curl http://localhost:8090

# Backend API
curl http://localhost:4000/health

# Frontend
curl http://localhost:3000
```

All should return 200 OK.

---

## 🌐 Access Your App

### User App
- **URL:** http://localhost:3000
- **First Screen:** Splash screen with "Get Started" button
- **Flow:** Get Started → Login/Signup → Home

### Admin Panel
- **URL:** http://localhost:3000/admin.html
- **Credentials:** Set in PocketBase

### PocketBase Admin
- **URL:** http://localhost:8090/admin
- **Login:** See [SETUP_GUIDE.md](./SETUP_GUIDE.md#pocketbase-setup)

---

## 🧪 Test the Full Flow

### 1. Open Frontend App
```
http://localhost:3000
```

### 2. See Splash Screen
- Title: "VSIM - Stay Connected Anywhere"
- Button: "Get Started"

### 3. Click "Get Started"
- Should navigate to Login screen
- If stuck: Check browser console (F12) for errors

### 4. Create Account (Sign Up)
1. Click "Sign Up" tab
2. Enter:
   - Full Name: `John Doe`
   - Phone: `700123456` (or any 9 digits)
   - Password: `Test@123`
   - Confirm Password: `Test@123`
3. Click "Create Account"

**Expected Result:**
- Account created
- Logged in automatically
- Redirected to Home screen
- Wallet shown with 0 balance

### 5. Login (Use Existing Account)
1. Click "Login" tab
2. Enter:
   - Phone: `700123456`
   - Password: `Test@123`
3. Click "Login"

**Expected Result:**
- Logged in
- Redirected to Home screen
- Profile shows your name

---

## 🐛 Troubleshooting

### Frontend Stuck on Splash Screen

**Problem:** Click "Get Started" but nothing happens

**Solutions:**

1. **Check browser console (F12)**
   ```javascript
   // In browser console:
   window.VSIM_API          // Should be defined
   window.VSIM_API.getToken() // Should return '' (empty if not logged in)
   ```

2. **Check if backend is running**
   ```powershell
   curl http://localhost:4000/health
   ```
   Should return 200 OK with JSON

3. **Check if frontend server is running**
   ```powershell
   curl http://localhost:3000
   ```
   Should return HTML

4. **Clear browser cache**
   - Press `Ctrl+Shift+Delete`
   - Clear localStorage, cache, cookies
   - Refresh page

5. **Check network tab (F12 → Network)**
   - Look for failed requests
   - Should see `/api/v1/*` requests
   - All should return 200

### Backend Not Starting

**Problem:** `npm run dev` shows errors

**Check:**
1. Is Redis running? → Run `redis-cli ping` (should return PONG)
2. Is PocketBase running? → Check http://localhost:8090
3. Are ports free? → `netstat -ano | findstr :4000` (should be empty)

**Fix:**
```powershell
# Kill any existing Node processes
Stop-Process -Name node -Force

# Try again
npm run dev
```

### Cannot Connect to Backend

**Problem:** API requests fail in frontend

**Check:**
1. Backend running? → `curl http://localhost:4000/health`
2. Redis running? → `redis-cli ping`
3. PocketBase running? → `curl http://localhost:8090`

**Restart Backend:**
```powershell
cd "C:\Users\This PC\Desktop\esim\backend"
npm run dev
```

### Signup/Login Fails

**Problem:** Get error "Signup failed" or "Login failed"

**Check:**
1. Are all services running? (See verification above)
2. Is the phone number valid? (Use 9 digits like `700123456`)
3. Is password at least 6 characters?
4. Check browser console for API response errors

**Fix Backend:**
```powershell
# Restart backend to ensure clean state
cd "C:\Users\This PC\Desktop\esim\backend"
npm run dev
```

### Database/Schema Issues

**Problem:** "PocketBase schema mismatch" errors

**Fix:**
1. Open PocketBase admin: http://localhost:8090/admin
2. Delete all collections (or start fresh)
3. Import schema: Follow [SETUP_GUIDE.md](./SETUP_GUIDE.md#import-pocketbase-schema)
4. Restart backend

---

## 🔧 Development Commands

### Backend

```powershell
# Start with auto-reload
cd backend && npm run dev

# Start without watch
cd backend && node src/server.js

# Run tests
cd backend && npm test

# View logs
cd backend && tail -f logs/app.log
```

### Frontend

```powershell
# Start dev server
cd frontend/server && node server.js

# Install dependencies
cd frontend && npm install
```

### Redis

```powershell
# Start Redis
redis-server

# Monitor Redis commands
redis-cli monitor

# Check Redis info
redis-cli info

# Clear Redis cache
redis-cli flushall
```

### PocketBase

```powershell
# Start PocketBase
cd C:\pocketbase && ./pocketbase.exe serve

# Export data
./pocketbase.exe export --out ./backup.zip

# Import data
./pocketbase.exe import ./backup.zip
```

---

## 📊 Expected Port Assignments

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | http://localhost:3000 |
| Backend API | 4000 | http://localhost:4000 |
| WebSocket | 4001 | ws://localhost:4001 |
| PocketBase | 8090 | http://localhost:8090 |
| Redis | 6379 | localhost:6379 |

---

## 📁 Directory Structure After Setup

```
esim/
├── backend/
│   ├── src/
│   ├── .env          ← Backend configuration
│   ├── package.json
│   └── README.md
│
├── frontend/
│   ├── server/
│   │   ├── server.js
│   │   └── package.json
│   ├── js/           ← Frontend code
│   ├── css/
│   ├── index.html    ← User app entry
│   ├── admin.html    ← Admin panel
│   └── .env
│
├── admin/            ← Standalone admin PWA
│   ├── index.html
│   ├── js/
│   └── css/
│
└── .gitignore
```

---

## 🎓 Next Steps After Startup

1. **User Registration & Login** ✅ Test on http://localhost:3000
2. **Explore Home Screen** - See balance, packages, eSIMs
3. **Buy an eSIM** - Follow the purchase flow
4. **Check Admin Panel** - http://localhost:3000/admin.html
5. **Test WebSocket** - Real-time balance updates
6. **Review Logs** - Check backend logs for debugging

---

## 📞 Quick Reference

| Need | Command |
|------|---------|
| Restart everything | Kill all terminals, run Step 1-4 again |
| Kill Node processes | `Stop-Process -Name node -Force` |
| Kill Redis | `redis-cli shutdown` |
| Check ports | `netstat -ano` |
| View backend logs | `cd backend && tail -f logs/app.log` |
| Clear all data | Delete PocketBase db folder + restart |

---

## ✨ You're Ready!

If all 4 services are running and you can access:
- ✅ http://localhost:3000 (frontend)
- ✅ http://localhost:4000/health (backend)
- ✅ http://localhost:8090 (PocketBase)

**Start testing!** Go to http://localhost:3000 and create an account.

---

**Questions?** Check [DEV_REFERENCE.md](./DEV_REFERENCE.md) or [README.md](./README.md)

*Last updated: 2026-08-16*
