import fs from 'node:fs';
import { sanitizeUserLoginInput } from './routes/auth.js';
import { sanitizeAdminLoginInput } from './routes/admin.js';

const a = sanitizeUserLoginInput({ phone: '  +256 712345678  ', password: '  pass\n\r\tvalue  ' });
const b = sanitizeAdminLoginInput({ email: '  Admin@Example.com\u0000\n\r  ', password: '  s3cure\tpass\x00  ' });
const result = {
  user: a,
  admin: b,
  ok: a.phone === '0712345678' && a.password === 'passvalue' && b.email === 'admin@example.com' && b.password === 's3curepass'
};

fs.writeFileSync('./sanitize-check-result.json', JSON.stringify(result, null, 2));

if (!result.ok) {
  throw new Error('sanitization mismatch');
}

console.log('sanitization verified');
