import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReferralSignupBonus, REFERRAL_SIGNUP_BONUS } from './referral-reward-config.js';

test('referral bonus defaults to UGX 5,000 and accepts valid admin values', () => {
  assert.equal(REFERRAL_SIGNUP_BONUS, 5000);
  assert.equal(normalizeReferralSignupBonus(undefined), 5000);
  assert.equal(normalizeReferralSignupBonus('7500'), 7500);
  assert.equal(normalizeReferralSignupBonus('-1'), 5000);
  assert.equal(normalizeReferralSignupBonus('invalid'), 5000);
});
