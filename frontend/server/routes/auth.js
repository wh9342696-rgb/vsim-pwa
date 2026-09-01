import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const RP_ID = process.env.WEBAUTHN_RP_ID || 'vsime.uk';
const ORIGIN = process.env.FRONTEND_URL || 'https://vsime.uk';
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function encodeJson(value) {
  return JSON.stringify(value);
}

function challengeExpiry() {
  return new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS).toISOString().replace('T', ' ').replace('Z', '');
}

async function getPasskey(userId) {
  const result = await query('SELECT * FROM passkey_credentials WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function saveChallenge(userId, phone, challenge, purpose) {
  await query('DELETE FROM passkey_challenges WHERE (user_id = $1 OR phone = $2) AND purpose = $3', [userId || null, phone || null, purpose]);
  await query(
    'INSERT INTO passkey_challenges (user_id, phone, challenge, purpose, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [userId || null, phone || null, challenge, purpose, challengeExpiry()]
  );
}

async function consumeChallenge(userId, phone, purpose) {
  const result = await query(
    'SELECT * FROM passkey_challenges WHERE (user_id = $1 OR phone = $2) AND purpose = $3 AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 1',
    [userId || null, phone || null, purpose]
  );
  if (!result.rows[0]) return null;
  await query('DELETE FROM passkey_challenges WHERE id = $1', [result.rows[0].id]);
  return result.rows[0];
}

function credentialFromRow(row) {
  return {
    id: row.credential_id,
    publicKey: Uint8Array.from(Buffer.from(row.public_key, 'base64')),
    counter: Number(row.counter || 0),
    transports: row.transports ? JSON.parse(row.transports) : undefined
  };
}

// Zod Input Validation Schemas
const signupSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const name = value.name ?? value.fullName ?? '';
  const phone = value.phone ?? '';
  return {
    ...value,
    name,
    phone,
    referralCode: value.referralCode ?? value.refCode ?? '',
    profilePhoto: value.profilePhoto ?? value.profile_photo ?? null
  };
}, z.object({
  name: z.string().min(2, 'Name is required'),
  phone: z.string().regex(/^07\d{8}$/, 'Enter a valid 10-digit Uganda phone number starting with 07'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  referralCode: z.string().optional().nullable(),
  profilePhoto: z.string().optional().nullable()
}));

const loginSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const phone = String(value.phone ?? '').trim();
  return {
    ...value,
    phone
  };
}, z.object({
  phone: z.string().min(7, 'Phone is required'),
  password: z.string().min(1, 'Password is required')
}));

// 1. User Signup
router.post(['/signup', '/register'], async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { name, phone, password, referralCode, profilePhoto } = parsed.data;

    // Check if phone is already registered
    const existing = await query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Derive initials & password hash
    const parts = name.trim().split(' ');
    const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
    const hash = await bcrypt.hash(password, 10);
    
    // Generate guaranteed unique referral code
    let userRefCode;
    do {
      const randomSuffix = Math.floor(100000 + Math.random() * 900000);
      userRefCode = `VSIM${randomSuffix}`;
      const codeExists = await query('SELECT 1 FROM users WHERE referral_code = $1', [userRefCode]);
      if (codeExists.rows.length === 0) break;
    } while (true);

    const normalizedReferralCode = referralCode?.trim().toUpperCase() || null;
    let referredBy = null;
    let referrerUser = null;
    if (normalizedReferralCode) {
      const referrerRes = await query('SELECT id, name, phone, referral_code FROM users WHERE referral_code = $1', [normalizedReferralCode]);
      if (referrerRes.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid referral code' });
      }
      if (referrerRes.rows[0].phone === phone) {
        return res.status(400).json({ error: 'You cannot use your own referral link' });
      }
      referrerUser = referrerRes.rows[0];
      referredBy = referrerUser.referral_code;
    }
    const initialBalance = 5000.0;

    const result = await query(
      `INSERT INTO users (phone, name, password_hash, initials, wallet_balance, kyc_tier, referral_code, referred_by, profile_photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [phone, name, hash, initials, initialBalance, 'Tier 0 Unverified', userRefCode, referredBy, profilePhoto || null]
    );

    const userRes = await query('SELECT id, phone, name, email, initials, wallet_balance, kyc_tier, referral_code, referred_by, profile_photo FROM users WHERE phone = $1', [phone]);
    const user = userRes.rows[0];

    // 1. Log welcome bonus transaction for the new user
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, 'welcome_bonus', 'Welcome Bonus', initialBalance, `WELCOME-${user.id}`, 'completed']
    );

    // 2. Add Welcome notification for the new user
    await query(
      `INSERT INTO notifications (user_id, title, message, category)
       VALUES ($1, $2, $3, $4)`,
      [user.id, 'Welcome to VSIM!', 'A welcome bonus of UGX 5,000 has been credited to your wallet balance.', 'wallet']
    );

    const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    await query('UPDATE users SET current_session_token = $1 WHERE id = $2', [sessionToken, user.id]);
    const token = jwt.sign(
      { id: user.id, phone: user.phone, name: user.name, sessionToken },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Record system log for Admin Panel
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['user_registered', `New user registered: ${phone} (${name})`, 'primary', 'Just now']
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// 2. User Login
router.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { phone, password } = parsed.data;

    const userRes = await query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }

    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }

    const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    await query('UPDATE users SET current_session_token = $1 WHERE id = $2', [sessionToken, user.id]);
    const token = jwt.sign(
      { id: user.id, phone: user.phone, name: user.name, sessionToken },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password_hash, ...safeUser } = user;

    res.json({
      message: 'Logged in successfully',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/passkey/register/options', authenticateToken, async (req, res) => {
  try {
    const user = (await query('SELECT id, phone, name FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const existing = await getPasskey(user.id);
    const options = await generateRegistrationOptions({
      rpName: 'VSIM Global eSIM',
      rpID: RP_ID,
      userID: String(user.id),
      userName: user.phone,
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: existing ? [{ id: existing.credential_id, transports: existing.transports ? JSON.parse(existing.transports) : undefined }] : [],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
    });
    await saveChallenge(user.id, null, options.challenge, 'register');
    res.json(options);
  } catch (err) {
    console.error('Passkey registration options error:', err);
    res.status(500).json({ error: 'Could not start passkey setup' });
  }
});

router.post('/passkey/register/verify', authenticateToken, async (req, res) => {
  try {
    const user = (await query('SELECT id FROM users WHERE id = $1', [req.user.id])).rows[0];
    const challenge = await consumeChallenge(user?.id, null, 'register');
    if (!user || !challenge) return res.status(400).json({ error: 'Passkey setup expired. Try again.' });
    const verification = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'Passkey could not be verified' });
    const { credential } = verification.registrationInfo;
    await query(
      `INSERT INTO passkey_credentials (user_id, credential_id, public_key, counter, transports)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET credential_id = EXCLUDED.credential_id, public_key = EXCLUDED.public_key, counter = EXCLUDED.counter, transports = EXCLUDED.transports`,
      [user.id, credential.id, Buffer.from(credential.publicKey).toString('base64'), credential.counter, encodeJson(credential.transports || [])]
    );
    res.json({ message: 'Passkey added successfully' });
  } catch (err) {
    console.error('Passkey registration verification error:', err);
    res.status(400).json({ error: 'Passkey could not be verified' });
  }
});

router.post('/passkey/reset/options', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').replace(/\s+/g, '').trim();
    if (!/^07\d{8}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid Uganda phone number' });
    const user = (await query('SELECT id FROM users WHERE phone = $1', [phone])).rows[0];
    const passkey = user ? await getPasskey(user.id) : null;
    if (!user || !passkey) return res.status(400).json({ error: 'No passkey is registered for this phone number' });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'required',
      allowCredentials: [{ id: passkey.credential_id, transports: passkey.transports ? JSON.parse(passkey.transports) : undefined }]
    });
    await saveChallenge(user.id, phone, options.challenge, 'reset');
    res.json({ ...options, phone });
  } catch (err) {
    console.error('Passkey reset options error:', err);
    res.status(500).json({ error: 'Could not start passkey reset' });
  }
});

router.post('/passkey/reset/verify', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').replace(/\s+/g, '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!/^07\d{8}$/.test(phone) || newPassword.length < 6) return res.status(400).json({ error: 'Enter a valid phone number and password of at least 6 characters' });
    const user = (await query('SELECT id FROM users WHERE phone = $1', [phone])).rows[0];
    const passkey = user ? await getPasskey(user.id) : null;
    const challenge = user ? await consumeChallenge(user.id, phone, 'reset') : null;
    if (!user || !passkey || !challenge) return res.status(400).json({ error: 'Passkey reset expired. Try again.' });
    const verification = await verifyAuthenticationResponse({
      response: req.body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: credentialFromRow(passkey),
      requireUserVerification: true
    });
    if (!verification.verified) return res.status(400).json({ error: 'Passkey could not be verified' });
    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1, current_session_token = NULL WHERE id = $2', [hash, user.id]);
    await query('UPDATE passkey_credentials SET counter = $1 WHERE id = $2', [verification.authenticationInfo.newCounter, passkey.id]);
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Passkey reset verification error:', err);
    res.status(400).json({ error: 'Passkey reset could not be completed' });
  }
});

router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await query('UPDATE users SET current_session_token = NULL WHERE id = $1', [req.user.id]);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log out' });
  }
});

// 3. Get Active User Profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userRes = await query('SELECT id, phone, name, email, initials, wallet_balance, kyc_tier, referral_code, referred_by, profile_photo FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: userRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

function kycLimits(tier) {
  if (tier === 'Tier 2 Verified') return { daily: 10000000, monthly: 50000000 };
  if (tier === 'Tier 1 Basic') return { daily: 1000000, monthly: 5000000 };
  return { daily: 100000, monthly: 500000 };
}

router.get('/kyc', authenticateToken, async (req, res) => {
  try {
    const submissions = await query(
      `SELECT id, tier, nin, status, rejection_reason, reviewed_at, created_at
       FROM kyc_submissions WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    const approved = submissions.rows.filter(row => row.status === 'approved');
    const tier = approved.some(row => row.tier === 2)
      ? 'Tier 2 Verified'
      : approved.some(row => row.tier === 1)
        ? 'Tier 1 Basic'
        : 'Tier 0 Unverified';
    await query('UPDATE users SET kyc_tier = $1 WHERE id = $2', [tier, req.user.id]);
    res.json({ tier, limits: kycLimits(tier), submissions: submissions.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

router.post('/kyc/tier-1', authenticateToken, async (req, res) => {
  try {
    const nin = String(req.body?.nin || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,30}$/.test(nin)) {
      return res.status(400).json({ error: 'Enter a valid NIN' });
    }
    const existing = await query(
      `SELECT id FROM kyc_submissions WHERE user_id = $1 AND tier = 1 AND status = 'pending'`,
      [req.user.id]
    );
    if (existing.rows.length) return res.status(409).json({ error: 'Tier 1 submission is already pending' });
    await query(
      `INSERT INTO kyc_submissions (user_id, tier, nin, status) VALUES ($1, 1, $2, 'pending')`,
      [req.user.id, nin]
    );
    res.status(201).json({ message: 'Tier 1 KYC submitted for review' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit Tier 1 KYC' });
  }
});

router.post('/kyc/tier-2', authenticateToken, async (req, res) => {
  try {
    const documentImage = String(req.body?.documentImage || '');
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(documentImage) || documentImage.length > 7000000) {
      return res.status(400).json({ error: 'Upload a valid ID image up to 5 MB' });
    }
    const existing = await query(
      `SELECT id FROM kyc_submissions WHERE user_id = $1 AND tier = 2 AND status = 'pending'`,
      [req.user.id]
    );
    if (existing.rows.length) return res.status(409).json({ error: 'Tier 2 submission is already pending' });
    await query(
      `INSERT INTO kyc_submissions (user_id, tier, document_image, status) VALUES ($1, 2, $2, 'pending')`,
      [req.user.id, documentImage]
    );
    res.status(201).json({ message: 'Tier 2 KYC submitted for review' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit Tier 2 KYC' });
  }
});

// 4. Update User Profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, email, profilePhoto } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }
    if (profilePhoto && !/^data:image\/(jpeg|png|webp);base64,/.test(profilePhoto)) {
      return res.status(400).json({ error: 'Profile photo must be a JPG, PNG or WebP image' });
    }

    const normalizedName = name.trim();
    const normalizedPhone = phone.trim();
    const parts = normalizedName.split(' ');
    const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : normalizedName.substring(0, 2).toUpperCase();

    await query(
      `UPDATE users SET name = $1, phone = $2, email = $3, initials = $4, profile_photo = $5 WHERE id = $6`,
      [normalizedName, normalizedPhone, email?.trim() || null, initials, profilePhoto || null, req.user.id]
    );

    const updatedRes = await query('SELECT id, phone, name, email, initials, wallet_balance, kyc_tier, referral_code, profile_photo FROM users WHERE id = $1', [req.user.id]);
    res.json({ message: 'Profile updated successfully', user: updatedRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
