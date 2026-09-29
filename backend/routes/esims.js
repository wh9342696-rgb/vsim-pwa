import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { createUniqueReference } from '../utils/reference.js';

const router = express.Router();

function parseDataValue(value) {
  const match = String(value || '').trim().match(/([\d.]+)\s*(KB|MB|GB|TB)?/i);
  if (!match) return null;
  const unit = (match[2] || 'GB').toUpperCase();
  const multipliers = { KB: 1 / 1024 / 1024, MB: 1 / 1024, GB: 1, TB: 1024 };
  return { amount: Number(match[1]) * multipliers[unit], unit };
}

function formatDataValue(amountGb, unit) {
  const multipliers = { KB: 1024 * 1024, MB: 1024, GB: 1, TB: 1 / 1024 };
  const amount = amountGb * multipliers[unit];
  return `${Number(amount.toFixed(2))} ${unit}`;
}

function classifyEsimStatus(esim, now = Date.now()) {
  if (esim.status === 'revoked') return 'revoked';
  return esim.expires_at && now >= new Date(esim.expires_at).getTime() ? 'expired' : 'active';
}

function getRenewalPrice(pkg, renewalCount) {
  const basePrice = Number(pkg.price) || 0;
  let schedule = [];
  try {
    schedule = Array.isArray(pkg.renewal_schedule) ? pkg.renewal_schedule : JSON.parse(pkg.renewal_schedule || '[]');
  } catch (error) {}
  const scheduled = schedule[Number(renewalCount) || 0];
  return scheduled && Number(scheduled.price) > basePrice
    ? Number(scheduled.price)
    : basePrice * (Number(renewalCount) > 0 ? 1.1 : 1);
}

// 1. Get All Available eSIM Packages (Filterable by region and query)
router.get('/packages', async (req, res) => {
  try {
    const { region, search } = req.query;
    let sql = 'SELECT * FROM esim_packages';
    const params = [];

    const conditions = [];
    if (region && region !== 'all' && region !== 'popular') {
      params.push(region.toLowerCase());
      conditions.push(`LOWER(region) = $${params.length}`);
    }

    if (search && search.trim().length > 0) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`(LOWER(country) LIKE $${params.length} OR LOWER(title) LIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const result = await query(sql, params);
    res.json({ packages: result.rows });
  } catch (err) {
    console.error('Packages error:', err);
    res.status(500).json({ error: 'Failed to fetch eSIM packages' });
  }
});

// 2. Get Single Package Details
router.get('/packages/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM esim_packages WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Package not found' });
    }
    res.json({ package: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch package details' });
  }
});

// 3. Reject legacy wallet purchases; manual payment verification fulfills eSIM orders.
router.post('/wallet-orders', authenticateToken, async (req, res) => {
  try {
    const { packageId, targetEsimId, targetEsimIccid } = req.body || {};
    if (!packageId) return res.status(400).json({ error: 'Choose an eSIM package' });

    const packageResult = await query('SELECT * FROM esim_packages WHERE id = $1', [packageId]);
    if (!packageResult.rows.length) return res.status(404).json({ error: 'Package not found' });
    const pkg = packageResult.rows[0];

    let target = null;
    if (targetEsimIccid || targetEsimId) {
      const targetResult = targetEsimIccid
        ? await query('SELECT id, renewal_count FROM user_esims WHERE iccid = $1 AND user_id = $2 AND status <> \'revoked\'', [targetEsimIccid, req.user.id])
        : await query('SELECT id, renewal_count FROM user_esims WHERE id = $1 AND user_id = $2 AND status <> \'revoked\'', [targetEsimId, req.user.id]);
      if (!targetResult.rows.length) return res.status(404).json({ error: 'Target eSIM not found' });
      target = targetResult.rows[0];
      if (targetEsimId && String(target.id) !== String(targetEsimId)) {
        return res.status(400).json({ error: 'Target eSIM identifiers do not match' });
      }
    }

    const amount = getRenewalPrice(pkg, Number(target?.renewal_count) || 0);
    const existing = await query(
      `SELECT id, reference, status FROM payment_requests
       WHERE user_id = $1 AND package_id = $2 AND payment_method = 'wallet'
         AND status = 'pending'
         AND (target_esim_id = $3 OR (target_esim_id IS NULL AND $3 IS NULL))
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, pkg.id, target?.id || null]
    );
    if (existing.rows.length) {
      return res.json({ success: true, order: existing.rows[0], message: 'Your wallet request is already awaiting review.' });
    }

    const balanceResult = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    if (Number(balanceResult.rows[0]?.wallet_balance || 0) < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance for this eSIM request' });
    }

    const reference = await createUniqueReference('WALLET-ESIM', async candidate =>
      (await query('SELECT id FROM payment_requests WHERE reference = $1', [candidate])).rows.length > 0
    );
    const inserted = await query(
      `INSERT INTO payment_requests
       (user_id, phone, amount, merchant, network, reference, package_id, target_esim_id, payment_method, status, payment_status, order_status, provisioning_status)
       VALUES ($1, $2, $3, 'VSIM Wallet', 'WALLET', $4, $5, $6, 'wallet', 'pending', 'WALLET_AWAITING_APPROVAL', 'PENDING_PAYMENT', 'NOT_STARTED')
       RETURNING id, reference, status, amount`,
      [req.user.id, req.user.phone, amount, reference, pkg.id, target?.id || null]
    );

    const message = `Wallet-funded eSIM request for ${pkg.title} (UGX ${amount.toLocaleString()}) is awaiting manual approval.`;
    const admins = await query("SELECT id FROM admin_users WHERE status = 'active'");
    for (const admin of admins.rows) {
      await query(
        `INSERT INTO notifications (user_id, admin_id, title, message, category)
         VALUES ($1, $2, $3, $4, 'wallet')`,
        [req.user.id, admin.id, 'Wallet eSIM Request', message]
      );
      await query(
        `INSERT INTO admin_notifications (admin_id, type, title, message, reference, status)
         VALUES ($1, 'payment', 'Wallet eSIM Request', $2, $3, 'pending')`,
        [admin.id, message, reference]
      );
    }
    await query(
      `INSERT INTO notifications (user_id, title, message, category)
       VALUES ($1, 'Wallet Request Submitted', $2, 'wallet')`,
      [req.user.id, `Your ${pkg.title} wallet request is awaiting admin approval. Your balance will only be charged if approved.`]
    );

    res.status(201).json({ success: true, order: inserted.rows[0], message: 'Wallet request submitted for manual review.' });
  } catch (err) {
    console.error('Wallet eSIM order error:', err);
    res.status(500).json({ error: 'Failed to submit wallet eSIM request' });
  }
});

router.post('/purchase', authenticateToken, (_req, res) => {
  res.status(400).json({ error: 'eSIM purchases must be paid through manual Mobile Money checkout and verified before activation' });
});

// 4. Get User's eSIMs (Active & Expired)
router.get('/my-esims', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT ue.*, ep.image_url
       FROM user_esims ue
       LEFT JOIN esim_packages ep ON ep.id = ue.package_id
      WHERE ue.user_id = $1 AND ue.status <> 'revoked'
       ORDER BY ue.activated_at DESC`,
      [req.user.id]
    );
    const settingsResult = await query(
      `SELECT key, value FROM system_settings
       WHERE key IN ('esim_progress_enabled', 'esim_progress_percent_per_hour', 'esim_progress_percent_per_day')`
    );
    const settings = Object.fromEntries(settingsResult.rows.map(row => [row.key, row.value]));
    const progressEnabled = settings.esim_progress_enabled !== 'false';
    const globalHourlyPercent = Math.max(0, Math.min(100, Number(settings.esim_progress_percent_per_hour) || (Number(settings.esim_progress_percent_per_day) || 10) / 24));
    const now = Date.now();
    const esims = await Promise.all(result.rows.map(async (esim) => {
      const canonicalStatus = classifyEsimStatus(esim, now);
      const total = parseDataValue(esim.data_total);
      let updatedEsim = esim;
      let remainingAmount = total ? Number(parseDataValue(esim.data_remaining)?.amount || 0) : null;

      if (canonicalStatus === 'active' && progressEnabled && total && esim.activated_at) {
        const storedHourlyPercent = Number(esim.progress_percent_per_hour);
        const isLegacyDefaultRate = !storedHourlyPercent || Math.abs(storedHourlyPercent - 0.42) < 0.0001;
        const hourlyPercent = isLegacyDefaultRate
          ? globalHourlyPercent
          : Math.max(0, Math.min(100, storedHourlyPercent));
        const elapsedHours = Math.max(0, (now - new Date(esim.activated_at).getTime()) / 3600000);
        const progressPercent = Math.min(100, elapsedHours * hourlyPercent);
        remainingAmount = Math.max(0, total.amount * (1 - (progressPercent / 100)));
        updatedEsim = {
          ...esim,
          data_remaining: formatDataValue(remainingAmount, total.unit),
          progress_percent: progressPercent,
          progress_percent_per_hour: hourlyPercent
        };
      }

      if (esim.status !== canonicalStatus) {
        await query('UPDATE user_esims SET status = $1, data_remaining = $2 WHERE id = $3', [
          canonicalStatus,
          updatedEsim.data_remaining || esim.data_remaining,
          esim.id
        ]);
        updatedEsim = { ...updatedEsim, status: canonicalStatus };
      } else {
        updatedEsim = { ...updatedEsim, status: canonicalStatus };
      }

      if (canonicalStatus === 'active' && remainingAmount !== null && remainingAmount <= 0) {
        const notificationReference = `ESIM-DATA-EMPTY-${esim.id}`;
        const existingNotification = await query(
          'SELECT id FROM notifications WHERE user_id = $1 AND category = $2 AND message LIKE $3',
          [req.user.id, 'esim', `%${notificationReference}%`]
        );
        if (!existingNotification.rows.length) {
          await query(
            `INSERT INTO notifications (user_id, title, message, category)
             VALUES ($1, $2, $3, $4)`,
            [req.user.id, 'Your eSIM bundle is finished', `Your active eSIM ${esim.iccid || esim.title} has no data remaining. Buy a new bundle to stay connected. ${notificationReference}`, 'esim']
          );
        }
      }

      return updatedEsim;
    }));
    res.json({ esims });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user eSIMs' });
  }
});

export default router;
