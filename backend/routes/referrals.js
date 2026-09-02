import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

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
    const configuredUrl = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
    const baseUrl = configuredUrl || `${protocol}://${reqHost}`;
    const affiliateLink = `${baseUrl}/?ref=${encodeURIComponent(code)}`;

    res.json({
      referralCode: code,
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
