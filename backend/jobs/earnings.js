import cron from 'node-cron';
import { query } from '../config/db.js';

export function startEarningsCronJob() {
  // Scheduled every 24 hours at 00:00 UTC (0 0 * * *)
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Running daily eSIM yield settlement job...');
    try {
      // Fetch active user eSIMs
      const activeLines = await query(`SELECT * FROM user_esims WHERE status = 'active'`);

      for (const line of activeLines.rows) {
        if (line.daily_income > 0) {
          // Credit wallet balance
          await query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [line.daily_income, line.user_id]);

          // Log transaction
          const ref = `YIELD-${Date.now()}`;
          await query(
            `INSERT INTO wallet_transactions (user_id, type, title, amount, reference, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [line.user_id, 'yield', `Daily Yield - ${line.title}`, line.daily_income, ref, 'completed']
          );

          // Create notification item
          await query(
            `INSERT INTO notifications (user_id, title, message, category)
             VALUES ($1, $2, $3, $4)`,
            [line.user_id, 'Daily Income Credited', `UGX ${line.daily_income.toLocaleString()} credited to your wallet balance for ${line.title}.`, 'system']
          );
        }
      }
      console.log(`[CRON] Settled daily yields for ${activeLines.rows.length} active eSIM lines.`);
    } catch (err) {
      console.error('[CRON] Daily settlement failed:', err);
    }
  });
}
