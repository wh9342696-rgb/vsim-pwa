import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeUserLoginInput, signupSchema } from './auth.js';
import { sanitizeAdminLoginInput } from './admin.js';

test('user login input is normalized before validation', () => {
  const sanitized = sanitizeUserLoginInput({
    phone: '  +256  712345678  ',
    password: '  pass\n\r\tvalue  '
  });

  assert.equal(sanitized.phone, '0712345678');
  assert.equal(sanitized.password, 'passvalue');
});

test('admin login input is normalized and stripped of control characters', () => {
  const sanitized = sanitizeAdminLoginInput({
    email: '  Admin@Example.com\u0000\n\r  ',
    password: '  s3cure\tpass\x00  '
  });

  assert.equal(sanitized.email, 'admin@example.com');
  assert.equal(sanitized.password, 's3curepass');
});

test('signup schema accepts refCode and maps it into referralCode without breaking validation', () => {
  const parsed = signupSchema.safeParse({
    name: 'Jane User',
    phone: '0712345678',
    password: 'secret123',
    refCode: 'VSIM123456'
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.referralCode, 'VSIM123456');
});
