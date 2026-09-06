import crypto from 'crypto';

export async function createUniqueReference(prefix, exists) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    if (!(await exists(reference))) return reference;
  }
  throw new Error('Could not generate a unique reference');
}
