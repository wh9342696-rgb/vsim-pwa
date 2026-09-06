import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { createUniqueReference } from '../utils/reference.js';

const router = express.Router();

async function getAirtimeRate(key, fallback) {
  const result = await query('SELECT value FROM system_settings WHERE key = $1', [key]);
  const rate = Number(result.rows[0]?.value);
  return Number.isFinite(rate) ? Math.max(0, Math.min(100, rate)) : fallback;
}

// 1. Buy Mobile Airtime
router.post('/buy', authenticateToken, async (req, res) => {
  return res.status(410).json({ error: 'Instant airtime buying is disabled. Submit a manual airtime purchase request.' });
/*
  try {
    const { amount, phone, network } = req.body;
    const num = parseFloat(amount);

    if (isNaN(num) || num < 500) {
      return res.status(400).json({ error: 'Minimum airtime purchase is UGX 500' });
    }

    const userRes = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    const balance = userRes.rows[0].wallet_balance;

    if (balance < num) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // Deduct balance
    await query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [num, req.user.id]);

    const ref = `AIR-BUY-${Date.now()}`;
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'airtime_buy', `Bought Airtime (${network || 'MTN'})`, num, ref, 'completed']
    );

    const updatedUser = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);

    res.json({
      message: `Airtime of UGX ${num.toLocaleString()} purchased for ${phone}!`,
      walletBalance: updatedUser.rows[0].wallet_balance
    });
  } catch (err) {
    res.status(500).json({ error: 'Airtime purchase failed' });
  }
*/
});

// 2. Request airtime purchase for manual Mobile Money payment
router.post('/request-buy', authenticateToken, async (req, res) => {
  try {
    const { amount, phone, network = 'MTN' } = req.body || {};
    const airtimeAmount = parseFloat(amount);
    const recipientPhone = String(phone || '').trim();
    const normalizedNetwork = String(network).trim().toUpperCase();
    if (!Number.isFinite(airtimeAmount) || airtimeAmount < 500 || !recipientPhone) {
      return res.status(400).json({ error: 'Enter a valid phone number and airtime amount of at least UGX 500' });
    }
    if (!['MTN', 'AIRTEL'].includes(normalizedNetwork)) {
      return res.status(400).json({ error: 'Choose MTN or Airtel' });
    }

    const merchantRes = await query(
      `SELECT phone, merchant_code FROM merchants
       WHERE status = 'active' AND (UPPER(network) = $1 OR UPPER(network) = 'ALL')
       ORDER BY priority ASC, total_transactions ASC LIMIT 1`,
      [normalizedNetwork]
    );
    if (!merchantRes.rows.length) return res.status(503).json({ error: `No active ${normalizedNetwork} payment merchant is available` });

    const paymentAmount = Math.round(airtimeAmount);
    const merchantNumber = merchantRes.rows[0].phone || merchantRes.rows[0].merchant_code;
    const reference = await createUniqueReference('AIR-BUY', async candidate => (await query('SELECT id FROM airtime_purchase_requests WHERE reference = $1', [candidate])).rows.length > 0);
    res.json({ airtimeAmount, paymentAmount, merchantNumber, reference, phone: recipientPhone, network: normalizedNetwork });
  } catch (err) {
    res.status(500).json({ error: 'Could not prepare airtime purchase' });
  }
});

router.post('/confirm-buy', authenticateToken, async (req, res) => {
  try {
    const { amount, airtimeAmount: preparedAirtimeAmount, paymentAmount, phone, network, merchantNumber, reference } = req.body || {};
    const airtimeAmount = parseFloat(amount ?? preparedAirtimeAmount);
    const depositAmount = parseFloat(paymentAmount);
    if (!Number.isFinite(airtimeAmount) || !Number.isFinite(depositAmount) || !phone || !merchantNumber || !reference) {
      return res.status(400).json({ error: 'Complete the payment details before submitting' });
    }
    const duplicate = await query('SELECT id FROM airtime_purchase_requests WHERE reference = $1', [reference]);
    if (duplicate.rows.length) return res.status(409).json({ error: 'This payment reference has already been submitted' });
    await query(
      `INSERT INTO airtime_purchase_requests (user_id, phone, network, airtime_amount, payment_amount, merchant_number, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [req.user.id, String(phone).trim(), String(network).toUpperCase(), airtimeAmount, depositAmount, merchantNumber, reference]
    );
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, 'airtime_buy', $2, $3, $4, 'pending')`,
      [req.user.id, `Airtime purchase (${String(network).toUpperCase()})`, depositAmount, reference]
    );
    res.status(201).json({ message: 'Airtime purchase submitted for admin approval', status: 'pending', reference });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit airtime purchase' });
  }
});

router.post('/request-sell', authenticateToken, async (req, res) => {
  try {
    const { amount, payoutPhone, network = 'MTN' } = req.body || {};
    const airtimeAmount = parseFloat(amount);
    const normalizedNetwork = String(network).trim().toUpperCase();
    const recipientPhone = String(payoutPhone || '').trim();
    if (!Number.isFinite(airtimeAmount) || airtimeAmount < 1000 || !recipientPhone) {
      return res.status(400).json({ error: 'Enter a valid payout phone number and airtime amount of at least UGX 1,000' });
    }
    if (!['MTN', 'AIRTEL'].includes(normalizedNetwork)) return res.status(400).json({ error: 'Choose MTN or Airtel' });
    const merchantRes = await query(
      `SELECT phone, merchant_code FROM merchants
       WHERE status = 'active' AND (UPPER(network) = $1 OR UPPER(network) = 'ALL')
       ORDER BY priority ASC, total_transactions ASC LIMIT 1`,
      [normalizedNetwork]
    );
    if (!merchantRes.rows.length) return res.status(503).json({ error: `No active ${normalizedNetwork} airtime receiving number is available` });
    const payoutPercent = await getAirtimeRate('airtime_sell_payout_percent', 90);
    const payoutAmount = Math.round(airtimeAmount * payoutPercent / 100);
    const merchantNumber = merchantRes.rows[0].phone || merchantRes.rows[0].merchant_code;
    const reference = await createUniqueReference('AIR-SELL', async candidate => (await query('SELECT id FROM airtime_sale_requests WHERE reference = $1', [candidate])).rows.length > 0);
    res.json({ airtimeAmount, payoutAmount, merchantNumber, reference, payoutPhone: recipientPhone, network: normalizedNetwork });
  } catch (err) {
    res.status(500).json({ error: 'Could not prepare airtime sale' });
  }
});

router.post('/confirm-sell', authenticateToken, async (req, res) => {
  try {
    const { amount, airtimeAmount: preparedAirtimeAmount, payoutAmount, payoutPhone, network, merchantNumber, reference } = req.body || {};
    const airtimeAmount = parseFloat(amount ?? preparedAirtimeAmount);
    const cashAmount = parseFloat(payoutAmount);
    if (!Number.isFinite(airtimeAmount) || !Number.isFinite(cashAmount) || !payoutPhone || !merchantNumber || !reference) {
      return res.status(400).json({ error: 'Complete the airtime transfer details before submitting' });
    }
    const duplicate = await query('SELECT id FROM airtime_sale_requests WHERE reference = $1', [reference]);
    if (duplicate.rows.length) return res.status(409).json({ error: 'This sale reference has already been submitted' });
    await query(
      `INSERT INTO airtime_sale_requests (user_id, payout_phone, network, airtime_amount, payout_amount, merchant_number, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [req.user.id, String(payoutPhone).trim(), String(network).toUpperCase(), airtimeAmount, cashAmount, merchantNumber, reference]
    );
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, 'airtime_sell', $2, $3, $4, 'pending')`,
      [req.user.id, `Airtime sale payout (${String(network).toUpperCase()})`, cashAmount, reference]
    );
    res.status(201).json({ message: 'Airtime sale submitted for admin review', status: 'pending', reference });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit airtime sale' });
  }
});

// 3. Sell Airtime (Instant 90% Wallet Cash-Out Credit)
router.post('/sell', authenticateToken, async (req, res) => {
  return res.status(410).json({ error: 'Instant airtime selling is disabled. Submit a manual airtime sale request.' });
/*
  try {
    const { amount, phone, network } = req.body;
    const num = parseFloat(amount);

    if (isNaN(num) || num < 1000) {
      return res.status(400).json({ error: 'Minimum airtime sell amount is UGX 1,000' });
    }

    const creditedCash = num * 0.90; // 90% payout conversion rate

    // Credit wallet balance
    await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [creditedCash, req.user.id]);

    const ref = `AIR-SELL-${Date.now()}`;
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'airtime_sell', `Sold Airtime (${network || 'Airtel'})`, creditedCash, ref, 'completed']
    );

    const updatedUser = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);

    res.json({
      message: `Airtime sold! UGX ${creditedCash.toLocaleString()} credited to wallet balance.`,
      creditedCash,
      walletBalance: updatedUser.rows[0].wallet_balance
    });
  } catch (err) {
    res.status(500).json({ error: 'Airtime sale failed' });
  }
*/
});

export default router;
