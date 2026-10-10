import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('signup bonus remains separate and commission is paid once after a verified eSIM purchase', async () => {
  const sqlitePath = new URL('../database/test-referral-config.db', import.meta.url);
  await fs.rm(sqlitePath, { force: true });
  const previous = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = fileURLToPath(sqlitePath);
  let closeDatabase;
  try {
    const database = await import('../config/db.js');
    closeDatabase = database.closeDatabase;
    const { awardReferralCommissionForPurchase, getReferralSignupBonus, REFERRAL_SIGNUP_BONUS, REFERRAL_ESIM_COMMISSION } = await import('../utils/referral-reward.js');

    assert.equal(REFERRAL_SIGNUP_BONUS, 5000);
    assert.equal(REFERRAL_ESIM_COMMISSION, 2000);
    assert.equal(await getReferralSignupBonus(null), 5000);
    await database.query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['referral_bonus_amount', '7500']);
    assert.equal(await getReferralSignupBonus('VSIM123456'), 7500);

    const referrer = await database.query("INSERT INTO users (phone, name, password_hash, referral_code) VALUES ($1, $2, $3, $4) RETURNING id", ['0700000001', 'Referrer', 'hash', 'VSIM000001']);
    const referred = await database.query("INSERT INTO users (phone, name, password_hash, referral_code, referred_by) VALUES ($1, $2, $3, $4, $5) RETURNING id", ['0700000002', 'Referred', 'hash', 'VSIM000002', 'VSIM000001']);
    const purchase = await database.query(
      `INSERT INTO payment_requests
       (user_id, phone, amount, merchant, network, reference, package_id, payment_method, status, payment_status, order_status, provisioning_status)
       VALUES ($1, $2, 20000, 'TEST', 'MTN', 'TEST-ESIM-REF', 'TEST-PACKAGE', 'mobile_money', 'ORDER_CREATED', 'ORDER_CREATED', 'PENDING_PAYMENT', 'NOT_STARTED')
       RETURNING id`,
      [referred.rows[0].id, '0700000002']
    );
    const paymentId = purchase.rows[0].id;
    assert.equal(await awardReferralCommissionForPurchase(paymentId), false);

    const esim = await database.query(
      `INSERT INTO user_esims (user_id, package_id, title, country, iccid, status, data_total, data_remaining, daily_income, expires_at)
       VALUES ($1, 'TEST-PACKAGE', 'Test eSIM', 'Uganda', 'TEST-ICCID-1', 'active', '10 GB', '10 GB', 100, '2030-01-01')
       RETURNING id`,
      [referred.rows[0].id]
    );
    await database.query(
      `UPDATE payment_requests
       SET status = 'completed', payment_status = 'PAYMENT_VERIFIED', order_status = 'ESIM_READY',
           provisioning_status = 'COMPLETED', provisioned_esim_id = $1,
           verified_amount = 20000, verified_transaction_reference = 'MOBILE-MONEY-TEST'
       WHERE id = $2`,
      [esim.rows[0].id, paymentId]
    );

    assert.equal(await awardReferralCommissionForPurchase(paymentId), true);
    assert.equal(await awardReferralCommissionForPurchase(paymentId), false);

    const repeatPurchase = await database.query(
      `INSERT INTO payment_requests
       (user_id, phone, amount, merchant, network, reference, package_id, payment_method, status, payment_status, order_status, provisioning_status, provisioned_esim_id, verified_amount, verified_transaction_reference)
       VALUES ($1, $2, 20000, 'TEST', 'MTN', 'TEST-ESIM-REF-2', 'TEST-PACKAGE', 'mobile_money', 'completed', 'PAYMENT_VERIFIED', 'ESIM_READY', 'COMPLETED', $3, 20000, 'MOBILE-MONEY-TEST-2')
       RETURNING id`,
      [referred.rows[0].id, '0700000002', esim.rows[0].id]
    );
    assert.equal(await awardReferralCommissionForPurchase(repeatPurchase.rows[0].id), false);

    const balance = await database.query('SELECT wallet_balance FROM users WHERE id = $1', [referrer.rows[0].id]);
    const transactions = await database.query("SELECT amount FROM wallet_transactions WHERE user_id = $1 AND type = 'referral'", [referrer.rows[0].id]);
    assert.equal(Number(balance.rows[0].wallet_balance), REFERRAL_ESIM_COMMISSION);
    assert.equal(transactions.rows.length, 1);
    assert.equal(Number(transactions.rows[0].amount), REFERRAL_ESIM_COMMISSION);
  } finally {
    await closeDatabase?.();
    if (previous === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = previous;
    await fs.rm(sqlitePath, { force: true });
    await fs.rm(`${fileURLToPath(sqlitePath)}-shm`, { force: true });
    await fs.rm(`${fileURLToPath(sqlitePath)}-wal`, { force: true });
  }
});
