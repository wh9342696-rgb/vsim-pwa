import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

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
router.post('/topup', authenticateToken, async (req, res) => {
  try {
    const { amount, phone, network } = req.body;
    const num = parseFloat(amount);
    const userPhone = phone || req.user.phone || '+256 700 000 000';

    if (isNaN(num) || num < 1000) {
      return res.status(400).json({ error: 'Minimum top-up is UGX 1,000' });
    }

    // Credit wallet balance
    await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [num, req.user.id]);

    const ref = `TOPUP-${Date.now().toString().slice(-6)}`;
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
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, phone, network } = req.body;
    const num = parseFloat(amount);
    const userPhone = phone || req.user.phone || '+256 700 000 000';

    if (isNaN(num) || num < 5000) {
      return res.status(400).json({ error: 'Minimum withdrawal is UGX 5,000' });
    }

    const userRes = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    const balance = userRes.rows[0].wallet_balance;

    if (balance < num) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    const fee = 2000.0;
    const netAmount = Math.max(0, num - fee);

    const ref = `WITHDRAW-${Date.now().toString().slice(-6)}`;
    // Record in withdrawals table for Admin Panel payout queue
    await query(
      `INSERT INTO withdrawals (user_id, phone, amount, method, network, status, reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.id, userPhone, netAmount, 'Mobile Money', network || 'MTN', 'pending', ref]
    );

    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'withdrawal', `Withdraw - ${network || 'Mobile Money'}`, num, ref, 'pending']
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
      WHERE user_id = $1 AND type NOT IN ('airtime_buy', 'airtime_sell')
      ORDER BY created_at DESC`, [req.user.id]);
    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction logs' });
  }
});

export default router;
