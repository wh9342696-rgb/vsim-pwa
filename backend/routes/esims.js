import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

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
  return esim.expires_at && now >= new Date(esim.expires_at).getTime() ? 'expired' : 'active';
}

function createIccid() {
  return `8944${Date.now().toString().slice(-8)}${Math.floor(100000 + Math.random() * 900000)}`;
}

function getValidityDays(value) {
  const days = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(days) && days > 0 ? Math.ceil(days) : 30;
}

function getRenewalPrice(pkg, renewalCount) {
  const basePrice = Number(pkg.price) || 0;
  try {
    const schedule = Array.isArray(pkg.renewal_schedule) ? pkg.renewal_schedule : JSON.parse(pkg.renewal_schedule || '[]');
    const scheduled = schedule[Number(renewalCount) || 0];
    if (scheduled && Number(scheduled.price) > basePrice) return Number(scheduled.price);
  } catch (error) {}
  return basePrice * (Number(renewalCount) > 0 ? 1.1 : 1);
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

// 3. Purchase eSIM Package (Wallet Balance or Mobile Money)
router.post('/purchase', authenticateToken, async (req, res) => {
  try {
    const { packageId, payMethod, targetEsimId, targetEsimIccid } = req.body;

    const pkgRes = await query('SELECT * FROM esim_packages WHERE id = $1', [packageId]);
    if (pkgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const pkg = pkgRes.rows[0];
    if (payMethod !== 'wallet') {
      return res.status(400).json({ error: 'Mobile Money payment must be confirmed before activating an eSIM' });
    }
    const userRes = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    const currentBalance = Number(userRes.rows[0].wallet_balance) || 0;
    let packagePrice = Number(pkg.price) || 0;

    let targetEsim = null;
    const targetIdentifier = targetEsimIccid || targetEsimId;
    if (targetIdentifier) {
      const targetRes = targetEsimIccid
        ? await query('SELECT id, iccid, data_total, data_remaining, renewal_count FROM user_esims WHERE iccid = $1 AND user_id = $2', [targetEsimIccid, req.user.id])
        : await query('SELECT id, iccid, data_total, data_remaining, renewal_count FROM user_esims WHERE id = $1 AND user_id = $2', [targetIdentifier, req.user.id]);
      if (!targetRes.rows.length) return res.status(404).json({ error: 'Target eSIM not found' });
      targetEsim = targetRes.rows[0];
      if (targetEsimId && String(targetEsim.id) !== String(targetEsimId)) {
        return res.status(400).json({ error: 'Target eSIM identifiers do not match' });
      }
    }
    const resolvedTargetEsimId = targetEsim?.id || null;
    if (targetEsim) packagePrice = getRenewalPrice(pkg, Number(targetEsim.renewal_count) || 0);

    if (payMethod === 'wallet') {
      if (currentBalance < packagePrice) {
        return res.status(400).json({ error: 'Insufficient wallet balance' });
      }
      // Deduct balance
      await query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [packagePrice, req.user.id]);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + getValidityDays(pkg.validity));

    let purchasedIccid = null;
    let renewedEsim = null;
    if (resolvedTargetEsimId) {
      purchasedIccid = targetEsim.iccid;
      const existingTotal = parseDataValue(targetEsim.data_total);
      const existingRemaining = parseDataValue(targetEsim.data_remaining);
      const bundleData = parseDataValue(pkg.data_quota);
      const dataUnit = existingTotal?.unit || bundleData?.unit || 'GB';
      const bundleGb = bundleData ? bundleData.amount : 0;
      const existingTotalGb = existingTotal ? existingTotal.amount : 0;
      const existingRemainingGb = existingRemaining ? existingRemaining.amount : 0;
      const renewedTotal = formatDataValue(existingTotalGb + bundleGb, dataUnit);
      const renewedRemaining = formatDataValue(existingRemainingGb + bundleGb, dataUnit);
      await query(
        `UPDATE user_esims
         SET package_id = $1, title = $2, status = 'active', data_total = $3,
           data_remaining = $4, daily_income = $5, progress_percent_per_hour = $6,
           renewal_count = COALESCE(renewal_count, 0) + 1,
           activated_at = CURRENT_TIMESTAMP, expires_at = $7
         WHERE id = $8 AND user_id = $9`,
        [pkg.id, pkg.title, renewedTotal, renewedRemaining, pkg.income, Number(pkg.progress_percent_per_hour) || 0.42, expiresAt.toISOString(), resolvedTargetEsimId, req.user.id]
      );
      renewedEsim = (await query(
        'SELECT * FROM user_esims WHERE id = $1 AND user_id = $2',
        [resolvedTargetEsimId, req.user.id]
      )).rows[0];
    } else {
      let iccid = createIccid();
      while ((await query('SELECT id FROM user_esims WHERE iccid = $1', [iccid])).rows.length) {
        iccid = createIccid();
      }
      purchasedIccid = iccid;
      await query(
        `INSERT INTO user_esims (user_id, package_id, title, country, iccid, status, data_total, data_remaining, daily_income, progress_percent_per_hour, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [req.user.id, pkg.id, pkg.title, pkg.country, iccid, 'active', pkg.data_quota, pkg.data_quota, pkg.income, Number(pkg.progress_percent_per_hour) || 0.42, expiresAt.toISOString()]
      );
    }

    // Log transaction
    await query(
      `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, resolvedTargetEsimId ? 'bundle_purchase' : 'purchase', `${pkg.title} ${resolvedTargetEsimId ? 'Bundle' : 'Purchase'}`, packagePrice, `ICCID:${purchasedIccid}`, 'completed']
    );

    // Update package sales counter & revenue
    await query(
      `UPDATE esim_packages SET sold_count = sold_count + 1, revenue = revenue + $1 WHERE id = $2`,
      [packagePrice, pkg.id]
    );

    // If user was referred by someone, credit referrer a 10% affiliate commission
    const currentUserRes = await query('SELECT name, referred_by FROM users WHERE id = $1', [req.user.id]);
    const referredByCode = currentUserRes.rows[0]?.referred_by;
    if (referredByCode) {
      const refUserRes = await query('SELECT id, name FROM users WHERE referral_code = $1', [referredByCode]);
      if (refUserRes.rows.length > 0) {
        const referrer = refUserRes.rows[0];
        const commission = Math.round(packagePrice * 0.10); // 10% commission
        if (commission > 0) {
          const commissionRef = `COMM-ESIM-${user.id}-${iccid.replace(/\s/g, '')}`;
          const existingCommission = await query('SELECT id FROM wallet_transactions WHERE reference = $1', [commissionRef]);
          if (!existingCommission.rows.length) {
            await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [commission, referrer.id]);
            await query(
              `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [referrer.id, 'referral', `Referral Commission (${pkg.title})`, commission, commissionRef, 'completed']
            );
            await query(
              `INSERT INTO notifications (user_id, title, message, category)
               VALUES ($1, $2, $3, $4)`,
              [referrer.id, 'Referral Commission Earned!', `UGX ${commission.toLocaleString()} commission was added to your wallet because ${user.name} purchased ${pkg.title}.`, 'wallet']
            );
          }
        }
      }
    }

    // Record system log for Admin Panel
    const userPhone = req.user.phone || 'Customer';
    await query(
      `INSERT INTO system_logs (action, details, level, time_ago)
       VALUES ($1, $2, $3, $4)`,
      ['esim_purchase', `eSIM purchased: ${pkg.title} (UGX ${pkg.price.toLocaleString()}) by ${userPhone}`, 'success', 'Just now']
    );

    const updatedUser = await query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);

    res.json({
      message: `Successfully purchased ${pkg.title}!`,
      iccid: purchasedIccid,
      esimId: resolvedTargetEsimId,
      esim: renewedEsim,
      walletBalance: updatedUser.rows[0].wallet_balance
    });
  } catch (err) {
    console.error('Purchase error:', err);
    res.status(500).json({ error: 'Failed to process eSIM purchase' });
  }
});

// 4. Get User's eSIMs (Active & Expired)
router.get('/my-esims', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT ue.*, ep.image_url
       FROM user_esims ue
       LEFT JOIN esim_packages ep ON ep.id = ue.package_id
       WHERE ue.user_id = $1
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
