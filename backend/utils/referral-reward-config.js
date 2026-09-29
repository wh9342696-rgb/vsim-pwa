export const REFERRAL_SIGNUP_BONUS = 5000;

export function normalizeReferralSignupBonus(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : REFERRAL_SIGNUP_BONUS;
}