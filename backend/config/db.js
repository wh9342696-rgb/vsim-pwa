import dotenv from 'dotenv';
import pg from 'pg';
import { emitDataChanged } from '../realtime.js';

dotenv.config();

const { Pool } = pg;
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const requiredVariables = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
if (!hasDatabaseUrl) {
  const missing = requiredVariables.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`PostgreSQL configuration is incomplete. Set DATABASE_URL or: ${missing.join(', ')}`);
  }
}

const pool = new Pool({
  ...(hasDatabaseUrl ? { connectionString: process.env.DATABASE_URL } : {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
  }),
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PGPOOL_MAX || 20),
  min: Number(process.env.PGPOOL_MIN || 2),
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECT_MS || 5000)
});

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, email TEXT, name TEXT NOT NULL, password_hash TEXT NOT NULL, initials TEXT, kyc_tier TEXT DEFAULT 'Tier 0 Unverified', wallet_balance NUMERIC(12,2) DEFAULT 0.00, referral_code TEXT UNIQUE, referred_by TEXT, profile_photo TEXT, current_session_token TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS admin_users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT DEFAULT 'super_admin', status TEXT DEFAULT 'active', current_session_token TEXT, profit_total NUMERIC(12,2) DEFAULT 0, joined_users_count INTEGER DEFAULT 0, profile_photo TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS passkey_credentials (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, credential_id TEXT UNIQUE NOT NULL, public_key TEXT NOT NULL, counter BIGINT DEFAULT 0, transports TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS passkey_challenges (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, phone TEXT, challenge TEXT NOT NULL, purpose TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS esim_packages (id TEXT PRIMARY KEY, country TEXT, title TEXT NOT NULL, validity TEXT, data_quota TEXT, type TEXT DEFAULT 'Data Only', price NUMERIC(12,2) NOT NULL, income NUMERIC(12,2) NOT NULL, sold_count INTEGER DEFAULT 0, revenue NUMERIC(12,2) DEFAULT 0, image_url TEXT, region TEXT, renewal_schedule TEXT DEFAULT '[]', progress_percent_per_hour NUMERIC(8,4) DEFAULT 0.42, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS merchants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, merchant_code TEXT NOT NULL, network TEXT NOT NULL DEFAULT 'MTN', account_name TEXT, phone TEXT, instructions TEXT, status TEXT NOT NULL DEFAULT 'inactive', priority INTEGER NOT NULL DEFAULT 10, total_transactions INTEGER NOT NULL DEFAULT 0, total_volume NUMERIC(12,2) NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS user_esims (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), package_id TEXT, title TEXT NOT NULL, country TEXT, iccid TEXT, status TEXT DEFAULT 'active', data_total TEXT, data_remaining TEXT, daily_income NUMERIC(12,2) DEFAULT 0, renewal_count INTEGER DEFAULT 0, progress_percent_per_hour NUMERIC(8,4) DEFAULT 0.42, activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS kyc_submissions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), tier INTEGER NOT NULL CHECK (tier IN (1, 2)), nin TEXT, document_image TEXT, status TEXT NOT NULL DEFAULT 'pending', rejection_reason TEXT, reviewed_by INTEGER REFERENCES admin_users(id), reviewed_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS wallet_transactions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, reference TEXT, status TEXT DEFAULT 'completed', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS payment_requests (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), phone TEXT NOT NULL, requested_amount NUMERIC(12,2), amount NUMERIC(12,2) NOT NULL, merchant TEXT DEFAULT 'VSIM-M001', network TEXT DEFAULT 'MTN', reference TEXT UNIQUE, package_id TEXT, target_esim_id INTEGER, status TEXT DEFAULT 'completed', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS airtime_purchase_requests (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), phone TEXT NOT NULL, network TEXT NOT NULL, airtime_amount NUMERIC(12,2) NOT NULL, payment_amount NUMERIC(12,2) NOT NULL, merchant_number TEXT NOT NULL, reference TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'pending', processed_by INTEGER REFERENCES admin_users(id), processed_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS airtime_sale_requests (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), payout_phone TEXT NOT NULL, network TEXT NOT NULL, airtime_amount NUMERIC(12,2) NOT NULL, payout_amount NUMERIC(12,2) NOT NULL, merchant_number TEXT NOT NULL, reference TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'pending', processed_by INTEGER REFERENCES admin_users(id), processed_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), phone TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, method TEXT DEFAULT 'Mobile Money', network TEXT DEFAULT 'MTN', status TEXT DEFAULT 'pending', tx_hash TEXT, reference TEXT, requested_amount NUMERIC(12,2), processed_by INTEGER REFERENCES admin_users(id), processed_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS bridge_devices (id SERIAL PRIMARY KEY, device_id TEXT UNIQUE, network TEXT, phone TEXT, status TEXT DEFAULT 'online', sim_balance NUMERIC(12,2) DEFAULT 150000, ping_ms INTEGER DEFAULT 42, last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP, device_secret TEXT, provider TEXT, merchant_id TEXT, app_version TEXT, credential_hash TEXT, revoked_at TIMESTAMP, last_sync TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS bridge_events (id SERIAL PRIMARY KEY, bridge_device_id TEXT NOT NULL, provider TEXT NOT NULL, merchant_id TEXT NOT NULL, transaction_reference TEXT NOT NULL, transaction_type TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, currency TEXT NOT NULL DEFAULT 'UGX', provider_timestamp TIMESTAMP, received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED', UNIQUE (bridge_device_id, provider, merchant_id, transaction_reference))`,
  `CREATE TABLE IF NOT EXISTS system_logs (id SERIAL PRIMARY KEY, action TEXT NOT NULL, details TEXT NOT NULL, level TEXT DEFAULT 'info', time_ago TEXT, user_id INTEGER REFERENCES users(id), admin_id INTEGER REFERENCES admin_users(id), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS support_tickets (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT, phone TEXT, subject TEXT, priority TEXT DEFAULT 'Medium', status TEXT DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), admin_id INTEGER REFERENCES admin_users(id), title TEXT NOT NULL, message TEXT NOT NULL, category TEXT DEFAULT 'system', is_read INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS admin_notifications (id SERIAL PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admin_users(id), type TEXT, title TEXT NOT NULL, message TEXT, reference TEXT, related_id INTEGER, status TEXT DEFAULT 'pending', action_taken TEXT, acted_on_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
];

async function initializePostgresSchema() {
  for (const statement of schemaStatements) await pool.query(statement);
  const migrations = [
    'ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS profit_total NUMERIC(12,2) DEFAULT 0',
    'ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS joined_users_count INTEGER DEFAULT 0',
    'ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS profile_photo TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT',
    'ALTER TABLE esim_packages ADD COLUMN IF NOT EXISTS progress_percent_per_hour NUMERIC(8,4) DEFAULT 0.42',
    "ALTER TABLE esim_packages ADD COLUMN IF NOT EXISTS renewal_schedule TEXT DEFAULT '[]'",
    'ALTER TABLE user_esims ADD COLUMN IF NOT EXISTS progress_percent_per_hour NUMERIC(8,4) DEFAULT 0.42',
    'ALTER TABLE user_esims ADD COLUMN IF NOT EXISTS renewal_count INTEGER DEFAULT 0',
    'ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(12,2)',
    'ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS package_id TEXT',
    'ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS target_esim_id INTEGER',
    'ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS reference TEXT',
    'ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(12,2)',
    'ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS processed_by INTEGER REFERENCES admin_users(id)',
    'ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP',
    'ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS provider TEXT',
    'ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS merchant_id TEXT',
    'ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS app_version TEXT',
    'ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS credential_hash TEXT',
    'ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP',
    'ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS last_sync TIMESTAMP',
    'ALTER TABLE notifications ALTER COLUMN user_id DROP NOT NULL'
  ];
  for (const statement of migrations) await pool.query(statement);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS user_esims_iccid_unique ON user_esims (iccid) WHERE iccid IS NOT NULL');
}

await initializePostgresSchema();

export async function query(text, params = []) {
  let sql = text.trim();
  if (/^INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) sql += ' RETURNING *';
  const result = await pool.query(sql, params);
  if (!/^SELECT\b/i.test(sql) && !/^WITH\b/i.test(sql)) emitDataChanged('database');
  return { rows: result.rows, rowCount: result.rowCount };
}

export async function closeDatabase() {
  await pool.end();
}

export { pool };
