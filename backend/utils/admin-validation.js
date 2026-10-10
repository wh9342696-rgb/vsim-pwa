export function sanitizeAdminLoginInput(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const email = String(raw.email ?? '').replace(/[\u0000-\u001F\u007F]+/g, '').trim().toLowerCase();
  const password = String(raw.password ?? '').replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  return { ...raw, email, password };
}
