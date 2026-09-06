import express from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { createUniqueReference } from '../utils/reference.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = express.Router();
const merchantCursors = new Map();

const confirmDepositSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  phone: z.string().optional(),
  momoNumber: z.string().optional(),
  merchantId: z.union([z.number(), z.string()]).optional(),
  merchantCode: z.string().optional(),
  network: z.string().optional(),
  reference: z.string().optional(),
  packageId: z.string().optional(),
  targetEsimId: z.union([z.number(), z.string()]).optional(),
  targetEsimIccid: z.string().optional(),
  renewal: z.boolean().optional(),
  type: z.string().optional()
});

const paymentRequestSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  phone: z.string().optional(),
  network: z.string().optional()
});

function parseDataValue(value) {
  const match = String(value || '').trim().match(/([\d.]+)\s*(KB|MB|GB|TB)?/i);
  if (!match) return null;
  const unit = (match[2] || 'GB').toUpperCase();
  const multipliers = { KB: 1 / 1024 / 1024, MB: 1 / 1024, GB: 1, TB: 1024 };
  return { amount: Number(match[1]) * multipliers[unit], unit };
}

function formatDataValue(amountGb, unit) {
  const multipliers = { KB: 1024 * 1024, MB: 1024, GB: 1, TB: 1 / 1024 };
  return `${Number((amountGb * multipliers[unit]).toFixed(2))} ${unit}`;
}

function getValidityDays(value) {
  const days = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(days) && days > 0 ? Math.ceil(days) : 30;
}

function getRenewalPrice(pkg, renewalCount) {
  const basePrice = Number(pkg.price) || 0;
  let schedule = [];
  try { schedule = Array.isArray(pkg.renewal_schedule) ? pkg.renewal_schedule : JSON.parse(pkg.renewal_schedule || '[]'); } catch (error) {}
  const scheduled = schedule[Number(renewalCount) || 0];
  return scheduled && Number(scheduled.price) > basePrice ? Number(scheduled.price) : basePrice * (Number(renewalCount) > 0 ? 1.1 : 1);
}

// 1. Get Backend-Assigned Merchant for User Purchase / Deposit
// Real-time dynamic lookup with network filtering and rotation/priority load balancing
router.get('/assigned-merchant', async (req, res) => {
  try {
    const { network, amount, packageId } = req.query;

    const requestedNetwork = String(network || 'MTN').toUpperCase();
    const bindingColumn = requestedNetwork === 'AIRTEL' ? 'airtel_merchant_id' : 'mtn_merchant_id';
    const bridgeResult = await query(
      `SELECT bd.*, m.id AS merchant_id, m.name, m.merchant_code, m.account_name, m.phone AS merchant_phone, m.network, m.instructions
       FROM bridge_devices bd
       LEFT JOIN merchants m ON m.merchant_code = CASE WHEN $1 = 'AIRTEL' THEN bd.airtel_merchant_id ELSE bd.mtn_merchant_id END
       WHERE bd.status = 'active'
         AND bd.last_heartbeat >= CURRENT_TIMESTAMP - INTERVAL '2 minutes'
         AND NULLIF(bd.${bindingColumn}, '') IS NOT NULL
       ORDER BY bd.last_heartbeat DESC, bd.id ASC
       LIMIT 1`,
      [requestedNetwork]
    );
    const assignedBridge = bridgeResult.rows[0];
    if (!assignedBridge) {
      return res.status(503).json({ success: false, error: `No active ${requestedNetwork} bridge merchant is currently available.` });
    }
    const merchantCode = requestedNetwork === 'AIRTEL' ? assignedBridge.airtel_merchant_id : assignedBridge.mtn_merchant_id;
    const refCode = await createUniqueReference('VSIM', async candidate =>
      (await query('SELECT id FROM payment_requests WHERE reference = $1', [candidate])).rows.length > 0
    );

    const isMTN = requestedNetwork === 'MTN';
    const defaultInstructions = isMTN
      ? `Dial *165*3# -> Enter Merchant Code ${merchantCode} -> Enter Amount -> Enter Reference ${refCode} -> Confirm PIN`
      : `Dial *185*9# -> Enter Merchant ID ${merchantCode} -> Enter Amount -> Enter Reference ${refCode} -> Confirm PIN`;

    res.json({
      success: true,
      merchant: {
        id: assignedBridge.merchant_id,
        name: assignedBridge.name || `${requestedNetwork} Bridge Merchant`,
        merchant_code: merchantCode,
        network: requestedNetwork,
        account_name: assignedBridge.account_name || assignedBridge.name || merchantCode,
        phone: assignedBridge.merchant_phone || '',
        bridgeDeviceId: assignedBridge.device_id,
        instructions: assignedBridge.instructions || defaultInstructions
      },
      reference: refCode,
      amount: parseFloat(amount) || 0
    });
  } catch (err) {
    console.error('Assigned merchant error:', err);
    res.status(500).json({ success: false, error: 'Failed to assign real-time merchant' });
  }
});

// 2. User Submits Deposit / Purchase Confirmation to Merchant
router.post('/confirm-deposit', validateBody(confirmDepositSchema), async (req, res) => {
  try {
    const { amount, phone, momoNumber, merchantId, merchantCode, network, reference, packageId, targetEsimId, targetEsimIccid, renewal = false, type = 'esim_purchase' } = req.body;
    const num = parseFloat(amount);
    const isRenewal = Boolean(renewal || targetEsimId || targetEsimIccid);

    if (isNaN(num) || num < 1000) {
      return res.status(400).json({ success: false, error: 'Invalid payment amount (Minimum UGX 1,000)' });
    }

    const payerPhone = momoNumber || phone || 'Not provided';
    const requestedNetwork = String(network || 'MTN').toUpperCase();
    const bindingColumn = requestedNetwork === 'AIRTEL' ? 'airtel_merchant_id' : 'mtn_merchant_id';
    const assignedBridge = await query(
      `SELECT id FROM bridge_devices
       WHERE status = 'active'
         AND last_heartbeat >= CURRENT_TIMESTAMP - INTERVAL '2 minutes'
         AND NULLIF(${bindingColumn}, '') = $1
       LIMIT 1`,
      [String(merchantCode || '').trim()]
    );
    if (!assignedBridge.rows.length) {
      return res.status(409).json({ success: false, error: 'Merchant is not currently assigned to an active bridge device.' });
    }
    const txRef = reference || await createUniqueReference('VSIM', async candidate => (await query('SELECT id FROM payment_requests WHERE reference = $1', [candidate])).rows.length > 0);
    const mCode = String(merchantCode).trim();

    const existingPayment = await query('SELECT user_id, package_id, target_esim_id, status, created_at FROM payment_requests WHERE reference = $1', [txRef]);
    if (existingPayment.rows.length) {
      const existing = existingPayment.rows[0];
      if (existing.target_esim_id && existing.status === 'completed') {
        const renewed = await query('SELECT id, iccid, title, data_total, data_remaining FROM user_esims WHERE id = $1 AND user_id = $2', [existing.target_esim_id, existing.user_id]);
        return res.json({
          success: true,
          message: 'This renewal payment was already submitted.',
          reference: txRef,
          provisionedEsim: renewed.rows[0] || { id: existing.target_esim_id, title: 'Renewed eSIM' }
        });
      }
      if (existing.target_esim_id && existing.status === 'pending') {
        const current = await query('SELECT id, iccid, title, data_total, data_remaining, status, activated_at FROM user_esims WHERE id = $1 AND user_id = $2', [existing.target_esim_id, existing.user_id]);
        if (current.rows[0] && new Date(current.rows[0].activated_at).getTime() >= new Date(existing.created_at).getTime()) {
          await query('UPDATE payment_requests SET status = $1 WHERE reference = $2', ['completed', txRef]);
          return res.json({
            success: true,
            message: 'This renewal payment was already applied.',
            reference: txRef,
            provisionedEsim: current.rows[0]
          });
        }
      }
      return res.status(409).json({ success: false, error: 'This payment reference has already been submitted.' });
    }

    // Optional user ID if authenticated via token
    let userId = null;
    try {
      const authHeader = req.headers.authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const jwt = (await import('jsonwebtoken')).default;
        const JWT_SECRET = process.env.JWT_SECRET;
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'vsim-api', audience: 'vsim-client' });
        userId = decoded.id;
      }
    } catch (e) {}

    // If not authenticated via token, check if user exists by phone
    if (!userId && (phone || momoNumber)) {
      try {
        const cleanPhone1 = (phone || '').replace(/\s+/g, '');
        const cleanPhone2 = (momoNumber || '').replace(/\s+/g, '');
        const uRes = await query(`SELECT id FROM users WHERE phone = $1 OR phone = $2 LIMIT 1`, [cleanPhone1, cleanPhone2]);
        if (uRes.rows.length > 0) {
          userId = uRes.rows[0].id;
        }
      } catch (err) {}
    }

    if (isRenewal && (!userId || (!targetEsimId && !targetEsimIccid))) {
      return res.status(400).json({ success: false, error: 'Renewal must include the existing eSIM and signed-in user.' });
    }

    let resolvedTargetEsimId = null;
    if (isRenewal) {
      const targetIdentifier = targetEsimIccid || targetEsimId;
      const targetRes = targetEsimIccid
        ? await query('SELECT id, iccid FROM user_esims WHERE iccid = $1 AND user_id = $2', [targetEsimIccid, userId])
        : await query('SELECT id, iccid FROM user_esims WHERE id = $1 AND user_id = $2', [targetIdentifier, userId]);
      if (!targetRes.rows.length) return res.status(404).json({ success: false, error: 'Target eSIM not found' });
      resolvedTargetEsimId = targetRes.rows[0].id;
      if (targetEsimId && String(resolvedTargetEsimId) !== String(targetEsimId)) {
        return res.status(400).json({ success: false, error: 'Target eSIM identifiers do not match' });
      }
    }

    // Reporting a payment only creates a verification request. The bridge and
    // backend verification path are the only code allowed to fulfill it.
    await query(
      `INSERT INTO payment_requests (user_id, phone, amount, merchant, network, reference, package_id, target_esim_id, status, payment_status, order_status, provisioning_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PAYMENT_AWAITING_VERIFICATION', 'PAYMENT_AWAITING_VERIFICATION', $9, $10)`,
      [userId, payerPhone, num, mCode, network || 'MTN', txRef, packageId || null, resolvedTargetEsimId,
        packageId ? 'PENDING_PAYMENT' : 'NOT_APPLICABLE', packageId ? 'NOT_STARTED' : 'NOT_APPLICABLE']
    );

    // Merchant statistics track reported volume only and do not imply payment success.
    if (merchantId) {
      await query(
        `UPDATE merchants 
         SET total_transactions = total_transactions + 1, total_volume = total_volume + $1 
         WHERE id = $2`,
        [num, merchantId]
      );
    }

    // Send real-time notifications to all active admins
    const admins = await query(`SELECT id FROM admin_users WHERE status = 'active'`);
    for (const admin of admins.rows) {
      await query(
        `INSERT INTO notifications (user_id, admin_id, title, message, category)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, admin.id, 'New Mobile Money Payment', `Payment of UGX ${num.toLocaleString()} to ${mCode} reported by ${payerPhone} (Ref: ${txRef})`, 'wallet']
      );

      await query(
        `INSERT INTO admin_notifications (admin_id, type, title, message, reference, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'payment', 'Merchant Payment Received', `UGX ${num.toLocaleString()} sent to ${mCode} by ${payerPhone}`, txRef, 'pending']
      );
    }

    // If user logged in, notify user too
    if (userId) {
      await query(
        `INSERT INTO notifications (user_id, title, message, category)
         VALUES ($1, $2, $3, $4)`,
        [userId, 'Payment Submitted', `Your Mobile Money payment of UGX ${num.toLocaleString()} (Ref: ${txRef}) has been submitted for activation.`, 'wallet']
      );
    }

    // Log in system_logs
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['merchant_payment_reported', `Merchant payment reported: UGX ${num.toLocaleString()} to ${mCode} from ${payerPhone} (Ref: ${txRef})`, 'info', 'Just now']
    );

    res.json({
      success: true,
      message: 'Payment reported. It is awaiting backend verification; your eSIM will not be released until payment is verified.',
      reference: txRef,
      status: 'PAYMENT_AWAITING_VERIFICATION',
      orderStatus: packageId ? 'PENDING_PAYMENT' : 'NOT_APPLICABLE',
      provisioningStatus: packageId ? 'NOT_STARTED' : 'NOT_APPLICABLE'
    });
  } catch (err) {
    console.error('Confirm deposit error:', err);
    res.status(500).json({ success: false, error: 'Failed to record deposit confirmation' });
  }
});

// 3. Create Pending Payment Request (Legacy / Direct prompt)
router.post('/request', authenticateToken, validateBody(paymentRequestSchema), async (req, res) => {
  try {
    const { amount, phone, network } = req.body;
    const num = parseFloat(amount);

    if (isNaN(num) || num < 1000) {
      return res.status(400).json({ error: 'Minimum payment request is UGX 1,000' });
    }

    const result = await query(
      `INSERT INTO payment_requests (user_id, phone, amount, network, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, phone || req.user.phone, num, network || 'MTN', 'pending']
    );

    res.status(201).json({
      message: 'Payment request initiated. Please approve the USSD prompt on your phone.',
      requestId: result.rows[0].id,
      status: 'pending'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to initiate payment request' });
  }
});

// 4. Mobile Money Bridge Confirm Callback (Webhook for MTN/Airtel SMS bridge)
router.post('/bridge-confirm', async (req, res) => {
  try {
    const { phone, amount, reference } = req.body;
    const num = parseFloat(amount);

    // Find pending request matching phone or amount
    const pendingRes = await query(
      `SELECT * FROM payment_requests WHERE amount = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [num]
    );

    if (pendingRes.rows.length === 0) {
      return res.status(404).json({ error: 'No matching pending payment request found' });
    }

    const paymentReq = pendingRes.rows[0];

    // Mark payment request confirmed
    await query(`UPDATE payment_requests SET status = 'completed' WHERE id = $1`, [paymentReq.id]);

    // Credit user's wallet
    await query(`UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2`, [num, paymentReq.user_id]);

    // Log transaction
    const txRef = reference || await createUniqueReference('SMS-BRIDGE', async candidate => (await query('SELECT id FROM wallet_transactions WHERE reference = $1', [candidate])).rows.length > 0);
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [paymentReq.user_id, 'topup', `Mobile Money Top-up (${paymentReq.network})`, num, txRef, 'completed']
    );

    // Create notification
    await query(
      `INSERT INTO notifications (user_id, title, message, category)
       VALUES ($1, $2, $3, $4)`,
      [paymentReq.user_id, 'Deposit Confirmed', `UGX ${num.toLocaleString()} deposited via ${paymentReq.network} Mobile Money.`, 'system']
    );

    res.json({ success: true, message: 'Payment confirmed & wallet credited' });
  } catch (err) {
    console.error('Bridge confirm error:', err);
    res.status(500).json({ error: 'Bridge confirmation failed' });
  }
});

export default router;

