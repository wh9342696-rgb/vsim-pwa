import { query, withTransaction } from '../config/db.js';
import { normalizeReferralSignupBonus, REFERRAL_ESIM_COMMISSION } from './referral-reward-config.js';

export { normalizeReferralSignupBonus, REFERRAL_SIGNUP_BONUS, REFERRAL_ESIM_COMMISSION } from './referral-reward-config.js';

export async function getReferralSignupBonus(referredBy) {
  const result = await query("SELECT value FROM system_settings WHERE key = 'referral_bonus_amount'");
  return normalizeReferralSignupBonus(result.rows?.[0]?.value ?? REFERRAL_SIGNUP_BONUS);
}

export async function awardReferralCommissionForPurchase(paymentRequestId) {
  const purchaseId = Number(paymentRequestId);
  if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) return false;

  return withTransaction(async txQuery => {
    const purchaseResult = await txQuery(
      `SELECT pr.id, pr.user_id, ue.title AS esim_title
       FROM payment_requests pr
       JOIN user_esims ue ON ue.id = pr.provisioned_esim_id AND ue.user_id = pr.user_id
       WHERE pr.id = $1
         AND pr.status = 'completed'
         AND pr.payment_status = 'PAYMENT_VERIFIED'
         AND COALESCE(pr.payment_method, 'mobile_money') <> 'wallet'
         AND pr.package_id IS NOT NULL
         AND pr.target_esim_id IS NULL
         AND pr.order_status = 'ESIM_READY'
         AND pr.provisioning_status = 'COMPLETED'
         AND pr.verified_amount IS NOT NULL
         AND ABS(pr.verified_amount - pr.amount) <= 0.01
         AND COALESCE(pr.verified_transaction_reference, '') <> ''`,
      [purchaseId]
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) return false;

    const referredUserResult = await txQuery(
      "SELECT referred_by FROM users WHERE id = $1 AND status = 'active'",
      [purchase.user_id]
    );
    const referredBy = referredUserResult.rows[0]?.referred_by;
    if (!referredBy) return false;

    const referrerResult = await txQuery(
      "SELECT id FROM users WHERE referral_code = $1 AND status = 'active'",
      [referredBy]
    );
    const referrerId = referrerResult.rows[0]?.id;
    if (!referrerId) return false;

    const rewardReference = `ESIM-REFERRAL-USER-${purchase.user_id}`;
    const existingReward = await txQuery(
      "SELECT id FROM wallet_transactions WHERE user_id = $1 AND type = 'referral' AND reference = $2",
      [referrerId, rewardReference]
    );
    if (existingReward.rows.length) return false;

    await txQuery('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [REFERRAL_ESIM_COMMISSION, referrerId]);
    await txQuery(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [referrerId, 'referral', `Referral Commission - ${purchase.esim_title}`, REFERRAL_ESIM_COMMISSION, rewardReference, 'completed']
    );
    await txQuery(
      `INSERT INTO notifications (user_id, title, message, category)
       VALUES ($1, $2, $3, $4)`,
      [referrerId, 'Referral commission received', `UGX ${REFERRAL_ESIM_COMMISSION.toLocaleString()} has been added to your wallet after your referral purchased and activated an eSIM.`, 'wallet']
    );
    return true;
  });
}
