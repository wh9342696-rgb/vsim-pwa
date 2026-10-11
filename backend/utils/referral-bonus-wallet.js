import { query, withTransaction } from '../config/db.js';

export { calculateReferralBonusApplication } from './referral-reward-config.js';

export async function getAvailableReferralBonus(userId, queryFn = query) {
  const [credits, user] = await Promise.all([
    queryFn(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('referral', 'welcome_bonus') AND status = 'completed' THEN amount ELSE 0 END), 0) AS earned,
         COALESCE(SUM(CASE
           WHEN type IN ('esim_bonus_spend', 'purchase', 'bundle_purchase', 'withdrawal')
             AND status IN ('pending', 'completed') THEN amount
           ELSE 0
         END), 0) AS spent
       FROM wallet_transactions WHERE user_id = $1`,
      [userId]
    ),
    queryFn('SELECT wallet_balance FROM users WHERE id = $1', [userId])
  ]);
  const earned = Number(credits.rows[0]?.earned || 0);
  const spent = Number(credits.rows[0]?.spent || 0);
  const walletBalance = Number(user.rows[0]?.wallet_balance || 0);
  return Math.max(0, Math.min(earned - spent, walletBalance));
}

export async function reserveReferralBonusForOrder(userId, paymentId, amount) {
  const bonusAmount = Number(amount) || 0;
  if (bonusAmount <= 0) return true;

  return withTransaction(async txQuery => {
    await txQuery('UPDATE users SET wallet_balance = wallet_balance WHERE id = $1', [userId]);
    const existing = await txQuery(
      `SELECT id, amount, status FROM wallet_transactions
       WHERE reference = $1 AND type = 'esim_bonus_spend'`,
      [`ESIM-BONUS-${paymentId}`]
    );
    if (existing.rows.length) {
      return existing.rows[0].status === 'pending'
        && Math.abs(Number(existing.rows[0].amount) - bonusAmount) <= 0.01;
    }

    const availableBonus = await getAvailableReferralBonus(userId, txQuery);
    if (availableBonus + 0.01 < bonusAmount) return false;

    const debit = await txQuery(
      `UPDATE users SET wallet_balance = wallet_balance - $1
       WHERE id = $2 AND wallet_balance >= $1 RETURNING id`,
      [bonusAmount, userId]
    );
    if (!debit.rows.length) return false;

    await txQuery(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, 'esim_bonus_spend', 'Bonus reserved for eSIM purchase', $2, $3, 'pending')`,
      [userId, bonusAmount, `ESIM-BONUS-${paymentId}`]
    );
    return true;
  });
}

export async function settleReferralBonusForOrder(paymentId, refund = false) {
  return withTransaction(async txQuery => {
    const result = await txQuery(
      `UPDATE wallet_transactions SET status = $1
       WHERE reference = $2 AND type = 'esim_bonus_spend' AND status = 'pending'
       RETURNING user_id, amount`,
      [refund ? 'failed' : 'completed', `ESIM-BONUS-${paymentId}`]
    );
    const reservation = result.rows[0];
    if (!refund || !reservation) return Boolean(reservation);

    await txQuery('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [reservation.amount, reservation.user_id]);
    await txQuery(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, 'esim_bonus_refund', 'eSIM bonus returned', $2, $3, 'completed')`,
      [reservation.user_id, reservation.amount, `ESIM-BONUS-REFUND-${paymentId}`]
    );
    return true;
  });
}