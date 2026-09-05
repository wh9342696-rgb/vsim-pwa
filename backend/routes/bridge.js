import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/db.js';
import { decryptBridgeSecret, hashBridgeSecret } from '../utils/bridge-secret.js';
import { emitDataChanged } from '../realtime.js';

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

function createIccid() {
  return `8944${Date.now().toString().slice(-8)}${Math.floor(100000 + Math.random() * 900000)}`;
}

function parseDataGb(value) {
  const match = String(value || '').match(/([\d.]+)\s*(KB|MB|GB|TB)?/i);
  if (!match) return null;
  const multipliers = { KB: 1 / 1024 / 1024, MB: 1 / 1024, GB: 1, TB: 1024 };
  return Number(match[1]) * (multipliers[String(match[2] || 'GB').toUpperCase()] || 1);
}

function formatDataGb(value, unit = 'GB') {
  const multipliers = { KB: 1024 * 1024, MB: 1024, GB: 1, TB: 1 / 1024 };
  return `${Number((value * (multipliers[unit] || 1)).toFixed(2))} ${unit}`;
}

async function fulfillVerifiedPurchase(payment) {
  if (!payment.package_id || !payment.user_id) {
    await query(
      `UPDATE payment_requests
       SET status = 'completed', payment_status = 'PAYMENT_VERIFIED'
       WHERE id = $1`,
      [payment.id]
    );
    return { fulfilled: false };
  }

  const packageResult = await query('SELECT * FROM esim_packages WHERE id = $1', [payment.package_id]);
  if (!packageResult.rows.length) throw new Error('PACKAGE_NOT_FOUND');
  const pkg = packageResult.rows[0];
  const validityDays = Math.max(1, Number(String(pkg.validity || '').match(/\d+(?:\.\d+)?/)?.[0] || 30));
  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();
  const progressRate = Math.max(0, Math.min(100, Number(pkg.progress_percent_per_hour) || 0.42));

  if (payment.target_esim_id) {
    const current = await query('SELECT data_total, data_remaining, renewal_count FROM user_esims WHERE id = $1 AND user_id = $2', [payment.target_esim_id, payment.user_id]);
    if (!current.rows[0]) throw new Error('TARGET_ESIM_NOT_FOUND');
    const unit = String(current.rows[0].data_total || pkg.data_quota || 'GB').match(/[A-Za-z]+/)?.[0]?.toUpperCase() || 'GB';
    const currentTotal = parseDataGb(current.rows[0].data_total) || 0;
    const currentRemaining = parseDataGb(current.rows[0].data_remaining) || 0;
    const bundle = parseDataGb(pkg.data_quota) || 0;
    const updateResult = await query(
      `UPDATE user_esims
       SET package_id = $1, title = $2, status = 'active', data_total = $3,
           data_remaining = $4, daily_income = $5, progress_percent_per_hour = $6,
           renewal_count = COALESCE(renewal_count, 0) + 1, activated_at = CURRENT_TIMESTAMP, expires_at = $7
         WHERE id = $8 AND user_id = $9`,
      [pkg.id, pkg.title, formatDataGb(currentTotal + bundle, unit), formatDataGb(currentRemaining + bundle, unit), pkg.income || 0, progressRate, expiresAt, payment.target_esim_id, payment.user_id]
    );
    if (!updateResult.rows.length) throw new Error('TARGET_ESIM_NOT_FOUND');
  } else {
    let iccid = createIccid();
    while ((await query('SELECT id FROM user_esims WHERE iccid = $1', [iccid])).rows.length) iccid = createIccid();
    await query(
      `INSERT INTO user_esims (user_id, package_id, title, country, iccid, status, data_total, data_remaining, daily_income, progress_percent_per_hour, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, $7, $8, $9)`,
      [payment.user_id, pkg.id, pkg.title, pkg.country || 'Global', iccid, pkg.data_quota || '10 GB', pkg.income || 0, progressRate, expiresAt]
    );
  }

  await query(
    `UPDATE payment_requests
     SET status = 'completed', payment_status = 'PAYMENT_VERIFIED', order_status = 'ESIM_READY', provisioning_status = 'COMPLETED'
     WHERE id = $1`,
    [payment.id]
  );
  await query('UPDATE esim_packages SET sold_count = sold_count + 1, revenue = revenue + $1 WHERE id = $2', [payment.amount, pkg.id]);
  const buyer = await query('SELECT name, referred_by FROM users WHERE id = $1', [payment.user_id]);
  const referredBy = buyer.rows[0]?.referred_by;
  if (referredBy) {
    const referrer = await query('SELECT id FROM users WHERE referral_code = $1', [referredBy]);
    const commissionRate = Math.max(0, Math.min(100, Number(pkg.commission_percent) || 10));
    const commission = Math.round(Number(pkg.price) * commissionRate / 100);
    const commissionRef = `COMM-ESIM-${payment.user_id}-${payment.id}`;
    if (referrer.rows[0] && commission > 0 && !(await query('SELECT id FROM wallet_transactions WHERE reference = $1', [commissionRef])).rows.length) {
      await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [commission, referrer.rows[0].id]);
      await query(`INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status) VALUES ($1, 'referral', $2, $3, $4, 'completed')`, [referrer.rows[0].id, `Referral Commission (${pkg.title})`, commission, commissionRef]);
      await query(`INSERT INTO notifications (user_id, title, message, category) VALUES ($1, $2, $3, 'wallet')`, [referrer.rows[0].id, 'Referral Commission Earned!', `UGX ${commission.toLocaleString()} commission was added for ${buyer.rows[0]?.name || 'a referred user'} purchasing ${pkg.title}.`]);
    }
  }
  await query(
    `INSERT INTO notifications (user_id, title, message, category)
     VALUES ($1, $2, $3, $4)`,
    [payment.user_id, 'eSIM Ready', `${pkg.title} was verified and added to your account.`, 'esim']
  );
  return { fulfilled: true };
}

async function bridgeAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'BRIDGE_CREDENTIAL_REQUIRED' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'vsim-api', audience: 'vsim-bridge' });
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
  const deviceId = String(req.body?.bridgeDeviceId || req.body?.deviceId || req.body?.device_id || req.body?.id || '').trim();
  const deviceSecret = String(req.body?.deviceSecret || req.body?.credential || req.body?.device_secret || req.body?.secret || '').trim();
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
  const token = jwt.sign({ deviceId, bridge: true }, JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256', issuer: 'vsim-api', audience: 'vsim-bridge' });
  await query('UPDATE bridge_devices SET status = $1, last_heartbeat = CURRENT_TIMESTAMP WHERE device_id = $2', ['active', deviceId]);
  res.json({ token, deviceId, provider: device.provider, merchantId: device.merchant_id, expiresIn: 43200 });
});

router.get('/config', bridgeAuth, async (req, res) => {
  res.json({ deviceId: req.bridge.device_id, provider: req.bridge.provider, merchantId: req.bridge.merchant_id, merchantBindings: { MTN: req.bridge.mtn_merchant_id || null, AIRTEL: req.bridge.airtel_merchant_id || null }, simLines: { MTN: req.bridge.mtn_sim_phone || null, AIRTEL: req.bridge.airtel_sim_phone || null }, status: req.bridge.status, appVersion: req.bridge.app_version || null, simBalance: Number(req.bridge.sim_balance || 0), pingMs: req.bridge.ping_ms });
});

router.post('/heartbeat', bridgeAuth, async (req, res) => {
  const appVersion = String(req.body?.appVersion || req.bridge.app_version || '').slice(0, 40);
  const queueSize = Math.max(0, Number(req.body?.queueSize) || 0);
  const hasSimBalance = req.body?.simBalance !== undefined && req.body?.simBalance !== null;
  const simBalance = hasSimBalance ? Number(req.body.simBalance) : null;
  const simLines = req.body?.simLines && typeof req.body.simLines === 'object' ? req.body.simLines : {};
  const mtnSimPhone = simLines.MTN || simLines.mtn || simLines.mtnPhone || null;
  const airtelSimPhone = simLines.AIRTEL || simLines.airtel || simLines.airtelPhone || null;
  const hasPingMs = req.body?.pingMs !== undefined && req.body?.pingMs !== null;
  const pingMs = hasPingMs ? Number(req.body.pingMs) : null;
  if (hasSimBalance && (!Number.isFinite(simBalance) || simBalance < 0)) return res.status(400).json({ error: 'INVALID_SIM_BALANCE' });
  if (hasPingMs && (!Number.isFinite(pingMs) || pingMs < 0 || pingMs > 60000)) return res.status(400).json({ error: 'INVALID_PING_MS' });
  await query(`UPDATE bridge_devices
    SET status = $1, app_version = $2, last_heartbeat = CURRENT_TIMESTAMP, last_sync = CURRENT_TIMESTAMP,
        sim_balance = CASE WHEN $3 THEN $4 ELSE COALESCE(sim_balance, 0) END,
        ping_ms = CASE WHEN $5 THEN $6 ELSE ping_ms END,
        mtn_sim_phone = COALESCE($7, mtn_sim_phone),
        airtel_sim_phone = COALESCE($8, airtel_sim_phone)
    WHERE device_id = $9`, ['active', appVersion, hasSimBalance, simBalance, hasPingMs, pingMs, mtnSimPhone, airtelSimPhone, req.bridge.device_id]);
  res.json({ status: 'ONLINE', queueSize, simBalance: hasSimBalance ? simBalance : Number(req.bridge.sim_balance || 0), pingMs: hasPingMs ? pingMs : req.bridge.ping_ms, simLines: { MTN: mtnSimPhone || req.bridge.mtn_sim_phone || null, AIRTEL: airtelSimPhone || req.bridge.airtel_sim_phone || null }, serverTime: new Date().toISOString() });
});

router.post('/events', bridgeAuth, async (req, res) => {
  const parsed = eventSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_EVENT', details: parsed.error.issues.map(issue => issue.path.join('.')) });
  const event = parsed.data;
  const eventProvider = String(event.provider || '').toUpperCase();
  const boundMerchant = eventProvider === 'MTN' ? req.bridge.mtn_merchant_id : eventProvider === 'AIRTEL' ? req.bridge.airtel_merchant_id : req.bridge.merchant_id;
  if (String(boundMerchant || req.bridge.merchant_id || '') !== String(event.merchantId)) return res.status(403).json({ error: 'MERCHANT_NOT_AUTHORIZED' });
  if (String(req.bridge.provider || eventProvider).toLowerCase() !== String(event.provider || '').toLowerCase() && ![req.bridge.mtn_merchant_id, req.bridge.airtel_merchant_id].includes(String(event.merchantId))) return res.status(403).json({ error: 'PROVIDER_NOT_AUTHORIZED' });
  try {
    const result = await query(
      `INSERT INTO bridge_events (bridge_device_id, provider, merchant_id, transaction_reference, transaction_type, amount, currency, provider_timestamp, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'REVIEW_REQUIRED')`,
      [req.bridge.device_id, event.provider, event.merchantId, event.transactionReference, event.transactionType, event.amount, event.currency, event.providerTimestamp || null, JSON.stringify({ ...event.metadata, eventId: event.eventId || null })]
    );
    const eventId = result.rows[0]?.id;
    emitDataChanged('bridge_event', { type: 'bridge_event', eventId, deviceId: req.bridge.device_id });
    let status = 'REVIEW_REQUIRED';
    if (event.transactionType === 'deposit') {
      const requestedReference = String(event.metadata.orderReference || event.metadata.reference || '').trim();
      const pending = await query(
        `SELECT * FROM payment_requests
         WHERE status IN ('pending', 'PAYMENT_AWAITING_VERIFICATION')
           AND amount = $1
           AND (merchant = $2 OR network = $3)
           AND ($4 = '' OR reference = $4)
         ORDER BY created_at ASC LIMIT 2`,
        [event.amount, event.merchantId, event.provider, requestedReference]
      );
      const senderPhone = String(event.metadata.senderPhone || event.metadata.senderNumber || '').replace(/\s+/g, '');
      const candidates = pending.rows.filter(payment => !senderPhone || !payment.phone || payment.phone === 'Not provided' || String(payment.phone).replace(/\s+/g, '') === senderPhone);
      if (pending.rows.length === 1 && candidates.length === 1) {
        const deposit = pending.rows[0];
        const fulfillment = await fulfillVerifiedPurchase(deposit);
        const txReference = `BRIDGE-${event.provider}-${event.transactionReference}`;
        const duplicateCredit = await query('SELECT id FROM wallet_transactions WHERE reference = $1', [txReference]);
        if (!duplicateCredit.rows.length && deposit.user_id && !fulfillment.fulfilled) {
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
        } else if (fulfillment.fulfilled) {
          status = 'MATCHED';
        }
      } else if (pending.rows.length > 1) {
        status = 'REVIEW_REQUIRED';
      } else {
        status = 'UNMATCHED';
      }
      await query('UPDATE bridge_events SET status = $1 WHERE id = $2', [status, eventId]);
      emitDataChanged('bridge_event', { type: 'bridge_event', eventId, deviceId: req.bridge.device_id, status });
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
  res.json({ deviceId: req.bridge.device_id, status: req.bridge.status, provider: req.bridge.provider, merchantId: req.bridge.merchant_id, lastHeartbeat: req.bridge.last_heartbeat, lastSync: req.bridge.last_sync, appVersion: req.bridge.app_version, simBalance: Number(req.bridge.sim_balance || 0), pingMs: req.bridge.ping_ms, simLines: { MTN: req.bridge.mtn_sim_phone || null, AIRTEL: req.bridge.airtel_sim_phone || null } });
});

export default router;
