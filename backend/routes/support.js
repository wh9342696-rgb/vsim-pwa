import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { emitDataChanged } from '../realtime.js';

const router = express.Router();
const MAX_MESSAGE_LENGTH = 2000;

function readMessage(value) {
  const body = String(value || '').trim();
  return body.length > 0 && body.length <= MAX_MESSAGE_LENGTH ? body : null;
}

router.get('/config', async (req, res) => {
  try {
    const result = await query(
      `SELECT key, value FROM system_settings
       WHERE key IN ('support_email', 'support_whatsapp', 'support_telegram', 'support_call_center')`
    );
    const settings = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
    res.json({
      support: {
        email: settings.support_email || '',
        whatsapp: settings.support_whatsapp || '',
        telegram: settings.support_telegram || '',
        callCenter: settings.support_call_center || ''
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load support contacts' });
  }
});

router.post('/tickets', authenticateToken, async (req, res) => {
  try {
    const { subject, priority = 'Medium' } = req.body || {};
    const message = readMessage(req.body?.message);
    if (!subject || !message || message.length < 10 || String(subject).length > 160) {
      return res.status(400).json({ error: 'Add a subject and at least 10 characters describing the issue' });
    }
    const user = await query('SELECT name, phone FROM users WHERE id = $1', [req.user.id]);
    const result = await query(
      `INSERT INTO support_tickets (user_id, name, phone, subject, priority, status)
       VALUES ($1, $2, $3, $4, $5, 'open')`,
      [req.user.id, user.rows[0]?.name || req.user.name, user.rows[0]?.phone || req.user.phone, `${subject}: ${message}`, priority]
    );
    await query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body)
       VALUES ($1, 'user', $2, $3)`,
      [result.rows[0].id, req.user.id, message]
    );
    res.status(201).json({ message: 'Support ticket sent to the admin team', ticket: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send support ticket' });
  }
});

router.post('/live/start', authenticateToken, async (req, res) => {
  try {
    const user = await query('SELECT name, phone FROM users WHERE id = $1', [req.user.id]);
    const subject = readMessage(req.body?.message) || 'Live support request';
    const result = await query(
      `INSERT INTO support_tickets (user_id, name, phone, subject, channel, priority, status)
       VALUES ($1, $2, $3, $4, 'live_chat', 'High', 'open')
       RETURNING *`,
      [req.user.id, user.rows[0]?.name || req.user.name, user.rows[0]?.phone || req.user.phone, subject]
    );
    const ticket = result.rows[0];
    await query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body)
       VALUES ($1, 'user', $2, $3)`,
      [ticket.id, req.user.id, subject]
    );
    emitDataChanged('support', { type: 'support', ticketId: ticket.id, audience: [{ type: 'user', id: req.user.id }, { type: 'admin_role', role: 'super_admin' }] });
    res.status(201).json({ ticket, messages: [{ sender_type: 'user', sender_id: req.user.id, body: subject }] });
  } catch (err) {
    console.error('Start live support error:', err);
    res.status(500).json({ error: 'Could not start live support' });
  }
});

router.get('/live/:ticketId', authenticateToken, async (req, res) => {
  try {
    const ticket = await query('SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2 AND channel = \'live_chat\'', [req.params.ticketId, req.user.id]);
    if (!ticket.rows[0]) return res.status(404).json({ error: 'Live support session not found' });
    const messages = await query('SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC, id ASC', [req.params.ticketId]);
    res.json({ ticket: ticket.rows[0], messages: messages.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not load live support' });
  }
});

router.post('/live/:ticketId/messages', authenticateToken, async (req, res) => {
  try {
    const body = readMessage(req.body?.body);
    if (!body) return res.status(400).json({ error: 'Message is required' });
    const ticket = await query('SELECT id FROM support_tickets WHERE id = $1 AND user_id = $2 AND channel = \'live_chat\' AND status NOT IN (\'closed\', \'resolved\')', [req.params.ticketId, req.user.id]);
    if (!ticket.rows[0]) return res.status(404).json({ error: 'Live support session is unavailable' });
    const result = await query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body)
       VALUES ($1, 'user', $2, $3)
       RETURNING *`,
      [req.params.ticketId, req.user.id, body]
    );
    const supportTicket = await query('SELECT assigned_admin_id FROM support_tickets WHERE id = $1', [req.params.ticketId]);
    emitDataChanged('support', { type: 'support', ticketId: req.params.ticketId, audience: [{ type: 'user', id: req.user.id }, { type: 'admin_role', role: 'super_admin' }, ...(supportTicket.rows[0]?.assigned_admin_id ? [{ type: 'admin', id: supportTicket.rows[0].assigned_admin_id }] : [])] });
    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Could not send live support message' });
  }
});

export default router;
