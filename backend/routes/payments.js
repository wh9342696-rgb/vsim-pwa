import express from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = express.Router();
const merchantCursors = new Map();

const confirmDepositSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  phone: z.string().optional().nullable(),
  momoNumber: z.string().optional().nullable(),
  merchantId: z.union([z.number(), z.string()]).optional().nullable(),
  merchantCode: z.string().optional().nullable(),
  network: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  customerReference: z.string().trim().min(1, 'Mobile Money transaction ID is required').max(160),
  packageId: z.string().optional().nullable(),
  targetEsimId: z.union([z.number(), z.string()]).optional().nullable(),
  targetEsimIccid: z.string().optional().nullable(),
  orderId: z.union([z.number(), z.string()]).optional().nullable(),
  renewal: z.boolean().optional(),
  type: z.string().optional()
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

    // Fetch active merchants ordered by priority and transaction load.
    let merchantsRes = await query(`SELECT * FROM merchants WHERE status = 'active' ORDER BY priority ASC, total_transactions ASC, total_volume ASC, id ASC`);
    
    if (merchantsRes.rows.length === 0) {
      return res.status(503).json({ 
        success: false,
        error: 'No active mobile money merchant is currently available. Please try another payment method or contact support.' 
      });
    }

    let merchants = merchantsRes.rows;

    // Filter by network preference if specified (MTN / Airtel / Universal)
    if (network && String(network).toLowerCase() !== 'all') {
      const netFilter = merchants.filter(m => 
        String(m.network).toLowerCase() === String(network).toLowerCase() || 
        String(m.network).toLowerCase() === 'all'
      );
      if (netFilter.length > 0) {
        merchants = netFilter;
      } else {
        return res.status(404).json({
          success: false,
          error: `No active mobile money merchant found for ${network}. Please choose another network or payment method.`
        });
      }
    }

    // Recompute after network filtering so newly added eligible merchants participate immediately.
    merchants.sort((left, right) =>
      Number(left.priority || 0) - Number(right.priority || 0) ||
      Number(left.total_transactions || 0) - Number(right.total_transactions || 0) ||
      Number(left.total_volume || 0) - Number(right.total_volume || 0) ||
      Number(left.id || 0) - Number(right.id || 0)
    );
    const bestPriority = Number(merchants[0].priority || 0);
    const bestTransactions = Number(merchants[0].total_transactions || 0);
    const bestVolume = Number(merchants[0].total_volume || 0);
    const leastLoaded = merchants.filter(merchant =>
      Number(merchant.priority || 0) === bestPriority &&
      Number(merchant.total_transactions || 0) === bestTransactions &&
      Number(merchant.total_volume || 0) === bestVolume
    );
    const cursorKey = String(network || 'all').toUpperCase();
    const cursor = merchantCursors.get(cursorKey) || 0;
    const assignedMerchant = leastLoaded[cursor % leastLoaded.length];
    merchantCursors.set(cursorKey, cursor + 1);
    const refCode = `VSIM-${Math.floor(100000 + Math.random() * 900000)}`;

    const isMTN = String(assignedMerchant.network).toUpperCase().includes('MTN');
    const defaultInstructions = isMTN
      ? `Dial *165*3# -> Enter Merchant Code ${assignedMerchant.merchant_code} -> Enter Amount -> Confirm PIN`
      : `Dial *185*9# -> Enter Merchant ID ${assignedMerchant.merchant_code} -> Enter Amount -> Confirm PIN`;
    const baseInstructions = String(assignedMerchant.instructions || defaultInstructions)
      .replace(/\s*->\s*Enter Reference\s+VSIM-[A-Z0-9-]+/gi, '')
      .trim();
    const instructions = /SMS transaction ID/i.test(baseInstructions)
      ? baseInstructions
      : `${baseInstructions} -> After payment, enter the SMS transaction ID in the app field below.`;

    res.json({
      success: true,
      merchant: {
        id: assignedMerchant.id,
        name: assignedMerchant.name,
        merchant_code: assignedMerchant.merchant_code,
        network: (assignedMerchant.network || 'MTN').toUpperCase(),
        account_name: assignedMerchant.account_name || assignedMerchant.name,
        phone: assignedMerchant.phone || '+256 700 000 000',
        instructions
      },
      reference: refCode,
      amount: parseFloat(amount) || 0
    });
  } catch (err) {
    console.error('Assigned merchant error:', err);
    res.status(500).json({ success: false, error: 'Failed to assign real-time merchant' });
  }
});

router.post('/orders', authenticateToken, async (req, res) => {
  try {
    const { packageId, targetEsimId, targetEsimIccid, reference, merchantId, merchantCode, network } = req.body || {};
    if (!packageId || !reference) return res.status(400).json({ error: 'Package and payment reference are required' });

    const packageResult = await query('SELECT * FROM esim_packages WHERE id = $1', [packageId]);
    if (!packageResult.rows.length) return res.status(404).json({ error: 'Package not found' });
    const pkg = packageResult.rows[0];
    const targetResult = targetEsimIccid
      ? await query('SELECT id, renewal_count FROM user_esims WHERE iccid = $1 AND user_id = $2 AND status <> \'revoked\'', [targetEsimIccid, req.user.id])
      : targetEsimId
        ? await query('SELECT id, renewal_count FROM user_esims WHERE id = $1 AND user_id = $2 AND status <> \'revoked\'', [targetEsimId, req.user.id])
        : { rows: [] };
    if (targetEsimId || targetEsimIccid) {
      if (!targetResult.rows.length) return res.status(404).json({ error: 'Target eSIM not found' });
    }

    const resolvedTargetEsimId = targetResult.rows[0]?.id || null;
    const renewalCount = Number(targetResult.rows[0]?.renewal_count) || 0;
    let schedule = [];
    try { schedule = Array.isArray(pkg.renewal_schedule) ? pkg.renewal_schedule : JSON.parse(pkg.renewal_schedule || '[]'); } catch (error) {}
    const scheduled = schedule[renewalCount];
    const basePrice = Number(pkg.price) || 0;
    const amount = resolvedTargetEsimId && scheduled && Number(scheduled.price) > basePrice
      ? Number(scheduled.price)
      : basePrice * (resolvedTargetEsimId && renewalCount > 0 ? 1.1 : 1);
    const normalizedReference = String(reference).trim();
    const existing = await query('SELECT * FROM payment_requests WHERE reference = $1 AND user_id = $2', [normalizedReference, req.user.id]);
    if (existing.rows.length) return res.json({ success: true, order: existing.rows[0] });

    const inserted = await query(
      `INSERT INTO payment_requests
       (user_id, phone, amount, merchant, assigned_merchant_id, network, reference, package_id, target_esim_id, status, payment_status, order_status, provisioning_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ORDER_CREATED', 'ORDER_CREATED', $10, 'NOT_STARTED')`,
      [req.user.id, req.user.phone, amount, merchantCode || 'VSIM-M001', merchantId || null, String(network || 'MTN').toUpperCase(), normalizedReference, pkg.id, resolvedTargetEsimId, resolvedTargetEsimId ? 'RENEWAL_PENDING_PAYMENT' : 'PENDING_PAYMENT']
    );
    res.status(201).json({ success: true, order: inserted.rows[0] });
  } catch (err) {
    console.error('Create payment order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// 2. User Submits Deposit / Purchase Confirmation to Merchant
router.post('/confirm-deposit', validateBody(confirmDepositSchema), async (req, res) => {
  try {
    const { amount, phone, momoNumber, merchantId, merchantCode, network, reference, customerReference, orderId, packageId, targetEsimId, targetEsimIccid, renewal = false, type = 'esim_purchase' } = req.body;
    const num = parseFloat(amount);
    const savedTargetEsimId = targetEsimId || null;
    const isRenewal = Boolean(renewal || savedTargetEsimId || targetEsimIccid);

    if (isNaN(num) || num < 1000) {
      return res.status(400).json({ success: false, error: 'Invalid payment amount (Minimum UGX 1,000)' });
    }

    const payerPhone = momoNumber || phone || 'Not provided';
    const txRef = reference || `VSIM-${Date.now().toString().slice(-6)}`;
    const mCode = merchantCode || 'VSIM-M001';

    const existingPayment = orderId
      ? await query('SELECT id, user_id, package_id, target_esim_id, amount, status, created_at, customer_reference FROM payment_requests WHERE id = $1', [orderId])
      : await query('SELECT id, user_id, package_id, target_esim_id, amount, status, created_at, customer_reference FROM payment_requests WHERE reference = $1', [txRef]);
    let existingOrder = null;
    if (existingPayment.rows.length) {
      const existing = existingPayment.rows[0];
      if (!existing.customer_reference && orderId) existingOrder = existing;
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
      if (!existingOrder) return res.status(409).json({ success: false, error: 'This payment reference has already been submitted.' });
    }

    // Optional user ID if authenticated via token
    let userId = null;
    try {
      const authHeader = req.headers.authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const jwt = (await import('jsonwebtoken')).default;
        const JWT_SECRET = process.env.JWT_SECRET;
        const decoded = jwt.verify(token, JWT_SECRET);
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

    if (existingOrder) userId = existingOrder.user_id;
    const orderTargetEsimId = existingOrder?.target_esim_id || savedTargetEsimId;
    if (isRenewal && (!userId || (!orderTargetEsimId && !targetEsimIccid))) {
      return res.status(400).json({ success: false, error: 'Renewal must include the existing eSIM and signed-in user.' });
    }

    let resolvedTargetEsimId = null;
    if (isRenewal) {
      const targetIdentifier = targetEsimIccid || orderTargetEsimId;
      const targetRes = targetEsimIccid
        ? await query('SELECT id, iccid FROM user_esims WHERE iccid = $1 AND user_id = $2', [targetEsimIccid, userId])
        : await query('SELECT id, iccid FROM user_esims WHERE id = $1 AND user_id = $2', [targetIdentifier, userId]);
      if (!targetRes.rows.length) return res.status(404).json({ success: false, error: 'Target eSIM not found' });
      resolvedTargetEsimId = targetRes.rows[0].id;
      if (orderTargetEsimId && String(resolvedTargetEsimId) !== String(orderTargetEsimId)) {
        return res.status(400).json({ success: false, error: 'Target eSIM identifiers do not match' });
      }
    }

    // Reporting a payment only creates a verification request. The bridge and
    // backend verification path are the only code allowed to fulfill it.
    if (existingOrder) {
      if (Math.abs(Number(existingOrder.amount) - num) > 0.01) return res.status(409).json({ success: false, error: 'Payment amount does not match the saved order' });
      const duplicateTransaction = await query(
        `SELECT id, reference, status FROM payment_requests
         WHERE LOWER(customer_reference) = LOWER($1) AND id <> $2
         LIMIT 1`,
        [customerReference, existingOrder.id]
      );
      if (duplicateTransaction.rows.length) {
        return res.status(409).json({
          success: false,
          error: 'This Mobile Money transaction ID has already been submitted for another order.'
        });
      }
      await query(
        `UPDATE payment_requests
         SET phone = $1, customer_reference = $2, status = 'PAYMENT_AWAITING_VERIFICATION', payment_status = 'PAYMENT_AWAITING_VERIFICATION', order_status = $3, provisioning_status = 'NOT_STARTED'
         WHERE id = $4`,
        [payerPhone, customerReference, packageId ? 'PENDING_PAYMENT' : 'NOT_APPLICABLE', existingOrder.id]
      );
    } else {
      await query(
        `INSERT INTO payment_requests (user_id, phone, amount, merchant, assigned_merchant_id, network, reference, customer_reference, package_id, target_esim_id, status, payment_status, order_status, provisioning_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PAYMENT_AWAITING_VERIFICATION', 'PAYMENT_AWAITING_VERIFICATION', $11, $12)`,
        [userId, payerPhone, num, mCode, merchantId || null, network || 'MTN', txRef, customerReference || null, packageId || null,
          resolvedTargetEsimId, packageId ? 'PENDING_PAYMENT' : 'NOT_APPLICABLE', packageId ? 'NOT_STARTED' : 'NOT_APPLICABLE']
      );
    }

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
router.post('/request', authenticateToken, async (req, res) => {
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
    const txRef = reference || `SMS-BRIDGE-${Date.now()}`;
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

