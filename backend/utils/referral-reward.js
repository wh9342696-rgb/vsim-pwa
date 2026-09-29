import { query, withTransaction } from '../config/db.js';
import { normalizeReferralSignupBonus } from './referral-reward-config.js';

export { normalizeReferralSignupBonus, REFERRAL_SIGNUP_BONUS } from './referral-reward-config.js';

export async function getReferralSignupBonus(referredBy) {
  const result = await query("SELECT value FROM system_settings WHERE key = 'referral_bonus_amount'");
  return normalizeReferralSignupBonus(result.rows?.[0]?.value ?? REFERRAL_SIGNUP_BONUS);
}

export async function awardReferralBonus({ referredUserId, referrerUserId, amount, referredUserName }) {
  if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) return false;
  const bonus = Number(amount);
  return withTransaction(async txQuery => {
    const reward = await txQuery(
      `INSERT INTO referral_rewards (referred_user_id, referrer_user_id, amount)
       VALUES ($1, $2, $3) ON CONFLICT (referred_user_id) DO NOTHING RETURNING id`,
      [referredUserId, referrerUserId, bonus]
    );
    if (!reward.rows.length) return false;

    const rewardReference = `REF-${referredUserId}-${referrerUserId}`;
    await txQuery('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [bonus, referrerUserId]);
    await txQuery(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [referrerUserId, 'referral', 'Referral Bonus', bonus, rewardReference, 'completed']
    );
    await txQuery(
      `INSERT INTO notifications (user_id, title, message, category)
       VALUES ($1, $2, $3, $4)`,
      [referrerUserId, 'Referral bonus received', `UGX ${bonus.toLocaleString()} has been added to your wallet for referring ${String(referredUserName || '').trim()}.`, 'wallet']
    );
    return true;
  });
}
