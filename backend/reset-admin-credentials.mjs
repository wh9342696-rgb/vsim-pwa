import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

process.stderr.write('Enter the new admin password: ');
const password = fs.readFileSync(0, 'utf8').trim();
if (password.length < 12) throw new Error('Password must be at least 12 characters');
const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});
const passwordHash = await bcrypt.hash(password, 12);
await pool.query(
  'UPDATE admin_users SET email = $1, password_hash = $2, current_session_token = NULL WHERE id = (SELECT id FROM admin_users ORDER BY id LIMIT 1)',
  ['open@vsim.com', passwordHash]
);
await pool.end();
console.log('Admin credentials updated');
