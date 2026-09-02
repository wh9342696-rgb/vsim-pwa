import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/db.js';
import { decryptBridgeSecret, hashBridgeSecret } from '../utils/bridge-secret.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

const eventSchema = z.object({
  eventId: z.string().min(6).max(160).optional(),
  provider: z.string().min(2).max(40),
  merchantId: z.string().min(1).max(120),
  transactionReference: z.string().min(3).max(160),
  transactionType: z.enum(['deposit', 'payment', 'reversal', 'unknown']),
  amount: z.number().positive().finite(),
  currency: z.string().length(3).default('UGX'),
  providerTimestamp: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({})
});

async function bridgeAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'BRIDGE_CREDENTIAL_REQUIRED' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.bridge !== true || !decoded.deviceId) return res.status(403).json({ error: 'BRIDGE_TOKEN_REQUIRED' });
    const result = await query('SELECT * FROM bridge_devices WHERE device_id = $1', [decoded.deviceId]);
    const device = result.rows[0];
    if (!device) return res.status(401).json({ error: 'DEVICE_NOT_FOUND' });
    if (device.status === 'revoked' || device.revoked_at) return res.status(403).json({ error: 'DEVICE_REVOKED' });
    if (device.status === 'disabled') return res.status(403).json({ error: 'DEVICE_DISABLED' });
    req.bridge = device;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'INVALID_CREDENTIAL' });
  }
}

router.post('/register', async (req, res) => {
  const deviceId = String(req.body?.bridgeDeviceId || req.body?.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'bridgeDeviceId is required' });
  const result = await query('SELECT device_id, status, provider, merchant_id, app_version FROM bridge_devices WHERE device_id = $1', [deviceId]);
  if (!result.rows.length) return res.status(403).json({ error: 'DEVICE_UNPROVISIONED' });
  res.json({ device: result.rows[0], message: 'Device is provisioned; authenticate to continue' });
});

router.post(['/auth', '/authenticate'], async (req, res) => {
  const deviceId = String(req.body?.bridgeDeviceId || req.body?.deviceId || '').trim();
  const deviceSecret = String(req.body?.deviceSecret || req.body?.credential || '').trim();
  if (!deviceId || !deviceSecret) return res.status(400).json({ error: 'bridgeDeviceId and deviceSecret are required' });
  const result = await query('SELECT * FROM bridge_devices WHERE device_id = $1', [deviceId]);
  const device = result.rows[0];
  if (!device) return res.status(401).json({ error: 'DEVICE_UNPROVISIONED' });
  if (device.status === 'revoked' || device.revoked_at) return res.status(403).json({ error: 'DEVICE_REVOKED' });
  if (device.status === 'disabled') return res.status(403).json({ error: 'DEVICE_DISABLED' });
  const suppliedHash = hashBridgeSecret(deviceSecret);
  const storedHash = String(device.credential_hash || '');
  const secretMatches = device.device_secret
    ? deviceSecret === decryptBridgeSecret(device.device_secret)
    : Boolean(storedHash) && suppliedHash === storedHash;
  if (!secretMatches) return res.status(401).json({ error: 'INVALID_DEVICE_SECRET' });
  const token = jwt.sign({ deviceId, bridge: true }, JWT_SECRET, { expiresIn: '12h' });
  await query('UPDATE bridge_devices SET status = $1, last_heartbeat = CURRENT_TIMESTAMP WHERE device_id = $2', ['active', deviceId]);
  res.json({ token, deviceId, provider: device.provider, merchantId: device.merchant_id, expiresIn: 43200 });
});

router.get('/config', bridgeAuth, async (req, res) => {
  res.json({ deviceId: req.bridge.device_id, provider: req.bridge.provider, merchantId: req.bridge.merchant_id, status: req.bridge.status, appVersion: req.bridge.app_version || null });
});

router.post('/heartbeat', bridgeAuth, async (req, res) => {
  const appVersion = String(req.body?.appVersion || req.bridge.app_version || '').slice(0, 40);
  const queueSize = Math.max(0, Number(req.body?.queueSize) || 0);
  await query('UPDATE bridge_devices SET status = $1, app_version = $2, last_heartbeat = CURRENT_TIMESTAMP, last_sync = CURRENT_TIMESTAMP, sim_balance = COALESCE(sim_balance, 0) WHERE device_id = $3', ['active', appVersion, req.bridge.device_id]);
  res.json({ status: 'ONLINE', queueSize, serverTime: new Date().toISOString() });
});

router.post('/events', bridgeAuth, async (req, res) => {
  const parsed = eventSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_EVENT', details: parsed.error.issues.map(issue => issue.path.join('.')) });
  const event = parsed.data;
  if (String(req.bridge.merchant_id || '') !== String(event.merchantId)) return res.status(403).json({ error: 'MERCHANT_NOT_AUTHORIZED' });
  if (String(req.bridge.provider || '').toLowerCase() !== String(event.provider || '').toLowerCase()) return res.status(403).json({ error: 'PROVIDER_NOT_AUTHORIZED' });
  try {
    const result = await query(
      `INSERT INTO bridge_events (bridge_device_id, provider, merchant_id, transaction_reference, transaction_type, amount, currency, provider_timestamp, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'REVIEW_REQUIRED')`,
      [req.bridge.device_id, event.provider, event.merchantId, event.transactionReference, event.transactionType, event.amount, event.currency, event.providerTimestamp || null, JSON.stringify({ ...event.metadata, eventId: event.eventId || null })]
    );
    const eventId = result.rows[0]?.id;
    let status = 'REVIEW_REQUIRED';
    if (event.transactionType === 'deposit') {
      const pending = await query(
        `SELECT * FROM payment_requests
         WHERE status = 'pending' AND amount = $1 AND (merchant = $2 OR network = $3)
         ORDER BY created_at ASC LIMIT 2`,
        [event.amount, event.merchantId, event.provider]
      );
      if (pending.rows.length === 1) {
        const deposit = pending.rows[0];
        await query('UPDATE payment_requests SET status = $1 WHERE id = $2 AND status = $3', ['completed', deposit.id, 'pending']);
        const txReference = `BRIDGE-${event.provider}-${event.transactionReference}`;
        const duplicateCredit = await query('SELECT id FROM wallet_transactions WHERE reference = $1', [txReference]);
        if (!duplicateCredit.rows.length && deposit.user_id) {
          await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [event.amount, deposit.user_id]);
          await query(
            `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
             VALUES ($1, 'topup', $2, $3, $4, 'completed')`,
            [deposit.user_id, `Bridge deposit (${event.provider})`, event.amount, txReference]
          );
          await query(
            `INSERT INTO notifications (user_id, title, message, category)
             VALUES ($1, $2, $3, $4)`,
            [deposit.user_id, 'Deposit Confirmed', `UGX ${event.amount.toLocaleString()} was verified by the ${event.provider} bridge.`, 'wallet']
          );
          status = 'MATCHED';
        }
      } else if (pending.rows.length > 1) {
        status = 'REVIEW_REQUIRED';
      } else {
        status = 'UNMATCHED';
      }
      await query('UPDATE bridge_events SET status = $1 WHERE id = $2', [status, eventId]);
    }
    res.status(201).json({ acknowledged: true, duplicate: false, eventId, status });
  } catch (error) {
    if (String(error.message).toLowerCase().includes('unique')) {
      const existing = await query('SELECT id, status FROM bridge_events WHERE bridge_device_id = $1 AND provider = $2 AND merchant_id = $3 AND transaction_reference = $4', [req.bridge.device_id, event.provider, event.merchantId, event.transactionReference]);
      return res.json({ acknowledged: true, duplicate: true, eventId: existing.rows[0]?.id, status: existing.rows[0]?.status });
    }
    res.status(500).json({ error: 'EVENT_STORAGE_FAILED' });
  }
});

router.post('/sync', bridgeAuth, async (req, res) => res.json({ acknowledged: true, pending: 0, serverTime: new Date().toISOString() }));
router.post('/acknowledge', bridgeAuth, async (req, res) => res.json({ acknowledged: true }));

router.get('/status', bridgeAuth, async (req, res) => {
  res.json({ deviceId: req.bridge.device_id, status: req.bridge.status, provider: req.bridge.provider, merchantId: req.bridge.merchant_id, lastHeartbeat: req.bridge.last_heartbeat, lastSync: req.bridge.last_sync, appVersion: req.bridge.app_version });
});

export default router;
