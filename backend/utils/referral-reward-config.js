export const REFERRAL_SIGNUP_BONUS = 5000;
export const REFERRAL_ESIM_COMMISSION = 2000;

export function normalizeReferralSignupBonus(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : REFERRAL_SIGNUP_BONUS;
}

export function calculateReferralBonusApplication(packagePrice, availableBonus) {
  const totalAmount = Math.max(0, Number(packagePrice) || 0);
  const bonusAvailable = Math.max(0, Number(availableBonus) || 0);
  const bonusAmount = Math.min(bonusAvailable, Math.max(0, totalAmount - 1000));
  return { totalAmount, bonusAmount, amountDue: totalAmount - bonusAmount };
}