import assert from 'node:assert/strict';
import test from 'node:test';

const bridgeEventFields = {
  provider: 'MTN',
  merchantId: 'merchant-1',
  transactionReference: 'provider-ref-1',
  transactionType: 'deposit',
  amount: 5000,
  currency: 'UGX'
};

test('bridge event contract contains no wallet recipient field', () => {
  assert.equal(Object.hasOwn(bridgeEventFields, 'userId'), false);
  assert.equal(Object.hasOwn(bridgeEventFields, 'walletId'), false);
});

test('bridge event identity is stable for idempotency', () => {
  const identity = [bridgeEventFields.provider, bridgeEventFields.merchantId, bridgeEventFields.transactionReference].join(':');
  assert.equal(identity, 'MTN:merchant-1:provider-ref-1');
});

test('bridge event amount and currency are explicit', () => {
  assert.equal(Number.isFinite(bridgeEventFields.amount), true);
  assert.equal(bridgeEventFields.currency.length, 3);
});
