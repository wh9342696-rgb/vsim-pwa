import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/tickets', authenticateToken, async (req, res) => {
  try {
    const { subject, priority = 'Medium' } = req.body || {};
    const message = String(req.body?.message || '').trim();
    if (!subject || message.length < 10) {
      return res.status(400).json({ error: 'Add a subject and at least 10 characters describing the issue' });
    }
    const user = await query('SELECT name, phone FROM users WHERE id = $1', [req.user.id]);
    const result = await query(
      `INSERT INTO support_tickets (user_id, name, phone, subject, priority, status)
       VALUES ($1, $2, $3, $4, $5, 'open')`,
      [req.user.id, user.rows[0]?.name || req.user.name, user.rows[0]?.phone || req.user.phone, `${subject}: ${message}`, priority]
    );
    res.status(201).json({ message: 'Support ticket sent to the admin team', ticket: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send support ticket' });
  }
});

export default router;
