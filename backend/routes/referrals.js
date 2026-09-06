import express from 'express';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

async function getOrCreateReferralToken(userId) {
  const existing = await query('SELECT token FROM referral_tokens WHERE user_id = $1', [userId]);
  if (existing.rows[0]?.token) return existing.rows[0].token;

  const token = crypto.randomBytes(24).toString('base64url');
  await query(
    'INSERT INTO referral_tokens (user_id, token) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
    [userId, token]
  );
  const created = await query('SELECT token FROM referral_tokens WHERE user_id = $1', [userId]);
  return created.rows[0]?.token || token;
}

// Get Referral & Affiliate Stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userRes = await query('SELECT referral_code FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const code = userRes.rows[0].referral_code;
    if (!code) {
      return res.status(500).json({ error: 'Referral link is not configured for this account' });
    }

    // Count users referred by this user
    const referees = await query("SELECT id FROM users WHERE referred_by = $1 AND status = 'active'", [code]);
    const totalCount = referees.rows.length;

    // Count active referrals with active eSIMs (or active users)
    let activeCount = totalCount;
    if (totalCount > 0) {
      const activeLines = await query(
        `SELECT COUNT(DISTINCT ue.user_id) AS active_total 
         FROM user_esims ue 
         JOIN users u ON ue.user_id = u.id 
         WHERE u.referred_by = $1 AND u.status = 'active' AND ue.status = 'active'`,
        [code]
      );
      activeCount = Number(activeLines.rows[0]?.active_total || 0);
    }

    const earnings = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM wallet_transactions
       WHERE user_id = $1 AND type = 'referral' AND status = 'completed'`,
      [req.user.id]
    );

    // Build canonical affiliate link based on origin/host or environment
    const reqHost = req.get('host');
    const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const configuredUrl = String(process.env.FRONTEND_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
    const baseUrl = configuredUrl || `${protocol}://${reqHost}`;
    const referralToken = await getOrCreateReferralToken(req.user.id);
    const affiliateLink = `${baseUrl}/?ref=${encodeURIComponent(referralToken)}`;

    res.json({
      referralCode: referralToken,
      affiliateLink,
      totalReferrals: totalCount,
      activeReferrals: activeCount,
      totalEarnings: Number(earnings.rows[0]?.total || 0)
    });
  } catch (err) {
    console.error('Referral stats error:', err);
    res.status(500).json({ error: 'Failed to fetch referral statistics' });
  }
});

export default router;
