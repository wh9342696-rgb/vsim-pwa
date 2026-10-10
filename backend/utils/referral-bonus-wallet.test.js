import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateReferralBonusApplication } from './referral-reward-config.js';

test('applies referral bonus to the eSIM price before Mobile Money payment', () => {
  assert.deepEqual(calculateReferralBonusApplication(20000, 5000), {
    totalAmount: 20000,
    bonusAmount: 5000,
    amountDue: 15000
  });
});

test('keeps at least UGX 1,000 due for Mobile Money verification', () => {
  assert.deepEqual(calculateReferralBonusApplication(20000, 25000), {
    totalAmount: 20000,
    bonusAmount: 19000,
    amountDue: 1000
  });
});

test('charges the full price when no referral bonus is available', () => {
  assert.deepEqual(calculateReferralBonusApplication(20000, 0), {
    totalAmount: 20000,
    bonusAmount: 0,
    amountDue: 20000
  });
});