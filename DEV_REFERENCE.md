# 🔧 Development Reference

Quick reference for common commands and workflows when developing on the VSIM monorepo.

---

## Quick Commands

### Start All Services

**Fast start (4 terminals):**

```bash
# Terminal 1: PocketBase
cd C:\pocketbase && ./pocketbase.exe serve

# Terminal 2: Redis
redis-server

# Terminal 3: Backend
cd c:\Users\This PC\Desktop\esim\backend && npm run dev

# Terminal 4: Frontend
cd c:\Users\This PC\Desktop\esim\frontend && npm run dev
```

Then open:
- http://localhost:3000 (User App)
- http://localhost:3000/admin.html (Admin)
- http://localhost:8090/admin (PocketBase)

---

### Backend Development

```bash
cd backend

# Install dependencies
npm install

# Start dev server (auto-restart)
npm run dev

# Run tests
npm test

# Linting
npm run lint

# Production build
npm run build

# PM2 cluster (production)
npm run pm2:start

# View PM2 logs
pm2 logs momo-api

# Stop PM2
pm2 stop all
pm2 delete all
```

---

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev

# Stop server
# Ctrl+C

# Production build
npm run build

# Production start
npm start
```

---

## API Testing

### Using curl

```bash
# Health check
curl http://localhost:3000/health
curl http://localhost:4000/health

# User signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "phone": "+256700123456",
    "password": "Test123",
    "referralCode": ""
  }'

# User login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+256700123456",
    "password": "Test123"
  }'

# Get wallet balance (requires token from login)
curl http://localhost:3000/api/wallet/balance \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Browse eSIM packages
curl http://localhost:3000/api/esims/packages

# List notifications
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer {JWT_TOKEN}"
```

### Using Postman

1. Download [Postman](https://www.postman.com/)
2. Import environment: Create new environment with variables:
   ```
   {
     "base_url": "http://localhost:3000",
     "token": "",
     "user_id": ""
   }
   ```
3. Use `{{base_url}}/api/...` in requests
4. Save token from login response to `{{token}}`

---

## Database Management

### PocketBase Admin UI

- **URL:** http://localhost:8090/admin
- **Create Collections:** Settings → Import Collections
- **View Data:** Click collection name in left sidebar
- **Backup:** Entire PocketBase data is in `pb_data/` folder

### Backup & Restore

```bash
# Backup PocketBase data
cp -r C:\pocketbase\pb_data C:\pocketbase\pb_data_backup

# Clear all data (careful!)
rm -rf C:\pocketbase\pb_data

# Restore backup
cp -r C:\pocketbase\pb_data_backup C:\pocketbase\pb_data
```

---

## Debugging

### Frontend Console (DevTools)

```bash
# Press F12 (Windows) or Cmd+Option+I (Mac)
# Go to Console tab

# Test API connectivity
await fetch('http://localhost:3000/health').then(r => r.json())

# Check if JWT token is stored
localStorage.getItem('vsim_jwt_token')

# Clear all storage
localStorage.clear()
sessionStorage.clear()

# View all stored data
console.log(localStorage)
console.log(sessionStorage)
```

### Backend Logs

```bash
# View all backend logs
pm2 logs momo-api

# View only errors
pm2 logs momo-api --err

# Real-time monitoring
pm2 monit
```

### Check Ports

```bash
# Which process is using port 3000?
netstat -ano | findstr :3000

# Kill process (get PID from above)
taskkill /PID 12345 /F

# Or using npm
npx kill-port 3000
```

---

## Common Development Tasks

### Add New Endpoint

**Example: Add GET /api/wallet/transactions**

1. **Create validator** in `backend/src/modules/wallet/wallet.validator.js`:
```javascript
export const getTransactionsSchema = z.object({
  page: z.coerce.number().default(1),
  perPage: z.coerce.number().default(20)
});
```

2. **Add service method** in `backend/src/modules/wallet/wallet.service.js`:
```javascript
async getTransactions(userId, { page, perPage }) {
  return walletTransactionRepository.list({ page, perPage, filter: `user = "${userId}"` });
}
```

3. **Add controller** in `backend/src/modules/wallet/wallet.controller.js`:
```javascript
export const walletController = {
  // ... existing
  async getTransactions(req, res, next) {
    try {
      const parsed = getTransactionsSchema.safeParse(req.query);
      if (!parsed.success) return next(new AppError(...));
      
      const transactions = await walletService.getTransactions(req.user.id, parsed.data);
      res.json({ statusCode: 200, data: transactions });
    } catch (err) {
      next(err);
    }
  }
};
```

4. **Add route** in `backend/src/modules/wallet/wallet.routes.js`:
```javascript
router.get('/transactions', authenticate(), walletController.getTransactions);
```

5. **Test**:
```bash
curl http://localhost:4000/api/wallet/transactions?page=1&perPage=10 \
  -H "Authorization: Bearer {JWT_TOKEN}"
```

---

### Add New Module

**Example: Add /api/lottery module**

1. Create folder: `backend/src/modules/lottery/`

2. Create files:
   - `lottery.service.js` - Business logic
   - `lottery.repository.js` - Data access
   - `lottery.controller.js` - HTTP handlers
   - `lottery.routes.js` - Route definitions
   - `lottery.validator.js` - Input validation

3. Import in `backend/src/app.js`:
```javascript
import lotteryRoutes from './modules/lottery/lottery.routes.js';
// ... in routes setup
app.use('/lottery', lotteryRoutes);
```

4. Create PocketBase collection in admin UI (http://localhost:8090/admin)

---

### Add Background Job

**Example: Add daily lottery winner job**

1. Create `backend/src/jobs/lotteryWinner.job.js`:
```javascript
export async function runLotteryWinner() {
  logger.info('Running lottery winner selection');
  // ... logic
}
```

2. Register in `backend/src/jobs/scheduler.js`:
```javascript
import { runLotteryWinner } from './lotteryWinner.job.js';

cron.schedule('0 20 * * *', safe('lotteryWinner', runLotteryWinner));  // 8 PM daily
```

3. Test:
```bash
# Manually call job
node -e "import('./src/jobs/lotteryWinner.job.js').then(m => m.runLotteryWinner())"
```

---

### Update Environment Variable

1. Add to `.env.example`:
```env
LOTTERY_ENABLED=true
LOTTERY_POOL_PERCENTAGE=5
```

2. Add to `backend/src/config/env.js`:
```javascript
const schema = z.object({
  // ... existing
  LOTTERY_ENABLED: z.string().default('false'),
  LOTTERY_POOL_PERCENTAGE: z.coerce.number().default(5)
});
```

3. Update `.env` with new value:
```bash
LOTTERY_ENABLED=true
LOTTERY_POOL_PERCENTAGE=5
```

4. Use in code:
```javascript
import { env } from '../config/env.js';

if (env.LOTTERY_ENABLED === 'true') {
  // run lottery logic
}
```

---

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/add-lottery

# Make changes
# ... edit files

# Stage changes
git add .

# Commit
git commit -m "feat: add daily lottery winner job"

# Push to remote
git push origin feature/add-lottery

# Create pull request on GitHub
# ... merge after review

# Update local main
git checkout main
git pull origin main

# Clean up
git branch -d feature/add-lottery
```

---

## Performance Tips

### Backend

- ✅ Use Redis locks to prevent race conditions
- ✅ Use immutable ledger pattern for transactions
- ✅ Index PocketBase collection fields for faster queries
- ✅ Use pagination (page + perPage) for large result sets
- ✅ Enable compression middleware

### Frontend

- ✅ Lazy load screens (don't render all at once)
- ✅ Cache API responses in localStorage
- ✅ Use service worker for offline support
- ✅ Minimize re-renders with proper state management
- ✅ Use CSS animations sparingly

---

## Security Reminders

- ⚠️ Never commit `.env` files
- ⚠️ Never expose JWT secrets in code
- ⚠️ Always validate input with Zod
- ⚠️ Always check user permissions before allowing actions
- ⚠️ Use HTTPS in production (update `ALLOWED_ORIGINS`)
- ⚠️ Keep Node.js and npm packages updated

---

## Useful Links

- **PocketBase Docs:** https://pocketbase.io/docs/
- **Express.js Docs:** https://expressjs.com/
- **Zod Validation:** https://zod.dev/
- **Redis Commands:** https://redis.io/commands/
- **PM2 Guide:** https://pm2.keymetrics.io/docs/usage/pm2-doc-single-page/
- **Node.js Best Practices:** https://github.com/goldbergyoni/nodebestpractices

---

## Quick Fixes

### Clear npm cache
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Restart everything
```bash
# Kill all Node processes
taskkill /F /IM node.exe

# Kill Redis
taskkill /F /IM redis-server.exe

# Then restart in terminals as normal
```

### Reset database
```bash
# WARNING: This deletes all data!
rm -rf C:\pocketbase\pb_data
# Restart PocketBase - it will recreate empty pb_data
```

### Clear browser cache
```javascript
// In browser console (F12)
localStorage.clear()
sessionStorage.clear()
// Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
```

---

**Happy coding! 🚀**

