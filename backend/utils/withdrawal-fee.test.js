import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWithdrawalSettlementDays, selectWithdrawalFeeRule } from './withdrawal-fee.js';

test('applies a configured settlement fee on any configured settlement weekday', () => {
  const rule = selectWithdrawalFeeRule(
    ['monthly_cycle', 'expiry', 'settlement', 'normal'],
    { monthly_cycle: false, expiry: false, settlement: true, normal: true }
  );

  assert.equal(rule, 'settlement');
});

test('uses the first eligible rule in admin priority order', () => {
  const rule = selectWithdrawalFeeRule(
    ['expiry', 'monthly_cycle', 'settlement', 'normal'],
    { monthly_cycle: true, expiry: true, settlement: true, normal: true }
  );

  assert.equal(rule, 'expiry');
});

test('blank settlement-day settings do not accidentally add Sunday', () => {
  assert.deepEqual(normalizeWithdrawalSettlementDays(''), [5]);
  assert.deepEqual(normalizeWithdrawalSettlementDays('1, 3, 5'), [5, 1, 3]);
});