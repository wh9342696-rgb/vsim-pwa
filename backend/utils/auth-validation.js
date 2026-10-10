import { z } from 'zod';

function sanitizePhoneInput(value) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('256')) return `0${digits.slice(3)}`;
  if (digits.startsWith('0')) return digits;
  if (digits.length === 12 && digits.startsWith('256')) return `0${digits.slice(3)}`;
  return digits.length === 10 ? digits : digits.slice(-10);
}

export function sanitizeUserLoginInput(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const phone = sanitizePhoneInput(raw.phone);
  const password = String(raw.password ?? '').replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  return { ...raw, phone, password };
}

export const signupSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const name = value.name ?? value.fullName ?? '';
  const phone = String(value.phone ?? '').replace(/\s+/g, '').trim();
  return {
    ...value,
    name,
    phone,
    referralCode: value.referralCode ?? value.refCode ?? '',
    profilePhoto: value.profilePhoto ?? value.profile_photo ?? null
  };
}, z.object({
  name: z.string().min(2, 'Name is required'),
  phone: z.string().regex(/^07\d{8}$/, 'Enter a valid 10-digit phone number starting with 07'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  referralCode: z.string().optional().nullable(),
  profilePhoto: z.string().optional().nullable()
}));
