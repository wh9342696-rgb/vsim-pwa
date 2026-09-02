import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import esimRoutes from './routes/esims.js';
import walletRoutes from './routes/wallet.js';
import airtimeRoutes from './routes/airtime.js';
import referralRoutes from './routes/referrals.js';
import notificationRoutes from './routes/notifications.js';
import paymentRoutes from './routes/payments.js';
import adminRoutes from './routes/admin.js';
import supportRoutes from './routes/support.js';
import bridgeRoutes from './routes/bridge.js';
import { startEarningsCronJob } from './jobs/earnings.js';
import jwt from 'jsonwebtoken';
import { realtimeEvents } from './realtime.js';
import { closeDatabase, query } from './config/db.js';

dotenv.config();

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production');
}
if (process.env.NODE_ENV === 'production' && (!process.env.FRONTEND_URL || !process.env.FRONTEND_URL.startsWith('https://'))) {
  throw new Error('FRONTEND_URL must be an HTTPS origin in production');
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const frontendUrl = process.env.FRONTEND_URL || 'https://vsime.uk';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || `${frontendUrl},https://*.pages.dev`)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOriginPatterns = allowedOrigins.map(origin =>
  origin.startsWith('https://*.') ? new RegExp(`^https:\\/\\/[^/]+${origin.slice('https://*'.length).replace('.', '\\.')}$`) : null
).filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return allowedOrigins.includes(origin) || allowedOriginPatterns.some(pattern => pattern.test(origin));
}

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Security Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          connectSrc: ["'self'", frontendUrl, 'https://api.vsime.uk', 'wss://api.vsime.uk'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: process.env.NODE_ENV === 'production',
  noSniff: true,
  frameguard: { action: 'deny' }
}));
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate Limiter: allow normal app polling without blocking user actions.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: req => Boolean(req.headers.authorization),
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/api', (req, res, next) => {
  const path = req.path || '';
  const isAuthLoginRoute = path.includes('/admin/login') || path.includes('/auth/login');
  const isAdminRoute = path.startsWith('/v1/admin') || path.startsWith('/admin');
  const isPublicCatalog = req.method === 'GET' && path === '/v1/esims/packages';
  const isRealtimeRoute = path === '/v1/realtime';

  if (isAuthLoginRoute || isAdminRoute || isPublicCatalog || isRealtimeRoute) {
    return next();
  }

  return apiLimiter(req, res, next);
});

// Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({
      status: 'online',
      service: 'VSIM REST API Server',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      service: 'VSIM REST API Server',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/v1/realtime', (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(401).json({ error: 'Realtime token required' });

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ id: user.id, role: user.role || 'user' })}\n\n`);

    const sendChange = payload => res.write(`event: data_changed\ndata: ${JSON.stringify(payload)}\n\n`);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    realtimeEvents.on('data_changed', sendChange);
    req.on('close', () => {
      clearInterval(heartbeat);
      realtimeEvents.off('data_changed', sendChange);
    });
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired realtime token' });
  }
});

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pwaPublicDir = path.join(__dirname, '../frontend');

// Serve static frontend files (PWA, Admin, Icons, CSS, JS)
app.use(express.static(pwaPublicDir));

// Route for direct /admin URL
app.get('/admin', (req, res) => {
  res.sendFile(path.join(pwaPublicDir, 'admin.html'));
});

// Route for short referral links (/r/VSIM123456 -> /?ref=VSIM123456)
app.get('/r/:code', (req, res) => {
  const code = encodeURIComponent(req.params.code || '');
  res.redirect(`/?ref=${code}`);
});

// REST API Route Mounts (Supports /api/v1 and /api)
const apiRoutes = [
  ['/auth', authRoutes],
  ['/esims', esimRoutes],
  ['/wallet', walletRoutes],
  ['/airtime', airtimeRoutes],
  ['/referrals', referralRoutes],
  ['/notifications', notificationRoutes],
  ['/payments', paymentRoutes],
  ['/admin', adminRoutes],
  ['/support', supportRoutes],
  ['/bridge', bridgeRoutes]
];

apiRoutes.forEach(([routePath, routeHandler]) => {
  app.use(`/api/v1${routePath}`, routeHandler);
  app.use(`/api${routePath}`, routeHandler);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Initialize Automated Daily Yield Settlement Cron Job
startEarningsCronJob();

const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 VSIM API Server running on http://0.0.0.0:${PORT}`);
  console.log(`📡 Health Check: http://0.0.0.0:${PORT}/health`);
  console.log(`🔒 Security: Helmet, Rate Limiter & JWT Active`);
  console.log(`=======================================================`);
});

async function shutdown(signal) {
  console.log(`[SERVER] ${signal} received, shutting down...`);
  server.close(async () => {
    try {
      await closeDatabase();
      process.exit(0);
    } catch (error) {
      console.error('[SERVER] Shutdown failed:', error);
      process.exit(1);
    }
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
