import express from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { createUniqueReference } from '../utils/reference.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = express.Router();

const withdrawalNetworkPrefixes = {
  MTN: ['076', '077', '078'],
  AIRTEL: ['070', '074', '075']
};

function getWithdrawalNetwork(phone) {
  return Object.entries(withdrawalNetworkPrefixes).find(([, prefixes]) => prefixes.some(prefix => phone.startsWith(prefix)))?.[0] || null;
}

export async function getWithdrawalQuote(userId, requestedAmount, { requireBalance = true } = {}) {
  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount < 5000) throw new Error('Minimum withdrawal is UGX 5,000');
  const [settingsRes, userRes, esimRes] = await Promise.all([
    query("SELECT key, value FROM system_settings WHERE key LIKE 'withdrawal_%'"),
    userId ? query('SELECT wallet_balance FROM users WHERE id = $1', [userId]) : Promise.resolve({ rows: [] }),
    userId ? query("SELECT expires_at, activated_at FROM user_esims WHERE user_id = $1 AND status = 'active' ORDER BY expires_at ASC NULLS LAST LIMIT 1", [userId]) : Promise.resolve({ rows: [] })
  ]);
  const settings = Object.fromEntries(settingsRes.rows.map(row => [row.key, row.value]));
  const balance = Number(userRes.rows[0]?.wallet_balance || 0);
  if (requireBalance && amount > balance) throw new Error('Insufficient wallet balance');
  const now = new Date();
  const day = now.getUTCDay();
  const settlementDays = String(settings.withdrawal_settlement_days || '').split(',').map(value => Number(value.trim())).filter(Number.isInteger);
  const esim = esimRes.rows[0];
  const expiry = esim?.expires_at ? new Date(esim.expires_at) : null;
  const expiryDay = expiry && Math.abs(expiry.getTime() - now.getTime()) < 24 * 60 * 60 * 1000;
  const monthlyCycle = esim?.activated_at && now.getTime() - new Date(esim.activated_at).getTime() >= 30 * 24 * 60 * 60 * 1000;
  const conditions = { monthly_cycle: monthlyCycle, expiry: Boolean(expiryDay), settlement: settlementDays.includes(day), normal: true };
  const priority = String(settings.withdrawal_fee_priority || 'monthly_cycle,expiry,settlement,normal').split(',').map(value => value.trim()).filter(Boolean);
  const rule = priority.find(candidate => conditions[candidate]) || 'normal';
  const feeKey = { monthly_cycle: 'withdrawal_monthly_fee', expiry: 'withdrawal_expiry_fee', settlement: 'withdrawal_settlement_fee', normal: 'withdrawal_fee' }[rule];
  const fee = Math.max(0, Number(settings[feeKey]) || 0);
  const netAmount = Math.max(0, amount - fee);
  const messages = { normal: 'A higher withdrawal processing fee applies today.', settlement: 'Your withdrawal qualifies for the configured settlement-day fee.', expiry: 'Your withdrawal is near the active eSIM expiry point.', monthly_cycle: 'Your completed monthly cycle qualifies for the lowest configured fee.' };
  return {
    requestedAmount: amount,
    fee,
    netAmount,
    feeRule: `${rule}_day`,
    selectedRule: rule,
    message: messages[rule],
    canContinue: true,
    balance: userId ? balance : null,
    conditions,
    priority,
    settings: {
      normalFee: Math.max(0, Number(settings.withdrawal_fee) || 0),
      settlementFee: Math.max(0, Number(settings.withdrawal_settlement_fee) || 0),
      expiryFee: Math.max(0, Number(settings.withdrawal_expiry_fee) || 0),
      monthlyFee: Math.max(0, Number(settings.withdrawal_monthly_fee) || 0),
      settlementDays
    }
  };
}

const walletActionSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  phone: z.string().optional(),
  network: z.string().optional()
});

// 1. Get Wallet Balance & Summary Stats
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userRes = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ balance: userRes.rows[0].wallet_balance });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wallet balance' });
  }
});

// 2. Mobile Money Top-Up Deposit
router.post('/topup', authenticateToken, validateBody(walletActionSchema), async (req, res) => {
  try {
    const { amount, phone, network } = req.body;
    const num = parseFloat(amount);
    const userPhone = String(phone || req.user.phone || '').replace(/\s+/g, '');
    const normalizedNetwork = String(network || '').trim().toUpperCase();

    if (isNaN(num) || num < 1000) {
      return res.status(400).json({ error: 'Minimum top-up is UGX 1,000' });
    }

    // Credit wallet balance
    await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [num, req.user.id]);

    const ref = await createUniqueReference('TOPUP', async candidate => (await query('SELECT id FROM payment_requests WHERE reference = $1', [candidate])).rows.length > 0);
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'topup', `Top up - ${network || 'Mobile Money'}`, num, ref, 'completed']
    );

    // Record in payment_requests for Admin Panel automatic deposits log
    await query(
      `INSERT INTO payment_requests (user_id, phone, amount, merchant, network, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.id, userPhone, num, 'VSIM-M001', network || 'MTN', ref, 'completed']
    );

    // Record in system_logs
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['deposit_confirmed', `Deposit confirmed: UGX ${num.toLocaleString()} from ${userPhone}`, 'success', 'Just now']
    );

    const updatedUser = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);

    res.json({
      message: `Successfully credited UGX ${num.toLocaleString()} to wallet!`,
      walletBalance: updatedUser.rows[0].wallet_balance
    });
  } catch (err) {
    console.error('Topup error:', err);
    res.status(500).json({ error: 'Top-up failed' });
  }
});

router.post('/withdrawals/quote', authenticateToken, validateBody(z.object({ amount: z.union([z.number(), z.string()]) })), async (req, res) => {
  try {
    res.json(await getWithdrawalQuote(req.user.id, req.body.amount));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to quote withdrawal' });
  }
});

// 3. Mobile Money Withdrawal Request (balance is deducted after admin approval)
router.post('/withdraw', authenticateToken, validateBody(walletActionSchema), async (req, res) => {
  try {
    const { amount, phone, network } = req.body;
    const num = parseFloat(amount);
    const userPhone = phone || req.user.phone || '+256 700 000 000';
    const normalizedNetwork = String(network || '').trim().toUpperCase();

    if (isNaN(num) || num < 5000) {
      return res.status(400).json({ error: 'Minimum withdrawal is UGX 5,000' });
    }
    const inferredNetwork = /^0\d{9}$/.test(userPhone) ? getWithdrawalNetwork(userPhone) : null;
    if (!inferredNetwork) {
      return res.status(400).json({ error: 'Withdrawal number must be a valid 10-digit MTN or Airtel number beginning with 070, 074-078' });
    }
    if (normalizedNetwork !== inferredNetwork) {
      return res.status(400).json({ error: `This number belongs to ${inferredNetwork}` });
    }

    const quote = await getWithdrawalQuote(req.user.id, num);
    const { fee, netAmount, feeRule } = quote;

    const ref = await createUniqueReference('WITHDRAW', async candidate => (await query('SELECT id FROM withdrawals WHERE reference = $1', [candidate])).rows.length > 0);
    // Record in withdrawals table for Admin Panel payout queue
    const reserved = await query(
      `UPDATE users SET wallet_balance = wallet_balance - $1, wallet_reserved_balance = COALESCE(wallet_reserved_balance, 0) + $1
       WHERE id = $2 AND wallet_balance >= $1 RETURNING wallet_balance`,
      [num, req.user.id]
    );
    if (!reserved.rows.length) return res.status(409).json({ error: 'Wallet balance changed. Please request a new quote.' });

    await query(
      `INSERT INTO withdrawals (user_id, phone, amount, requested_amount, fee_amount, net_amount, fee_rule, fee_snapshot, method, network, status, reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [req.user.id, userPhone, num, num, fee, netAmount, feeRule, JSON.stringify({ fee, feeRule, quotedAt: new Date().toISOString() }), 'Mobile Money', normalizedNetwork, 'pending', ref]
    );

    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'withdrawal', `Withdraw - ${normalizedNetwork}`, num, ref, 'pending']
    );

    const admins = await query(`SELECT id FROM admin_users WHERE status = 'active'`);
    for (const admin of admins.rows) {
      await query(
        `INSERT INTO notifications (user_id, admin_id, title, message, category)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.id, admin.id, 'New withdrawal request', `UGX ${netAmount.toLocaleString()} requested by ${userPhone}`, 'withdrawal']
      );
    }

    // Record in system_logs
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['withdrawal_requested', `Withdrawal requested: UGX ${netAmount.toLocaleString()} by ${userPhone}`, 'warning', 'Just now']
    );

    const updatedUser = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);

    res.json({
      message: `Withdrawal request submitted for approval! Net payout: UGX ${netAmount.toLocaleString()}`,
      walletBalance: updatedUser.rows[0].wallet_balance,
      netAmount,
      fee,
      feeRule
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

// 4. Transaction History Log
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT id, user_id, type, title, amount, reference, status, created_at
      FROM wallet_transactions
      WHERE user_id = $1
      UNION ALL
      SELECT id + 1000000000 AS id, user_id, 'payment' AS type,
             CASE WHEN package_id IS NULL THEN 'Mobile Money payment awaiting verification'
                  WHEN target_esim_id IS NULL THEN 'eSIM purchase awaiting verification'
                  ELSE 'eSIM renewal awaiting verification' END AS title,
             amount, reference, 'pending' AS status, created_at
      FROM payment_requests
      WHERE user_id = $1
        AND LOWER(status) IN ('pending', 'payment_awaiting_verification', 'processing')
      ORDER BY created_at DESC`, [req.user.id]);
    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction logs' });
  }
});

export default router;
