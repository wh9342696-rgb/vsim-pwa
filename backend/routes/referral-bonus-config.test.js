import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('referral bonus uses the database override and defaults to UGX 5,000', async () => {
  const sqlitePath = new URL('../database/test-referral-config.db', import.meta.url);
  await fs.rm(sqlitePath, { force: true });
  const previous = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = fileURLToPath(sqlitePath);
  let closeDatabase;
  try {
    const database = await import('../config/db.js');
    closeDatabase = database.closeDatabase;
    const { awardReferralBonus, getReferralSignupBonus, REFERRAL_SIGNUP_BONUS } = await import('../utils/referral-reward.js');

    assert.equal(REFERRAL_SIGNUP_BONUS, 5000);
    assert.equal(await getReferralSignupBonus(null), 5000);
    await database.query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['referral_bonus_amount', '7500']);
    assert.equal(await getReferralSignupBonus('VSIM123456'), 7500);

    const referrer = await database.query("INSERT INTO users (phone, name, password_hash, referral_code) VALUES ($1, $2, $3, $4) RETURNING id", ['0700000001', 'Referrer', 'hash', 'VSIM000001']);
    const referred = await database.query("INSERT INTO users (phone, name, password_hash, referral_code) VALUES ($1, $2, $3, $4) RETURNING id", ['0700000002', 'Referred', 'hash', 'VSIM000002']);
    const reward = { referredUserId: referred.rows[0].id, referrerUserId: referrer.rows[0].id, amount: 7500, referredUserName: 'Referred' };
    assert.equal(await awardReferralBonus(reward), true);
    assert.equal(await awardReferralBonus(reward), false);

    const balance = await database.query('SELECT wallet_balance FROM users WHERE id = $1', [referrer.rows[0].id]);
    const transactions = await database.query("SELECT amount FROM wallet_transactions WHERE user_id = $1 AND type = 'referral'", [referrer.rows[0].id]);
    assert.equal(Number(balance.rows[0].wallet_balance), 7500);
    assert.equal(transactions.rows.length, 1);
    assert.equal(Number(transactions.rows[0].amount), 7500);
  } finally {
    await closeDatabase?.();
    if (previous === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = previous;
    await fs.rm(sqlitePath, { force: true });
    await fs.rm(`${fileURLToPath(sqlitePath)}-shm`, { force: true });
    await fs.rm(`${fileURLToPath(sqlitePath)}-wal`, { force: true });
  }
});
