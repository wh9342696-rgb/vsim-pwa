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

    const userRes = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    const balance = userRes.rows[0].wallet_balance;

    if (balance < num) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    const feeResult = await query("SELECT value FROM system_settings WHERE key = 'withdrawal_fee'");
    const fee = Math.max(0, Number(feeResult.rows[0]?.value) || 0);
    const netAmount = Math.max(0, num - fee);

    const ref = await createUniqueReference('WITHDRAW', async candidate => (await query('SELECT id FROM withdrawals WHERE reference = $1', [candidate])).rows.length > 0);
    // Record in withdrawals table for Admin Panel payout queue
    await query(
      `INSERT INTO withdrawals (user_id, phone, amount, method, network, status, reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.id, userPhone, netAmount, 'Mobile Money', normalizedNetwork, 'pending', ref]
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
      netAmount
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

// 4. Transaction History Log
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM wallet_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC`, [req.user.id]);
    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction logs' });
  }
});

export default router;
