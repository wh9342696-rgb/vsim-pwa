import jwt from 'jsonwebtoken';

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const secret = process.env.JWT_SECRET;

  jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'vsim-api', audience: 'vsim-client' }, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    try {
      const userRecord = await import('../config/db.js').then(({ query }) => query('SELECT id, current_session_token FROM users WHERE id = $1', [decoded.id]));
      const expectedSessionToken = userRecord.rows[0]?.current_session_token || null;
      if (!expectedSessionToken || decoded.sessionToken !== expectedSessionToken) {
        return res.status(401).json({ error: 'Session invalid. Please log in again.' });
      }

      req.user = decoded;
      next();
    } catch (error) {
      return res.status(500).json({ error: 'Unable to validate session' });
    }
  });
}
