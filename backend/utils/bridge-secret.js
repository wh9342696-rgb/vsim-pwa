import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const encryptionKey = crypto.createHash('sha256').update(String(process.env.DEVICE_SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || '')).digest();

export function encryptBridgeSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptBridgeSecret(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return String(value || '');
  const decipher = crypto.createDecipheriv(algorithm, encryptionKey, Buffer.from(parts[1], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8');
}

export function isEncryptedBridgeSecret(value) {
  return String(value || '').startsWith('v1:');
}

export function hashBridgeSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}
