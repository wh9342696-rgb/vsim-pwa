import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const merchantCursors = new Map();

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
      ? `Dial *165*3# -> Enter Merchant Code ${assignedMerchant.merchant_code} -> Enter Amount -> Enter Reference ${refCode} -> Confirm PIN`
      : `Dial *185*9# -> Enter Merchant ID ${assignedMerchant.merchant_code} -> Enter Amount -> Enter Reference ${refCode} -> Confirm PIN`;

    res.json({
      success: true,
      merchant: {
        id: assignedMerchant.id,
        name: assignedMerchant.name,
        merchant_code: assignedMerchant.merchant_code,
        network: (assignedMerchant.network || 'MTN').toUpperCase(),
        account_name: assignedMerchant.account_name || assignedMerchant.name,
        phone: assignedMerchant.phone || '+256 700 000 000',
        instructions: assignedMerchant.instructions || defaultInstructions
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
router.post('/confirm-deposit', async (req, res) => {
  try {
    const { amount, phone, momoNumber, merchantId, merchantCode, network, reference, packageId, targetEsimId, targetEsimIccid, renewal = false, type = 'esim_purchase' } = req.body;
    const num = parseFloat(amount);
    const isRenewal = Boolean(renewal || targetEsimId || targetEsimIccid);

    if (isNaN(num) || num < 1000) {
      return res.status(400).json({ success: false, error: 'Invalid payment amount (Minimum UGX 1,000)' });
    }

    const payerPhone = momoNumber || phone || 'Not provided';
    const txRef = reference || `VSIM-${Date.now().toString().slice(-6)}`;
    const mCode = merchantCode || 'VSIM-M001';

    const existingPayment = await query('SELECT user_id, package_id, target_esim_id, status FROM payment_requests WHERE reference = $1', [txRef]);
    if (existingPayment.rows.length) {
      const existing = existingPayment.rows[0];
      if (existing.target_esim_id) {
        return res.json({
          success: true,
          message: 'This renewal payment was already submitted.',
          reference: txRef,
          provisionedEsim: { id: existing.target_esim_id, title: 'Renewed eSIM' }
        });
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

    // 1. Record payment request
    const insertRes = await query(
      `INSERT INTO payment_requests (user_id, phone, amount, merchant, network, reference, package_id, target_esim_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, payerPhone, num, mCode, network || 'MTN', txRef, packageId || null, resolvedTargetEsimId, 'pending']
    );

    // 2. Update merchant statistics
    if (merchantId) {
      await query(
        `UPDATE merchants 
         SET total_transactions = total_transactions + 1, total_volume = total_volume + $1 
         WHERE id = $2`,
        [num, merchantId]
      );
    }

    // 3. Provision eSIM if this is an eSIM package purchase
    let provisionedEsim = null;
    if (packageId && (type === 'esim_purchase' || type === 'purchase')) {
      const pkgRes = await query('SELECT * FROM esim_packages WHERE id = $1', [packageId]);
      if (pkgRes.rows.length > 0) {
        const pkg = pkgRes.rows[0];
        const expiresAt = new Date(Date.now() + getValidityDays(pkg.validity) * 24 * 60 * 60 * 1000).toISOString();

        if (isRenewal) {
          const currentEsim = await query('SELECT data_total, data_remaining FROM user_esims WHERE id = $1 AND user_id = $2', [resolvedTargetEsimId, userId]);
          const currentTotal = parseDataValue(currentEsim.rows[0]?.data_total);
          const currentRemaining = parseDataValue(currentEsim.rows[0]?.data_remaining);
          const bundleData = parseDataValue(pkg.data_quota || '10 GB');
          const dataUnit = currentTotal?.unit || bundleData?.unit || 'GB';
          const renewedTotal = formatDataValue((currentTotal?.amount || 0) + (bundleData?.amount || 0), dataUnit);
          const renewedRemaining = formatDataValue((currentRemaining?.amount || 0) + (bundleData?.amount || 0), dataUnit);
          await query(
            `UPDATE user_esims
             SET package_id = $1, title = $2, status = 'active', data_total = $3,
                 data_remaining = $4, daily_income = $5, progress_percent_per_hour = $6,
                 activated_at = CURRENT_TIMESTAMP, expires_at = $7
             WHERE id = $8 AND user_id = $9`,
            [pkg.id, pkg.title, renewedTotal, renewedRemaining, pkg.income || 1200, Number(pkg.progress_percent_per_hour) || 0.42, expiresAt, resolvedTargetEsimId, userId]
          );
          const renewedEsim = (await query(
            'SELECT * FROM user_esims WHERE id = $1 AND user_id = $2',
            [resolvedTargetEsimId, userId]
          )).rows[0];
          provisionedEsim = {
            id: renewedEsim.id,
            iccid: renewedEsim.iccid,
            title: renewedEsim.title,
            data_total: renewedEsim.data_total,
            data_remaining: renewedEsim.data_remaining
          };
        } else if (userId) {
          let randomIccid = `89256${Date.now().toString().slice(-8)}${Math.floor(100000 + Math.random() * 900000)}`;
          while ((await query('SELECT id FROM user_esims WHERE iccid = $1', [randomIccid])).rows.length) {
            randomIccid = `89256${Date.now().toString().slice(-8)}${Math.floor(100000 + Math.random() * 900000)}`;
          }
          const esimInsert = await query(
            `INSERT INTO user_esims (user_id, package_id, title, country, iccid, status, data_total, data_remaining, daily_income, progress_percent_per_hour, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [userId, pkg.id, pkg.title, pkg.country || 'Global', randomIccid, 'active', pkg.data_quota || '10 GB', pkg.data_quota || '10 GB', pkg.income || 1200, Number(pkg.progress_percent_per_hour) || 0.42, expiresAt]
          );
          provisionedEsim = { id: esimInsert.rows[0]?.id, iccid: randomIccid, title: pkg.title };
        }

        // Update package revenue and sold count
        await query(
          'UPDATE esim_packages SET sold_count = sold_count + 1, revenue = revenue + $1 WHERE id = $2',
          [num, packageId]
        );

        // If user was referred, credit referrer 10% commission
        if (userId) {
          const uRefRes = await query('SELECT referred_by FROM users WHERE id = $1', [userId]);
          const refByCode = uRefRes.rows[0]?.referred_by;
          if (refByCode) {
            const refUserRes = await query('SELECT id, name FROM users WHERE referral_code = $1', [refByCode]);
            if (refUserRes.rows.length > 0) {
              const referrer = refUserRes.rows[0];
              const commission = Math.round(num * 0.10);
              if (commission > 0) {
                const commissionRef = `COMM-ESIM-${userId}-${randomIccid}`;
                const existingCommission = await query('SELECT id FROM wallet_transactions WHERE reference = $1', [commissionRef]);
                if (!existingCommission.rows.length) {
                  await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [commission, referrer.id]);
                  await query(
                    `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [referrer.id, 'referral', `Referral Commission (${pkg.title})`, commission, commissionRef, 'completed']
                  );
                  await query(
                    `INSERT INTO notifications (user_id, title, message, category)
                     VALUES ($1, $2, $3, $4)`,
                    [referrer.id, 'Referral Commission Earned!', `UGX ${commission.toLocaleString()} commission was added to your wallet because an invitee purchased ${pkg.title}.`, 'wallet']
                  );
                }
              }
            }
          }
        }
      }
    }

    // 4. Send real-time notifications to all active admins
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

    // 5. If user logged in, notify user too
    if (userId) {
      await query(
        `INSERT INTO notifications (user_id, title, message, category)
         VALUES ($1, $2, $3, $4)`,
        [userId, 'Payment Submitted', `Your Mobile Money payment of UGX ${num.toLocaleString()} (Ref: ${txRef}) has been submitted for activation.`, 'wallet']
      );
    }

    // 6. Log in system_logs
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['merchant_payment_reported', `Merchant payment reported: UGX ${num.toLocaleString()} to ${mCode} from ${payerPhone} (Ref: ${txRef})`, 'info', 'Just now']
    );

    res.json({
      success: true,
      message: 'Mobile Money payment confirmed! Your eSIM line is activated.',
      reference: txRef,
      provisionedEsim
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

