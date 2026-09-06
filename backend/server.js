import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production');
}
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'vsim_super_secret_production_key_2026') {
  throw new Error('The development JWT_SECRET cannot be used in production');
}
if (process.env.NODE_ENV === 'production' && (!process.env.FRONTEND_URL || !process.env.FRONTEND_URL.startsWith('https://'))) {
  throw new Error('FRONTEND_URL must be an HTTPS origin in production');
}
if (process.env.NODE_ENV === 'production' && (!process.env.WEBAUTHN_RP_ID || !process.env.WEBAUTHN_ORIGIN || !process.env.WEBAUTHN_ORIGIN.startsWith('https://'))) {
  throw new Error('WEBAUTHN_RP_ID and HTTPS WEBAUTHN_ORIGIN are required in production');
}
if (process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY !== '1') {
  throw new Error('TRUST_PROXY=1 is required when running behind the configured reverse proxy');
}
if (process.env.NODE_ENV === 'production' && (!process.env.DEVICE_SECRET_ENCRYPTION_KEY || process.env.DEVICE_SECRET_ENCRYPTION_KEY.length < 32)) {
  throw new Error('DEVICE_SECRET_ENCRYPTION_KEY must be set to at least 32 characters in production');
}

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const configuredCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const localFrontendDir = path.resolve(__dirname, '../frontend');
const productionFrontendDir = '/var/www/vsim/frontend';
const frontendPublicDir = fs.existsSync(productionFrontendDir) ? productionFrontendDir : localFrontendDir;
const hasFrontend = fs.existsSync(path.join(frontendPublicDir, 'index.html'));

console.log('[STARTUP] frontendPublicDir:', frontendPublicDir);
console.log('[STARTUP] production exists:', fs.existsSync(productionFrontendDir));
console.log('[STARTUP] local exists:', fs.existsSync(localFrontendDir));

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
      connectSrc: process.env.NODE_ENV === 'production' ? ["'self'", frontendUrl] : ["'self'", frontendUrl, 'http://localhost:4000', 'ws://localhost:4001', 'http://localhost:3000'],
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
const allowedOrigins = new Set([
  ...(process.env.NODE_ENV === 'production' ? [] : [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ]),
  frontendUrl,
  ...configuredCorsOrigins
].filter(Boolean));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    const error = new Error(`CORS blocked for origin: ${origin}`);
    error.status = 403;
    callback(error);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
morgan.token('safe-url', req => tokensUrl(req));
function tokensUrl(req) {
  return String(req.originalUrl || req.url || '').replace(/([?&]token=)[^&\s]+/gi, '$1[REDACTED]');
}
app.use(morgan(process.env.NODE_ENV === 'production'
  ? ':remote-addr - :method :safe-url HTTP/:http-version :status :res[content-length] ":referrer" ":user-agent"'
  : ':method :safe-url :status', {
  skip: req => req.path === '/health',
  stream: { write: message => process.stdout.write(message.replace(/(authorization: Bearer |token=)[^\s&]+/gi, '$1[REDACTED]')) }
}));

// Rate Limiter: allow normal app polling without blocking user actions.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, please try again later.' }
});
const adminApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please wait briefly and try again.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please wait a few minutes and try again.' }
});

app.use(['/api/v1/auth/login', '/api/auth/login', '/api/v1/auth/passkey/login/options', '/api/auth/passkey/login/options', '/api/v1/admin/login', '/api/admin/login'], authLimiter);
app.use(['/api/v1/admin', '/api/admin'], adminApiLimiter);

app.use('/api', (req, res, next) => {
  const path = req.path || '';
  const isPublicCatalog = req.method === 'GET' && path === '/v1/esims/packages';
  const isPublicSupportConfig = req.method === 'GET' && path === '/v1/support/config';
  const isRealtimeRoute = path === '/v1/realtime';
  const isAdminRoute = path === '/v1/admin' || path.startsWith('/v1/admin/');

  if (isPublicCatalog || isPublicSupportConfig || isRealtimeRoute || isAdminRoute) {
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
    const user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'vsim-api', audience: ['vsim-client', 'vsim-admin'] });
    const userId = Number(user.id);
    const isAdmin = Boolean(user.role);
    query(isAdmin
      ? 'SELECT id, role, status, current_session_token FROM admin_users WHERE id = $1'
      : 'SELECT id, current_session_token FROM users WHERE id = $1', [userId]).then(result => {
      const record = result.rows[0];
      if (!record || record.status === 'inactive' || record.current_session_token !== user.sessionToken) {
        res.status(403).end();
        return;
      }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ id: user.id, role: user.role || 'user' })}\n\n`);

    const sendChange = payload => {
      if (payload?.type === 'support' && payload.audience) {
        const allowed = payload.audience.some(target => (target.type === (isAdmin ? 'admin' : 'user') && Number(target.id) === userId) || (isAdmin && target.type === 'admin_role' && target.role === user.role));
        if (!allowed) return;
      }
      res.write(`event: data_changed\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    realtimeEvents.on('data_changed', sendChange);
    req.on('close', () => {
      clearInterval(heartbeat);
      realtimeEvents.off('data_changed', sendChange);
    });
    }).catch(() => res.status(503).end());
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired realtime token' });
  }
});

// Route for direct /admin URL - serve admin.html
// MUST come BEFORE static middleware to prevent 404
app.get('/admin', (req, res) => {
  if (!hasFrontend) return res.status(404).json({ error: 'Frontend is hosted separately' });
  const adminPath = path.join(frontendPublicDir, 'admin.html');
  res.sendFile(adminPath, (err) => {
    if (err) {
      console.error('[ROUTE /admin] Error sending admin.html:', err.message);
      res.status(404).json({ error: 'admin.html not found', path: adminPath });
    }
  });
});

// Route for short referral links (/r/VSIM123456 -> /?ref=VSIM123456)
app.get('/r/:code', (req, res) => {
  const code = encodeURIComponent(req.params.code || '');
  res.redirect(`/?ref=${code}`);
});

// Serve static frontend files (PWA, Admin, Icons, CSS, JS)
// NOTE: Directory must exist at /var/www/vsim/frontend on VPS
// This comes AFTER explicit routes to allow them to execute first
try {
  if (hasFrontend) app.use(express.static(frontendPublicDir));
  console.log('[STARTUP] Static frontend serving enabled from:', frontendPublicDir);
} catch (err) {
  console.warn('[STARTUP] Could not serve frontend:', err.message);
}

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

// Fallback: Serve index.html for any non-API request (SPA routing)
app.get('*', (req, res) => {
  if (!hasFrontend) return res.status(404).json({ error: 'Frontend is hosted separately' });
  const indexPath = path.join(frontendPublicDir, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('[FALLBACK] Error sending index.html:', err.message);
      res.status(404).json({ error: 'index.html not found', path: indexPath });
    }
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  const status = Number(err.status) >= 400 && Number(err.status) < 500 ? Number(err.status) : 500;
  res.status(status).json({ error: status === 500 ? 'Internal Server Error' : (err.message || 'Request failed') });
});

// Initialize Automated Daily Yield Settlement Cron Job
startEarningsCronJob();

const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 VSIM API Server running on http://localhost:${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/health`);
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
