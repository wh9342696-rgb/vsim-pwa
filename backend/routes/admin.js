import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { encryptBridgeSecret, decryptBridgeSecret, hashBridgeSecret } from '../utils/bridge-secret.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

function normalizeRenewalSchedule(value, basePrice) {
  if (!Array.isArray(value)) return [];
  const base = Number(basePrice) || 0;
  let previousDate = '';
  let previousPrice = base;
  return value.map(item => ({
    date: String(item?.date || '').trim(),
    price: Number(item?.price)
  })).filter(item => {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(item.date) && (!previousDate || item.date > previousDate);
    const validPrice = Number.isFinite(item.price) && item.price > previousPrice;
    if (validDate && validPrice) {
      previousDate = item.date;
      previousPrice = item.price;
      return true;
    }
    return false;
  });
}

const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const adminRes = await query('SELECT id, email, name, role, status, profit_total, joined_users_count, profile_photo, current_session_token FROM admin_users WHERE id = $1', [decoded.id]);
    if (adminRes.rows.length === 0 || adminRes.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'Unauthorized admin account' });
    }

    const expectedSessionToken = adminRes.rows[0].current_session_token || null;
    if (!expectedSessionToken || decoded.sessionToken !== expectedSessionToken) {
      return res.status(401).json({ error: 'Session invalid. Please log in again.' });
    }

    req.admin = adminRes.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
};

const ensureSuperAdmin = (req, res, next) => {
  if (!req.admin || req.admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only the main admin can manage sub-admins' });
  }
  next();
};

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const adminRes = await query('SELECT * FROM admin_users WHERE email = $1', [email.trim().toLowerCase()]);
    if (adminRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const admin = adminRes.rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const sessionToken = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    await query('UPDATE admin_users SET current_session_token = $1 WHERE id = $2', [sessionToken, admin.id]);
    const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role, sessionToken }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...safeAdmin } = admin;

    res.json({
      message: 'Admin login successful',
      token,
      admin: safeAdmin
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Admin login failed' });
  }
});

router.post('/logout', adminAuth, async (req, res) => {
  try {
    await query('UPDATE admin_users SET current_session_token = NULL WHERE id = $1', [req.admin.id]);
    res.json({ message: 'Admin logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log out admin' });
  }
});

router.get('/me', adminAuth, async (req, res) => {
  const result = await query(
    `SELECT id, email, name, role, status, created_at, profit_total, joined_users_count, profile_photo
     FROM admin_users WHERE id = $1`,
    [req.admin.id]
  );
  res.json({ admin: result.rows[0] || req.admin });
});

router.put('/me', adminAuth, async (req, res) => {
  try {
    const { name, profile_photo } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (profile_photo !== null && profile_photo !== undefined &&
        (!/^data:image\/(jpeg|png|webp);base64,/.test(String(profile_photo)) || String(profile_photo).length > 1000000)) {
      return res.status(400).json({ error: 'Upload a valid profile image up to 750 KB' });
    }
    const result = await query(
      `UPDATE admin_users SET name = $1, profile_photo = $2
       WHERE id = $3
       RETURNING id, email, name, role, status, created_at, profit_total, joined_users_count, profile_photo`,
      [String(name).trim(), profile_photo ? String(profile_photo).trim() : null, req.admin.id]
    );
    res.json({ message: 'Profile updated successfully', admin: result.rows[0] });
  } catch (err) {
    console.error('Admin profile update error:', err);
    res.status(500).json({ error: 'Failed to update admin profile' });
  }
});

router.get('/notifications', adminAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, title, message, category, is_read, created_at
      FROM notifications WHERE admin_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [req.admin.id]
    );
    const unread = result.rows.filter(notification => !notification.is_read).length;
    res.json({ notifications: result.rows, unread });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin notifications' });
  }
});

router.post('/notifications/:id/read', adminAuth, async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE id = $1 AND admin_id = $2', [req.params.id, req.admin.id]);
  res.json({ message: 'Notification marked as read' });
});

router.post('/notifications/read-all', adminAuth, async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE admin_id = $1', [req.admin.id]);
  res.json({ message: 'Admin notifications marked as read' });
});

router.get('/merchants', adminAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM merchants ORDER BY priority ASC, id DESC');
    res.json({ merchants: result.rows });
  } catch (err) {
    console.error('Fetch merchants error:', err);
    res.status(500).json({ error: 'Failed to fetch merchants' });
  }
});

router.post('/merchants', adminAuth, async (req, res) => {
  try {
    const { name, merchant_code, network = 'MTN', account_name, phone, instructions, priority = 10, status = 'active' } = req.body || {};
    if (!name || !merchant_code) {
      return res.status(400).json({ error: 'Merchant name and merchant code are required' });
    }
    
    const insertRes = await query(
      `INSERT INTO merchants (name, merchant_code, network, account_name, phone, instructions, priority, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        String(name).trim(),
        String(merchant_code).trim(),
        String(network).trim().toUpperCase(),
        account_name ? String(account_name).trim() : null,
        phone ? String(phone).trim() : null,
        instructions ? String(instructions).trim() : null,
        Number(priority) || 10,
        status === 'active' ? 'active' : 'inactive'
      ]
    );

    const newId = insertRes.rows[0]?.id;
    const fetchRes = newId ? await query('SELECT * FROM merchants WHERE id = $1', [newId]) : null;
    const merchant = fetchRes?.rows[0] || { id: newId, name, merchant_code, network, status };

    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['merchant_created', `Admin created merchant: ${name} (${merchant_code} - ${network})`, 'success', 'Just now']
    );

    res.status(201).json({ message: 'Merchant created successfully', merchant });
  } catch (err) {
    console.error('Create merchant error:', err);
    res.status(500).json({ error: 'Failed to create merchant' });
  }
});

router.put('/merchants/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, merchant_code, network, account_name, phone, instructions, priority, status } = req.body || {};
    
    const existing = await query('SELECT * FROM merchants WHERE id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    const current = existing.rows[0];
    await query(
      `UPDATE merchants 
       SET name = $1, merchant_code = $2, network = $3, account_name = $4, phone = $5, instructions = $6, priority = $7, status = $8
       WHERE id = $9`,
      [
        name !== undefined ? String(name).trim() : current.name,
        merchant_code !== undefined ? String(merchant_code).trim() : current.merchant_code,
        network !== undefined ? String(network).trim().toUpperCase() : current.network,
        account_name !== undefined ? (account_name ? String(account_name).trim() : null) : current.account_name,
        phone !== undefined ? (phone ? String(phone).trim() : null) : current.phone,
        instructions !== undefined ? (instructions ? String(instructions).trim() : null) : current.instructions,
        priority !== undefined ? (Number(priority) || 10) : current.priority,
        status !== undefined ? (status === 'active' ? 'active' : 'inactive') : current.status,
        id
      ]
    );

    const updated = await query('SELECT * FROM merchants WHERE id = $1', [id]);

    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['merchant_updated', `Admin updated merchant #${id}: ${updated.rows[0]?.name}`, 'info', 'Just now']
    );

    res.json({ message: 'Merchant updated successfully', merchant: updated.rows[0] });
  } catch (err) {
    console.error('Update merchant error:', err);
    res.status(500).json({ error: 'Failed to update merchant' });
  }
});

router.patch('/merchants/:id/status', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const nextStatus = status === 'active' ? 'active' : 'inactive';

    await query('UPDATE merchants SET status = $1 WHERE id = $2', [nextStatus, id]);
    const updated = await query('SELECT * FROM merchants WHERE id = $1', [id]);

    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['merchant_status_toggled', `Merchant #${id} status changed to ${nextStatus}`, 'info', 'Just now']
    );

    res.json({ message: `Merchant status changed to ${nextStatus}`, merchant: updated.rows[0] });
  } catch (err) {
    console.error('Toggle merchant status error:', err);
    res.status(500).json({ error: 'Failed to update merchant status' });
  }
});

router.delete('/merchants/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM merchants WHERE id = $1', [id]);

    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['merchant_deleted', `Admin deleted merchant #${id}`, 'warning', 'Just now']
    );

    res.json({ message: 'Merchant deleted successfully' });
  } catch (err) {
    console.error('Delete merchant error:', err);
    res.status(500).json({ error: 'Failed to delete merchant' });
  }
});

router.get('/kyc', adminAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT ks.id, ks.user_id, ks.tier, ks.nin, ks.document_image, ks.status,
              ks.rejection_reason, ks.created_at, u.name, u.phone, u.kyc_tier
       FROM kyc_submissions ks JOIN users u ON u.id = ks.user_id
       ORDER BY CASE WHEN ks.status = 'pending' THEN 0 ELSE 1 END, ks.created_at DESC`
    );
    res.json({ submissions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch KYC submissions' });
  }
});

router.post('/kyc/:id/review', adminAuth, async (req, res) => {
  try {
    const submission = await query('SELECT * FROM kyc_submissions WHERE id = $1', [req.params.id]);
    if (!submission.rows.length) return res.status(404).json({ error: 'KYC submission not found' });
    const action = req.body?.action === 'approve' ? 'approved' : req.body?.action === 'reject' ? 'rejected' : null;
    if (!action) return res.status(400).json({ error: 'Action must be approve or reject' });
    const row = submission.rows[0];
    await query(
      `UPDATE kyc_submissions SET status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [action, action === 'rejected' ? String(req.body?.reason || 'Submission was rejected') : null, req.admin.id, row.id]
    );
    if (action === 'approved') {
      await query('UPDATE users SET kyc_tier = $1 WHERE id = $2', [row.tier === 2 ? 'Tier 2 Verified' : 'Tier 1 Basic', row.user_id]);
    }
    res.json({ message: `KYC submission ${action}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to review KYC submission' });
  }
});

router.get('/admins', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const result = await query('SELECT id, email, name, role, status, created_at FROM admin_users ORDER BY created_at DESC');
    res.json({ admins: result.rows });
  } catch (err) {
    console.error('Admin list error:', err);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

router.post('/admins', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { name, email, password, role = 'sub_admin', status = 'active', profile_photo = null } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRole = String(role) === 'super_admin' ? 'super_admin' : 'sub_admin';

    const existing = await query('SELECT id FROM admin_users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Admin email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO admin_users (email, password_hash, name, role, status, profile_photo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, role, status, created_at, profile_photo`,
      [normalizedEmail, passwordHash, name.trim(), normalizedRole, status === 'inactive' ? 'inactive' : 'active', profile_photo]
    );

    res.status(201).json({ message: 'Sub-admin created successfully', admin: result.rows[0] });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Failed to create sub-admin' });
  }
});

router.put('/admins/:id', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, status, profile_photo } = req.body || {};

    const existing = await query('SELECT * FROM admin_users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const nextRole = role === 'super_admin' ? 'super_admin' : 'sub_admin';
    const nextStatus = status === 'inactive' ? 'inactive' : 'active';

    const result = await query(
        `UPDATE admin_users
         SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           role = COALESCE($3, role),
           status = COALESCE($4, status),
           profile_photo = COALESCE($5, profile_photo)
         WHERE id = $6
         RETURNING id, email, name, role, status, created_at, profile_photo`,
        [name?.trim() || existing.rows[0].name, email?.trim().toLowerCase() || existing.rows[0].email, nextRole, nextStatus, profile_photo !== undefined ? profile_photo : existing.rows[0].profile_photo, id]
    );

    res.json({ message: 'Admin updated successfully', admin: result.rows[0] });
  } catch (err) {
    console.error('Update admin error:', err);
    res.status(500).json({ error: 'Failed to update admin' });
  }
});

router.delete('/admins/:id', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const admin = await query('SELECT * FROM admin_users WHERE id = $1', [id]);

    if (admin.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (String(admin.rows[0].id) === String(req.admin.id)) {
      return res.status(400).json({ error: 'The main admin cannot be deleted' });
    }

    await query('DELETE FROM admin_users WHERE id = $1', [id]);
    res.json({ message: 'Admin deleted successfully' });
  } catch (err) {
    console.error('Delete admin error:', err);
    res.status(500).json({ error: 'Failed to delete admin' });
  }
});

// 1. Full Admin Overview Dashboard Stats & Charts
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const usersCount = await query('SELECT COUNT(*) AS total FROM users');
    const activeUsers = await query(`SELECT COUNT(*) AS total FROM users WHERE status = 'active'`);
    const walletVol = await query('SELECT COALESCE(SUM(wallet_balance), 0) AS total_balance FROM users');
    const depositsTotal = await query(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM payment_requests WHERE status = 'completed'`);
    const pendingPayouts = await query(`SELECT SUM(amount) AS total, COUNT(*) AS count FROM withdrawals WHERE status = 'pending'`);
    const paidPayouts = await query(`SELECT SUM(amount) AS total, COUNT(*) AS count FROM withdrawals WHERE status = 'paid'`);
    const bridgeOnline = await query(`SELECT COUNT(*) AS online FROM bridge_devices WHERE status = 'online'`);
    const packages = await query(`SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(sold_count), 0) AS sold FROM esim_packages`);
    const investmentRows = await query(
      `SELECT ue.status, COALESCE(SUM(COALESCE(ep.price, 0)), 0) AS amount
       FROM user_esims ue LEFT JOIN esim_packages ep ON ep.id = ue.package_id
       GROUP BY ue.status`
    );
    const yieldRows = await query(
      `SELECT created_at::date::text AS day, COALESCE(SUM(amount), 0) AS total
       FROM wallet_transactions WHERE type = 'yield' AND created_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY created_at::date ORDER BY day`
    );
    const investmentTotals = Object.fromEntries(investmentRows.rows.map(row => [row.status, Number(row.amount)]));
    const totalInvestment = Object.values(investmentTotals).reduce((sum, value) => sum + value, 0);
    const chartDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });
    const chartAmounts = chartDays.map(day => Number(yieldRows.rows.find(row => String(row.day).slice(0, 10) === day)?.total || 0));
    const breakdown = (status, color) => {
      const amount = investmentTotals[status] || 0;
      return { amount, percentage: totalInvestment ? Number(((amount / totalInvestment) * 100).toFixed(1)) : 0, color };
    };

    const subAdmin = req.admin.role === 'sub_admin'
      ? {
          profitTotal: Number(req.admin.profit_total || 0),
          joinedUsers: Number(req.admin.joined_users_count || 0)
        }
      : null;

    res.json({
      role: req.admin.role,
      subAdmin,
      metrics: {
        totalUsers: Number(usersCount.rows[0]?.total || 0),
        totalUsersReal: Number(usersCount.rows[0]?.total || 0),
        activeUsers: Number(activeUsers.rows[0]?.total || 0),
        totalInvested: Number(walletVol.rows[0]?.total_balance || 0),
        totalEarningsPaid: Number(packages.rows[0]?.revenue || 0),
        totalWithdrawn: Number(paidPayouts.rows[0]?.total || 0),
        depositsTotal: Number(depositsTotal.rows[0]?.total || 0),
        depositsCount: Number(depositsTotal.rows[0]?.count || 0),
        packagesRevenue: Number(packages.rows[0]?.revenue || 0),
        packagesSold: Number(packages.rows[0]?.sold || 0),
        pendingWithdrawalsTotal: Number(pendingPayouts.rows[0]?.total || 0),
        pendingWithdrawalsCount: Number(pendingPayouts.rows[0]?.count || 0),
        todayPaidWithdrawalsTotal: Number(paidPayouts.rows[0]?.total || 0)
      },
      earningsChart: {
        days: chartDays,
        amounts: chartAmounts,
        today: chartAmounts[6] || 0,
        thisWeek: chartAmounts.reduce((sum, value) => sum + value, 0),
        thisMonth: Number(packages.rows[0]?.revenue || 0)
      },
      investmentsBreakdown: {
        total: totalInvestment,
        active: breakdown('active', '#6366f1'),
        completed: breakdown('completed', '#10b981'),
        cancelled: breakdown('cancelled', '#ef4444'),
        expired: breakdown('expired', '#3b82f6')
      },
      systemStatus: {
        bridgeDevices: `${Number(bridgeOnline.rows[0]?.online || 0)} Online`,
        apiServer: 'Running',
        database: 'Healthy',
        storage: 'Database managed',
        uptime: 'Online'
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

router.get('/analytics', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const [users, active, deposits, completed, failed, balances, tiers, packages, withdrawals, earnings] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM users'),
      query(`SELECT COUNT(*) AS total FROM users WHERE status = 'active'`),
      query('SELECT COALESCE(SUM(amount), 0) AS total FROM payment_requests'),
      query(`SELECT COUNT(*) AS total FROM payment_requests WHERE status = 'completed'`),
      query(`SELECT COUNT(*) AS total FROM payment_requests WHERE status = 'failed'`),
      query('SELECT COALESCE(AVG(wallet_balance), 0) AS average FROM users'),
      query(`SELECT kyc_tier, COUNT(*) AS total FROM users GROUP BY kyc_tier`),
      query('SELECT COALESCE(SUM(sold_count), 0) AS sold, COALESCE(SUM(revenue), 0) AS revenue FROM esim_packages'),
      query('SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals WHERE status = \'paid\''),
      query(`SELECT
        COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'), 0) AS week,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)), 0) AS month
        FROM wallet_transactions WHERE type = 'yield' AND status = 'completed'`)
    ]);
    const tierMap = Object.fromEntries(tiers.rows.map(row => [String(row.kyc_tier || '').toLowerCase(), Number(row.total)]));
    res.json({ analytics: {
      total_users: Number(users.rows[0].total),
      active_users: Number(active.rows[0].total),
      inactive_users: Number(users.rows[0].total) - Number(active.rows[0].total),
      total_deposits: Number(deposits.rows[0].total),
      completed_deposits: Number(completed.rows[0].total),
      failed_deposits: Number(failed.rows[0].total),
      total_withdrawn: Number(withdrawals.rows[0].total),
      average_wallet_balance: Number(balances.rows[0].average),
      packages_sold: Number(packages.rows[0].sold),
      packages_revenue: Number(packages.rows[0].revenue),
      today_earnings: Number(earnings.rows[0].today),
      week_earnings: Number(earnings.rows[0].week),
      month_earnings: Number(earnings.rows[0].month),
      kyc_breakdown: {
        tier1: tierMap['tier 1 basic'] || 0,
        tier2: tierMap['tier 2 verified'] || 0,
        tier3: tierMap['tier 3 vip'] || 0
      }
    }});
  } catch (err) {
    console.error('Admin analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/investments', adminAuth, ensureSuperAdmin, async (req, res) => {
  router.get('/earnings', adminAuth, ensureSuperAdmin, async (req, res) => {
    try {
      const [activeLines, recentYields] = await Promise.all([
        query(`SELECT ue.id, ue.title, ue.status, ue.daily_income, ue.activated_at, ue.expires_at, u.name, u.phone
               FROM user_esims ue JOIN users u ON u.id = ue.user_id
               WHERE ue.status = 'active' ORDER BY ue.daily_income DESC`),
        query(`SELECT wt.id, wt.amount, wt.title, wt.reference, wt.created_at, u.name, u.phone
               FROM wallet_transactions wt LEFT JOIN users u ON u.id = wt.user_id
               WHERE wt.type = 'yield' ORDER BY wt.created_at DESC LIMIT 100`)
      ]);
      res.json({ activeLines: activeLines.rows, recentYields: recentYields.rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch daily earnings' });
    }
  });
  try {
    const [byStatus, dailyYield, yieldHistory] = await Promise.all([
      query(
        `SELECT ue.status, COUNT(*) AS lines,
                COALESCE(SUM(COALESCE(ep.price, 0)), 0) AS value,
                COALESCE(SUM(COALESCE(ue.daily_income, 0)), 0) AS daily_yield
         FROM user_esims ue
         LEFT JOIN esim_packages ep ON ep.id = ue.package_id
         GROUP BY ue.status`
      ),
      query(`SELECT COALESCE(AVG(daily_income), 0) AS average, COALESCE(SUM(daily_income), 0) AS total
             FROM user_esims WHERE status = 'active'`),
      query(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS entries
             FROM wallet_transactions WHERE type = 'yield' AND status = 'completed'`)
    ]);

    const statusMap = Object.fromEntries(byStatus.rows.map(row => [String(row.status).toLowerCase(), row]));
    res.json({
      investments: {
        active: {
          lines: Number(statusMap.active?.lines || 0),
          value: Number(statusMap.active?.value || 0),
          dailyYield: Number(statusMap.active?.daily_yield || 0)
        },
        completed: {
          lines: Number(statusMap.completed?.lines || 0),
          value: Number(statusMap.completed?.value || 0)
        },
        cancelled: { lines: Number(statusMap.cancelled?.lines || 0), value: Number(statusMap.cancelled?.value || 0) },
        expired: { lines: Number(statusMap.expired?.lines || 0), value: Number(statusMap.expired?.value || 0) },
        averageDailyYield: Number(dailyYield.rows[0]?.average || 0),
        totalDailyYield: Number(dailyYield.rows[0]?.total || 0),
        totalYieldDisbursed: Number(yieldHistory.rows[0]?.total || 0),
        yieldEntries: Number(yieldHistory.rows[0]?.entries || 0)
      }
    });
  } catch (err) {
    console.error('Admin investments error:', err);
    res.status(500).json({ error: 'Failed to fetch investments and yields' });
  }
});

router.get('/settings', adminAuth, async (req, res) => {
  const result = await query('SELECT key, value FROM system_settings ORDER BY key');
  const settings = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
  res.json({ settings: {
    esim_progress_enabled: settings.esim_progress_enabled ?? 'true',
    esim_progress_percent_per_hour: settings.esim_progress_percent_per_hour ?? String((Number(settings.esim_progress_percent_per_day) || 10) / 24),
    ...settings
  } });
});

router.put('/settings', adminAuth, ensureSuperAdmin, async (req, res) => {
  const entries = Object.entries(req.body || {});
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)]
    );
  }
  res.json({ message: 'Settings saved successfully', settings: req.body || {} });
});

// 2. Recent Automatic Deposits
router.get('/deposits', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { status, limit = 50, search } = req.query;
    let sql = 'SELECT * FROM payment_requests';
    const params = [];

    const conditions = [];
    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(phone LIKE $${params.length} OR merchant LIKE $${params.length} OR reference LIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC LIMIT ' + (parseInt(limit) || 50);

    const result = await query(sql, params);
    res.json({ deposits: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deposits' });
  }
});

// Simulate Instant Auto-Deposit Callback
router.post('/deposits/simulate', adminAuth, async (req, res) => {
  try {
    const { phone = '+256 784 567 890', amount = 50000, merchant = 'VSIM-M001', network = 'MTN' } = req.body;
    const ref = `SIM-DEP-${Date.now().toString().slice(-6)}`;
    
    await query(
      `INSERT INTO payment_requests (phone, amount, merchant, network, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [phone, parseFloat(amount), merchant, network, ref, 'completed']
    );

    // Add log
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['deposit_confirmed', `Deposit confirmed: UGX ${parseFloat(amount).toLocaleString()} from ${phone}`, 'success', 'Just now']
    );

    res.status(201).json({ message: 'Simulated automatic deposit created', reference: ref });
  } catch (err) {
    res.status(500).json({ error: 'Failed to simulate deposit' });
  }
});

// 3. Withdrawal Requests (Payouts)
router.get('/withdrawals', adminAuth, async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    let sql = 'SELECT * FROM withdrawals';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` WHERE status = $1`;
    }

    sql += ' ORDER BY created_at DESC LIMIT ' + (parseInt(limit) || 50);
    const result = await query(sql, params);
    res.json({ withdrawals: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

router.get('/airtime-purchases', adminAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM airtime_purchase_requests ORDER BY created_at DESC LIMIT 100');
    res.json({ requests: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch airtime purchases' });
  }
});

router.get('/airtime-sales', adminAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM airtime_sale_requests ORDER BY created_at DESC LIMIT 100');
    res.json({ requests: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch airtime sales' });
  }
});

router.post('/airtime-sales/:id/action', adminAuth, async (req, res) => {
  try {
    const { action } = req.body || {};
    const current = await query('SELECT * FROM airtime_sale_requests WHERE id = $1', [req.params.id]);
    const request = current.rows[0];
    if (!request) return res.status(404).json({ error: 'Airtime sale not found' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Airtime sale already processed' });
    const status = action === 'reject' ? 'rejected' : action === 'approve' ? 'approved' : null;
    if (!status) return res.status(400).json({ error: 'Choose approve or reject' });
    await query('UPDATE airtime_sale_requests SET status = $1, processed_by = $2, processed_at = CURRENT_TIMESTAMP WHERE id = $3', [status, req.admin.id, request.id]);
    res.json({ message: `Airtime sale marked as ${status}`, request: { ...request, status } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process airtime sale' });
  }
});

router.post('/airtime-purchases/:id/action', adminAuth, async (req, res) => {
  try {
    const { action } = req.body || {};
    const current = await query('SELECT * FROM airtime_purchase_requests WHERE id = $1', [req.params.id]);
    const request = current.rows[0];
    if (!request) return res.status(404).json({ error: 'Airtime purchase not found' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Airtime purchase already processed' });
    const status = action === 'reject' ? 'rejected' : action === 'approve' ? 'approved' : null;
    if (!status) return res.status(400).json({ error: 'Choose approve or reject' });
    await query('UPDATE airtime_purchase_requests SET status = $1, processed_by = $2, processed_at = CURRENT_TIMESTAMP WHERE id = $3', [status, req.admin.id, request.id]);
    await query('UPDATE wallet_transactions SET status = $1 WHERE user_id = $2 AND reference = $3 AND type = $4', [status, request.user_id, request.reference, 'airtime_buy']);
    res.json({ message: `Airtime purchase marked as ${status}`, request: { ...request, status } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process airtime purchase' });
  }
});

// Process / Pay Withdrawal
router.post('/withdrawals/:id/action', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'pay_now', 'approve', 'reject'
    if (!['pay_now', 'approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Choose approve, reject, or dispatch' });
    }
    const withRow = await query('SELECT * FROM withdrawals WHERE id = $1', [id]);
    const w = withRow.rows[0];
    if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
    if (w.status !== 'pending') return res.status(409).json({ error: 'Withdrawal has already been processed' });

    const newStatus = action === 'reject' ? 'rejected' : 'approved';
    const txHash = action === 'reject' ? null : `MM-PAY-${Date.now().toString().slice(-8)}`;

    if (newStatus === 'approved') {
      // The withdrawal row stores the net payout, while the transaction keeps the gross request.
      const transactionRes = await query(
        `SELECT amount FROM wallet_transactions
         WHERE user_id = $1 AND reference = $2 AND type = 'withdrawal' AND status = 'pending'`,
        [w.user_id, w.reference]
      );
      const requiredBalance = Number(transactionRes.rows[0]?.amount ?? Number(w.amount) + 2000);
      const debitRes = await query(
        `UPDATE users
         SET wallet_balance = wallet_balance - $1
         WHERE id = $2 AND wallet_balance >= $1
         RETURNING id`,
        [requiredBalance, w.user_id]
      );
      if (debitRes.rows.length === 0) {
        const balanceRes = await query('SELECT wallet_balance FROM users WHERE id = $1', [w.user_id]);
        const currentBalance = Number(balanceRes.rows[0]?.wallet_balance || 0);
        return res.status(400).json({ error: `Insufficient wallet balance. Dispatch requires UGX ${requiredBalance.toLocaleString()}, but only UGX ${currentBalance.toLocaleString()} is available.` });
      }
    }

    await query('UPDATE withdrawals SET status = $1, tx_hash = $2, processed_by = $3, processed_at = CURRENT_TIMESTAMP WHERE id = $4 AND status = $5', [newStatus, txHash, req.admin.id, id, 'pending']);
    await query(
      `UPDATE wallet_transactions
       SET status = $1
       WHERE user_id = $2 AND reference = $3 AND type = 'withdrawal' AND status = 'pending'`,
      [newStatus, w.user_id, w.reference]
    );

    // Log the payout
    if (newStatus === 'approved') {
      await query(
        `INSERT INTO system_logs (action, details, level, time_ago)
         VALUES ($1, $2, $3, $4)`,
        ['withdrawal_paid', `Withdrawal paid: UGX ${w.amount.toLocaleString()} to ${w.phone} via Mobile Money`, 'info', 'Just now']
      );
    }

    res.json({ message: `Withdrawal marked as ${newStatus}`, withdrawal: { ...w, status: newStatus, tx_hash: txHash } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update withdrawal status' });
  }
});

// 4. User Directory
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { search, limit = 50 } = req.query;
    let sql = 'SELECT id, phone, name, email, initials, wallet_balance, kyc_tier, referral_code, status, created_at FROM users';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` WHERE phone LIKE $1 OR name LIKE $1 OR email LIKE $1 OR referral_code LIKE $1`;
    }

    sql += ' ORDER BY created_at DESC LIMIT ' + (parseInt(limit) || 50);
    const result = await query(sql, params);
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user directory' });
  }
});

// Get a user's eSIMs (for admin view)
router.get('/users/:id/esims', adminAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT ue.*, ep.image_url
       FROM user_esims ue
       LEFT JOIN esim_packages ep ON ep.id = ue.package_id
       WHERE ue.user_id = $1
       ORDER BY ue.activated_at DESC`,
      [req.params.id]
    );
    res.json({ esims: result.rows });
  } catch (err) {
    console.error('Fetch user eSIMs error:', err);
    res.status(500).json({ error: 'Failed to fetch user eSIMs' });
  }
});

// Update a user eSIM (admin) - allows editing progress rate, data totals, remaining, title and status
router.put('/esims/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, data_total, data_remaining, progress_percent_per_hour, status } = req.body || {};

    const existing = await query('SELECT * FROM user_esims WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'eSIM not found' });

    await query(
      `UPDATE user_esims SET
         title = COALESCE($1, title),
         data_total = COALESCE($2, data_total),
         data_remaining = COALESCE($3, data_remaining),
         progress_percent_per_hour = COALESCE($4, progress_percent_per_hour),
         status = COALESCE($5, status)
       WHERE id = $6`,
      [
        title !== undefined ? String(title).trim() : null,
        data_total !== undefined ? String(data_total).trim() : null,
        data_remaining !== undefined ? String(data_remaining).trim() : null,
        progress_percent_per_hour !== undefined ? Math.max(0, Math.min(100, parseFloat(progress_percent_per_hour) || 0)) : null,
        status !== undefined ? String(status).trim() : null,
        id
      ]
    );

    const updated = await query('SELECT * FROM user_esims WHERE id = $1', [id]);
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['admin_updated_esim', `Admin updated eSIM #${id}`, 'info', 'Just now']
    );

    res.json({ message: 'eSIM updated successfully', esim: updated.rows[0] });
  } catch (err) {
    console.error('Admin update eSIM error:', err);
    res.status(500).json({ error: 'Failed to update eSIM' });
  }
});

router.get('/referrals', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.phone, u.referral_code, u.wallet_balance,
              COUNT(DISTINCT referred.id) AS referred_users,
              COALESCE(SUM(CASE WHEN wt.type = 'referral' AND wt.status = 'completed' THEN wt.amount ELSE 0 END), 0) AS commission_earned
       FROM users u
       LEFT JOIN users referred ON referred.referred_by = u.referral_code
       LEFT JOIN wallet_transactions wt ON wt.user_id = u.id
       GROUP BY u.id, u.name, u.phone, u.referral_code, u.wallet_balance
       ORDER BY commission_earned DESC, referred_users DESC`
    );
    res.json({ referrals: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch referral report' });
  }
});

router.get('/transactions', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT wt.id, wt.user_id, wt.type, wt.title, wt.amount, wt.reference, wt.status, wt.created_at,
              u.name, u.phone
       FROM wallet_transactions wt
       LEFT JOIN users u ON u.id = wt.user_id
       ORDER BY wt.created_at DESC LIMIT 250`
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction ledger' });
  }
});

// Adjust User Balance (Credit/Debit)
router.post('/users/:id/adjust-balance', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type = 'credit', reason = 'Admin Balance Adjustment' } = req.body;
    const delta = parseFloat(amount);
    if (isNaN(delta) || delta <= 0) return res.status(400).json({ error: 'Invalid adjustment amount' });
    const op = type === 'debit' ? -delta : delta;
    await query('UPDATE users SET wallet_balance = MAX(0, wallet_balance + $1) WHERE id = $2', [op, id]);
    const updated = await query('SELECT id, name, phone, wallet_balance FROM users WHERE id = $1', [id]);
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, type === 'debit' ? 'admin_debit' : 'admin_credit', reason, delta, `ADM-ADJ-${Date.now()}`, 'completed']
    );
    res.json({ message: 'User balance updated successfully', user: updated.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to adjust user balance' });
  }
});

// 5. eSIM Packages Management
router.get('/packages', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM esim_packages ORDER BY price ASC');
    res.json({ packages: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

router.post('/packages', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { id, country, title, validity, data_quota, price, income, image_url, region, progress_percent_per_hour, renewal_schedule } = req.body;
    const pkgId = id || `pkg_${Date.now()}`;
    const schedule = normalizeRenewalSchedule(renewal_schedule, price);
    await query(
      `INSERT INTO esim_packages (id, country, title, validity, data_quota, price, income, image_url, region, progress_percent_per_hour, renewal_schedule, sold_count, revenue)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0)`,
      [
        pkgId,
        country || 'Global',
        title,
        validity || '30 Days',
        data_quota || '10 GB',
        parseFloat(price) || 20000,
        parseFloat(income) || 1200,
        image_url || '',
        region || 'global',
        Math.max(0, Math.min(100, parseFloat(progress_percent_per_hour) || 0.42)),
        JSON.stringify(schedule)
      ]
    );
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['package_created', `eSIM package created: ${title}`, 'success', 'Just now']
    );
    res.status(201).json({ message: `Package ${title} created successfully`, id: pkgId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create package' });
  }
});

router.put('/packages/:id', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { title, validity, data_quota, price, income, status, progress_percent_per_hour, renewal_schedule } = req.body;
    const schedule = renewal_schedule === undefined ? null : JSON.stringify(normalizeRenewalSchedule(renewal_schedule, price));
    await query(
      `UPDATE esim_packages 
       SET title = COALESCE($1, title),
           validity = COALESCE($2, validity),
           data_quota = COALESCE($3, data_quota),
           price = COALESCE($4, price),
           income = COALESCE($5, income),
           progress_percent_per_hour = COALESCE($6, progress_percent_per_hour),
           renewal_schedule = COALESCE($7, renewal_schedule)
      WHERE id = $8`,
         [title, validity, data_quota, price ? parseFloat(price) : null, income ? parseFloat(income) : null, progress_percent_per_hour !== undefined ? Math.max(0, Math.min(100, parseFloat(progress_percent_per_hour) || 0)) : null, schedule, id]
    );
    res.json({ message: 'Package updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update package' });
  }
});

router.put('/packages/:id/renewal-prices', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const packageResult = await query('SELECT price FROM esim_packages WHERE id = $1', [req.params.id]);
    if (!packageResult.rows.length) return res.status(404).json({ error: 'Package not found' });
    const schedule = normalizeRenewalSchedule(req.body?.renewal_schedule, packageResult.rows[0].price);
    if (!Array.isArray(req.body?.renewal_schedule) || schedule.length !== req.body.renewal_schedule.length) {
      return res.status(400).json({ error: 'Renewal dates must be unique and prices must increase above the original price' });
    }
    await query('UPDATE esim_packages SET renewal_schedule = $1 WHERE id = $2', [JSON.stringify(schedule), req.params.id]);
    res.json({ message: 'Renewal prices updated successfully', renewal_schedule: schedule });
  } catch (err) {
    console.error('Renewal pricing update error:', err);
    res.status(500).json({ error: 'Failed to save renewal prices' });
  }
});

router.delete('/packages/:id', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM esim_packages WHERE id = $1', [id]);
    res.json({ message: 'Package deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete package' });
  }
});

// 6. Bridge Devices Monitor
router.get('/bridge-devices', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM bridge_devices ORDER BY id ASC');
    res.json({ devices: result.rows.map(device => ({ ...device, device_secret: decryptBridgeSecret(device.device_secret) })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bridge devices' });
  }
});

router.post('/bridge-devices/:id/provision', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const deviceSecret = crypto.randomBytes(16).toString('hex');
    const credentialHash = hashBridgeSecret(deviceSecret);
    const { provider, merchant_id, app_version } = req.body || {};
    const result = await query(
      `UPDATE bridge_devices SET status = 'provisioning', provider = $1, merchant_id = $2, app_version = $3, credential_hash = $4, device_secret = $5, revoked_at = NULL WHERE id = $6 RETURNING device_id, status, provider, merchant_id, app_version`,
      [provider || null, merchant_id || null, app_version || null, credentialHash, encryptBridgeSecret(deviceSecret), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Bridge device not found' });
    res.json({ device: result.rows[0], deviceSecret, warning: 'Store this device secret securely.' });
  } catch (err) { res.status(500).json({ error: 'Failed to provision bridge device' }); }
});

router.post('/bridge-devices/:id/regenerate-secret', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const deviceSecret = crypto.randomBytes(16).toString('hex');
    const credentialHash = hashBridgeSecret(deviceSecret);
    const result = await query(
      'UPDATE bridge_devices SET device_secret = $1, credential_hash = $2 WHERE id = $3 RETURNING *',
      [encryptBridgeSecret(deviceSecret), credentialHash, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Bridge device not found' });
    res.json({ device: result.rows[0], deviceSecret, warning: 'The previous device secret is no longer valid.' });
  } catch (err) { res.status(500).json({ error: 'Failed to regenerate device secret' }); }
});

router.patch('/bridge-devices/:id/lifecycle', adminAuth, ensureSuperAdmin, async (req, res) => {
  const allowed = ['provisioning', 'active', 'disabled', 'revoked', 'decommissioned'];
  const status = String(req.body?.status || '').toLowerCase();
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid bridge lifecycle status' });
  const result = await query('UPDATE bridge_devices SET status = $1, revoked_at = CASE WHEN $1 = $2 THEN CURRENT_TIMESTAMP ELSE revoked_at END WHERE id = $3 RETURNING *', [status, 'revoked', req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Bridge device not found' });
  res.json({ device: result.rows[0] });
});

router.get('/bridge-events', adminAuth, ensureSuperAdmin, async (req, res) => {
  const result = await query('SELECT * FROM bridge_events ORDER BY received_at DESC LIMIT 100');
  res.json({ events: result.rows });
});

router.post('/bridge-devices', adminAuth, async (req, res) => {
  try {
    const { device_id, network, phone, sim_balance } = req.body;
    const deviceSecret = crypto.randomBytes(16).toString('hex');
    const credentialHash = hashBridgeSecret(deviceSecret);
    await query(
      `INSERT INTO bridge_devices (device_id, network, phone, status, sim_balance, ping_ms, device_secret, credential_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [device_id, network || 'MTN', phone, 'online', parseFloat(sim_balance) || 1000000, 35, encryptBridgeSecret(deviceSecret), credentialHash]
    );
    res.status(201).json({ message: `Bridge device ${device_id} registered`, deviceSecret });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register bridge device' });
  }
});

router.put('/bridge-devices/:id/status', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'online' | 'offline'

    await query('UPDATE bridge_devices SET status = $1 WHERE id = $2', [status, id]);
    const dev = await query('SELECT * FROM bridge_devices WHERE id = $1', [id]);

    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['bridge_status', `Bridge ${dev.rows[0]?.device_id} changed to ${status}`, status === 'online' ? 'success' : 'warning', 'Just now']
    );

    res.json({ message: `Bridge status updated to ${status}`, device: dev.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update bridge status' });
  }
});

// 7. System Activity Logs
router.get('/logs', adminAuth, ensureSuperAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 50');
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.get('/tickets', adminAuth, async (req, res) => {
  try {
    const result = await query(`SELECT st.*, u.name AS user_name, u.phone AS user_phone FROM support_tickets st LEFT JOIN users u ON u.id = st.user_id ORDER BY st.created_at DESC LIMIT 100`);
    res.json({ tickets: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch support tickets' }); }
});

router.patch('/tickets/:id', adminAuth, async (req, res) => {
  try {
    const { status, priority } = req.body || {};
    const result = await query(`UPDATE support_tickets SET status = COALESCE($1, status), priority = COALESCE($2, priority) WHERE id = $3`, [status, priority, req.params.id]);
    res.json({ message: 'Support ticket updated', ticket: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to update support ticket' }); }
});

// 8. Broadcast Notification to All App Users
router.post('/notifications/broadcast', adminAuth, async (req, res) => {
  try {
    const { title, message, category = 'promo' } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    const allUsers = await query('SELECT id FROM users');
    for (const u of allUsers.rows) {
      await query(
        `INSERT INTO notifications (user_id, title, message, category)
         VALUES ($1, $2, $3, $4)`,
        [u.id, title, message, category]
      );
    }

    res.json({ message: `Broadcast notification sent to ${allUsers.rows.length} users` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
});

// 9. Manual Yield Settlement Trigger
router.post('/settle-now', adminAuth, async (req, res) => {
  try {
    const activeLines = await query(`SELECT * FROM user_esims WHERE status = 'active'`);
    let settledCount = 0;

    for (const line of activeLines.rows) {
      if (line.daily_income > 0) {
        await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [line.daily_income, line.user_id]);
        
        const ref = `MANUAL-YIELD-${Date.now()}`;
        await query(
          `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [line.user_id, 'yield', `Daily Yield - ${line.title}`, line.daily_income, ref, 'completed']
        );
        settledCount++;
      }
    }

    res.json({ message: `Settled daily yields for ${settledCount} active eSIM lines` });
  } catch (err) {
    res.status(500).json({ error: 'Manual settlement failed' });
  }
});

export default router;
