import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';
import crypto from 'crypto';
import { emitDataChanged } from '../realtime.js';
import { encryptBridgeSecret, hashBridgeSecret } from '../utils/bridge-secret.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let queryFn;
let pool;

async function initializePostgresSchema() {
  if (!pool) return;

  const requiredTables = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      initials TEXT,
      kyc_tier TEXT DEFAULT 'Tier 0 Unverified',
      wallet_balance NUMERIC(12,2) DEFAULT 0.00,
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      profile_photo TEXT,
      current_session_token TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS passkey_credentials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter BIGINT DEFAULT 0,
      transports TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS passkey_challenges (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT,
      challenge TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'super_admin',
      status TEXT DEFAULT 'active',
      current_session_token TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS esim_packages (
      id TEXT PRIMARY KEY,
      country TEXT,
      title TEXT NOT NULL,
      validity TEXT,
      data_quota TEXT,
      type TEXT DEFAULT 'Data Only',
      price NUMERIC(12,2) NOT NULL,
      income NUMERIC(12,2) NOT NULL,
      commission_percent NUMERIC(5,2) DEFAULT 10,
      sold_count INTEGER DEFAULT 0,
      revenue NUMERIC(12,2) DEFAULT 0,
      image_url TEXT,
      region TEXT,
      renewal_schedule TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS merchants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      merchant_code TEXT NOT NULL,
      network TEXT NOT NULL DEFAULT 'MTN',
      account_name TEXT,
      phone TEXT,
      instructions TEXT,
      status TEXT NOT NULL DEFAULT 'inactive',
      priority INTEGER NOT NULL DEFAULT 10,
      total_transactions INTEGER NOT NULL DEFAULT 0,
      total_volume NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_esims (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      package_id TEXT,
      title TEXT NOT NULL,
      country TEXT,
      iccid TEXT,
      status TEXT DEFAULT 'active',
      data_total TEXT,
      data_remaining TEXT,
      daily_income NUMERIC(12,2) DEFAULT 0,
      renewal_count INTEGER DEFAULT 0,
      activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS kyc_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
      nin TEXT,
      document_image TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      reviewed_by INTEGER REFERENCES admin_users(id),
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      reference TEXT,
      status TEXT DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS payment_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      phone TEXT NOT NULL,
      requested_amount NUMERIC(12,2),
      amount NUMERIC(12,2) NOT NULL,
      merchant TEXT DEFAULT 'VSIM-M001',
      network TEXT DEFAULT 'MTN',
      reference TEXT,
      status TEXT DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS airtime_purchase_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      phone TEXT NOT NULL,
      network TEXT NOT NULL,
      airtime_amount NUMERIC(12,2) NOT NULL,
      payment_amount NUMERIC(12,2) NOT NULL,
      merchant_number TEXT NOT NULL,
      reference TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      processed_by INTEGER REFERENCES admin_users(id),
      processed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS airtime_sale_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      payout_phone TEXT NOT NULL,
      network TEXT NOT NULL,
      airtime_amount NUMERIC(12,2) NOT NULL,
      payout_amount NUMERIC(12,2) NOT NULL,
      merchant_number TEXT NOT NULL,
      reference TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      processed_by INTEGER REFERENCES admin_users(id),
      processed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      phone TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT DEFAULT 'Mobile Money',
      network TEXT DEFAULT 'MTN',
      status TEXT DEFAULT 'pending',
      tx_hash TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS bridge_devices (
      id SERIAL PRIMARY KEY,
      device_id TEXT UNIQUE,
      network TEXT,
      phone TEXT,
      status TEXT DEFAULT 'online',
      sim_balance NUMERIC(12,2) DEFAULT 150000,
      ping_ms INTEGER DEFAULT 42,
      last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      device_secret TEXT,
      mtn_merchant_id TEXT,
      airtel_merchant_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS bridge_events (
      id SERIAL PRIMARY KEY,
      bridge_device_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      transaction_reference TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'UGX',
      provider_timestamp TIMESTAMP,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
      UNIQUE (bridge_device_id, provider, merchant_id, transaction_reference)
    )`,
    `CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      time_ago TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      assigned_admin_id INTEGER REFERENCES admin_users(id),
      name TEXT,
      phone TEXT,
      subject TEXT,
      channel TEXT DEFAULT 'ticket',
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'open',
      assigned_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      sender_id INTEGER,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      admin_id INTEGER REFERENCES admin_users(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT DEFAULT 'system',
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  ];

  for (const statement of requiredTables) {
    await pool.query(statement);
  }

  await pool.query('ALTER TABLE esim_packages ADD COLUMN IF NOT EXISTS progress_percent_per_hour NUMERIC(8,4) DEFAULT 0.42');
  await pool.query("ALTER TABLE esim_packages ADD COLUMN IF NOT EXISTS renewal_schedule TEXT DEFAULT '[]'");
  await pool.query('ALTER TABLE user_esims ADD COLUMN IF NOT EXISTS progress_percent_per_hour NUMERIC(8,4) DEFAULT 0.42');
  await pool.query('ALTER TABLE user_esims ADD COLUMN IF NOT EXISTS renewal_count INTEGER DEFAULT 0');
  await pool.query('ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS reference TEXT');
  await pool.query('ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(12,2)');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS provider TEXT');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS merchant_id TEXT');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS app_version TEXT');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS credential_hash TEXT');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS device_secret TEXT');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS last_sync TIMESTAMP');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS mtn_merchant_id TEXT');
  await pool.query('ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS airtel_merchant_id TEXT');

  await pool.query('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS profit_total NUMERIC(12,2) DEFAULT 0');
  await pool.query('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS joined_users_count INTEGER DEFAULT 0');
  await pool.query('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS profile_photo TEXT');
  await pool.query('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS can_manage_withdrawal_fee BOOLEAN DEFAULT FALSE');
  await pool.query('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS current_session_token TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS current_session_token TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE esim_packages ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) DEFAULT 10');
  await pool.query('ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_admin_id INTEGER REFERENCES admin_users(id)');
  await pool.query("ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'ticket'");
  await pool.query('ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP');
  const bridgeDevices = await pool.query('SELECT id, device_secret FROM bridge_devices WHERE device_secret IS NULL OR device_secret = \'\' OR device_secret NOT LIKE \'v1:%\'');
  for (const device of bridgeDevices.rows) {
    const deviceSecret = device.device_secret || crypto.randomBytes(16).toString('hex');
    await pool.query('UPDATE bridge_devices SET device_secret = $1, credential_hash = $2 WHERE id = $3', [encryptBridgeSecret(deviceSecret), hashBridgeSecret(deviceSecret), device.id]);
  }
  await pool.query('ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS processed_by INTEGER REFERENCES admin_users(id)');
  await pool.query('ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP');
  await pool.query('ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS package_id TEXT');
  await pool.query('ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS target_esim_id INTEGER');
  await pool.query("ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'PAYMENT_AWAITING_VERIFICATION'");
  await pool.query("ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS order_status TEXT DEFAULT 'NOT_APPLICABLE'");
  await pool.query("ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS provisioning_status TEXT DEFAULT 'NOT_APPLICABLE'");
  await pool.query(`
    DELETE FROM user_esims older
    USING user_esims newer
    WHERE older.iccid IS NOT NULL
      AND older.iccid = newer.iccid
      AND older.id < newer.id
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS user_esims_iccid_unique ON user_esims (iccid) WHERE iccid IS NOT NULL');
  await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES admin_users(id)');
  await pool.query('ALTER TABLE notifications ALTER COLUMN user_id DROP NOT NULL').catch(() => {});

  const usersWithoutReferral = await pool.query("SELECT id FROM users WHERE referral_code IS NULL OR referral_code = '' ORDER BY id");
  for (const user of usersWithoutReferral.rows) {
    let code;
    do {
      code = `VSIM${Math.floor(100000 + Math.random() * 900000)}`;
      const exists = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
      if (!exists.rows.length) break;
    } while (true);
    await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, user.id]);
  }

  const adminCount = await pool.query('SELECT COUNT(*) AS total FROM admin_users');
  if (Number(adminCount.rows[0]?.total || 0) === 0) {
    const bcrypt = await import('bcryptjs');
    const adminHash = await bcrypt.default.hash('admin123', 10);
    await pool.query(
      'INSERT INTO admin_users (email, password_hash, name, role, status) VALUES ($1, $2, $3, $4, $5)',
      ['admin@vsim.com', adminHash, 'Super Admin', 'super_admin', 'active']
    );
  }

  const merchantCount = await pool.query('SELECT COUNT(*) AS total FROM merchants');
  if (Number(merchantCount.rows[0]?.total || 0) === 0) {
    await pool.query(
      `INSERT INTO merchants (name, merchant_code, network, account_name, phone, instructions, priority, status)
       VALUES 
       ($1, $2, $3, $4, $5, $6, $7, $8),
       ($9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        'VSIM MTN Merchant Line 1', '552109', 'MTN', 'VSIM TELECOM SERVICES UG', '+256 784 567 890', 'Dial *165*3# -> Select Enter Merchant Code -> Enter 552109 -> Enter Amount -> Enter Reference -> Confirm with PIN', 1, 'active',
        'VSIM Airtel Pay Digital 1', '771024', 'AIRTEL', 'VSIM CONNECT AIRTEL UG', '+256 702 345 678', 'Dial *185*9# -> Select Pay Merchant -> Enter Merchant ID 771024 -> Enter Amount -> Enter Reference -> Confirm with PIN', 2, 'active'
      ]
    );
  }

  for (const [network, name, code, accountName, phone, instructions, priority] of [
    ['MTN', 'VSIM MTN Merchant Line 1', '552109', 'VSIM TELECOM SERVICES UG', '+256 784 567 890', 'Dial *165*3# -> Enter Merchant Code 552109 -> Enter Amount -> Enter Reference -> Confirm PIN', 1],
    ['AIRTEL', 'VSIM Airtel Pay Digital 1', '771024', 'VSIM CONNECT AIRTEL UG', '+256 702 345 678', 'Dial *185*9# -> Enter Merchant ID 771024 -> Enter Amount -> Enter Reference -> Confirm PIN', 2]
  ]) {
    const activeNetwork = await pool.query('SELECT id FROM merchants WHERE UPPER(network) = $1 AND status = \'active\' LIMIT 1', [network]);
    if (!activeNetwork.rows.length) {
      await pool.query(
        `INSERT INTO merchants (name, merchant_code, network, account_name, phone, instructions, priority, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
        [name, code, network, accountName, phone, instructions, priority]
      );
    }
  }

  const pkgCount = await pool.query('SELECT COUNT(*) AS total FROM esim_packages');
  if (Number(pkgCount.rows[0]?.total || 0) <= 1) {
    const defaultPackages = [
      ['pkg_ug_5gb', 'Uganda', 'Uganda 5GB Express', '30 Days', '5 GB', 'Data Only', 15000, 900, 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=400&auto=format&fit=crop&q=80', 'africa'],
      ['pkg_af_10gb', 'Africa Regional', 'Africa 10GB Explorer', '30 Days', '10 GB', 'Data Only', 25000, 1500, 'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?w=400&auto=format&fit=crop&q=80', 'africa'],
      ['pkg_eu_10gb', 'Europe', 'Europe 10GB Pass', '30 Days', '10 GB', 'Data Only', 35000, 2200, 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=400&auto=format&fit=crop&q=80', 'europe'],
      ['pkg_as_20gb', 'Asia', 'Asia 20GB Connect', '30 Days', '20 GB', 'Data Only', 50000, 3400, 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=400&auto=format&fit=crop&q=80', 'asia'],
      ['pkg_am_20gb', 'Americas', 'Americas 20GB Passport', '30 Days', '20 GB', 'Data Only', 55000, 3800, 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=400&auto=format&fit=crop&q=80', 'americas'],
      ['pkg_gl_50gb', 'Global', 'Global 50GB Ultimate', '30 Days', '50 GB', 'Data Only', 90000, 6500, 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400&auto=format&fit=crop&q=80', 'global']
    ];

    for (const p of defaultPackages) {
      await pool.query(
        `INSERT INTO esim_packages (id, country, title, validity, data_quota, type, price, income, image_url, region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, price = EXCLUDED.price, income = EXCLUDED.income`,
        p
      );
    }
  }
}

const databaseDriver = String(process.env.DB_DRIVER || (process.env.DB_HOST ? 'postgres' : 'sqlite')).toLowerCase();
if (!['postgres', 'sqlite'].includes(databaseDriver)) {
  throw new Error('DB_DRIVER must be either postgres or sqlite');
}
if (databaseDriver === 'sqlite' && process.env.NODE_ENV === 'production' && process.env.ALLOW_SQLITE_PRODUCTION !== 'true') {
  throw new Error('SQLite is disabled in production. Set ALLOW_SQLITE_PRODUCTION=true only for an explicitly approved emergency fallback.');
} else if (databaseDriver === 'sqlite' && process.env.NODE_ENV === 'production') {
  console.warn('⚠️ WARNING: Using SQLite in production! Ensure your database directory is secure and properly backed up.');
}
if (databaseDriver === 'postgres' && !process.env.DB_HOST) {
  throw new Error('DB_HOST is required when DB_DRIVER=postgres');
}

if (databaseDriver === 'postgres') {
  if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD must be set in production');
  }

  // PostgreSQL Pool Connection
  pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'vsim_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: Number(process.env.DB_POOL_MAX || 20),
    min: Number(process.env.DB_POOL_MIN || 2),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECT_MS || 5000)
  });

  // Initialize schema asynchronously (non-blocking startup)
  initializePostgresSchema().catch(err => {
    console.error('[DB] Schema initialization failed (will retry on first query):', err.message);
  });

  queryFn = async (text, params = []) => {
    let sql = text.trim();
    if (sql.toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
      sql += ' RETURNING *';
    }
    const res = await pool.query(sql, params);
    if (!sql.toUpperCase().startsWith('SELECT')) emitDataChanged('database');
    return { rows: res.rows };
  };
} else {
  const configuredSqlitePath = process.env.SQLITE_PATH;
  const dbPath = configuredSqlitePath
    ? path.resolve(configuredSqlitePath)
    : path.join(__dirname, '../database/vsim_local.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  // Initialize SQLite Tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      initials TEXT,
      kyc_tier TEXT DEFAULT 'Tier 0 Unverified',
      wallet_balance REAL DEFAULT 0.0,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by TEXT,
      profile_photo TEXT,
      current_session_token TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'super_admin',
      status TEXT DEFAULT 'active',
      current_session_token TEXT,
      profile_photo TEXT,
      profit_total REAL DEFAULT 0,
      joined_users_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      transports TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS passkey_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      phone TEXT,
      challenge TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS esim_packages (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      title TEXT NOT NULL,
      validity TEXT NOT NULL,
      data_quota TEXT NOT NULL,
      type TEXT DEFAULT 'Data Only',
      price REAL NOT NULL,
      income REAL NOT NULL,
      commission_percent REAL DEFAULT 10,
      sold_count INTEGER DEFAULT 0,
      revenue REAL DEFAULT 0,
      image_url TEXT NOT NULL,
      region TEXT NOT NULL,
      renewal_schedule TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      merchant_code TEXT NOT NULL,
      network TEXT NOT NULL DEFAULT 'MTN',
      account_name TEXT,
      phone TEXT,
      instructions TEXT,
      status TEXT NOT NULL DEFAULT 'inactive',
      priority INTEGER NOT NULL DEFAULT 10,
      total_transactions INTEGER NOT NULL DEFAULT 0,
      total_volume REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_esims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      package_id TEXT NOT NULL,
      title TEXT NOT NULL,
      country TEXT NOT NULL,
      iccid TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      data_total TEXT NOT NULL,
      data_remaining TEXT NOT NULL,
      daily_income REAL NOT NULL,
      renewal_count INTEGER DEFAULT 0,
      activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
      nin TEXT,
      document_image TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      reference TEXT,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      phone TEXT NOT NULL,
      amount REAL NOT NULL,
      merchant TEXT DEFAULT 'VSIM-M001',
      network TEXT DEFAULT 'MTN',
      reference TEXT,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS airtime_purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      phone TEXT NOT NULL,
      network TEXT NOT NULL,
      airtime_amount REAL NOT NULL,
      payment_amount REAL NOT NULL,
      merchant_number TEXT NOT NULL,
      reference TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      processed_by INTEGER,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS airtime_sale_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      payout_phone TEXT NOT NULL,
      network TEXT NOT NULL,
      airtime_amount REAL NOT NULL,
      payout_amount REAL NOT NULL,
      merchant_number TEXT NOT NULL,
      reference TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      processed_by INTEGER,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      phone TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT DEFAULT 'Mobile Money',
      network TEXT DEFAULT 'MTN',
      status TEXT DEFAULT 'pending',
      tx_hash TEXT,
      processed_by INTEGER,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      plan_name TEXT NOT NULL,
      amount REAL NOT NULL,
      daily_return REAL NOT NULL,
      status TEXT DEFAULT 'active',
      progress INTEGER DEFAULT 45,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bridge_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      network TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT DEFAULT 'online',
      sim_balance REAL DEFAULT 150000.0,
      ping_ms INTEGER DEFAULT 42,
      last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
      device_secret TEXT,
      mtn_merchant_id TEXT,
      airtel_merchant_id TEXT
    );

    CREATE TABLE IF NOT EXISTS bridge_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bridge_device_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      transaction_reference TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'UGX',
      provider_timestamp DATETIME,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
      UNIQUE (bridge_device_id, provider, merchant_id, transaction_reference)
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      time_ago TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      assigned_admin_id INTEGER,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      subject TEXT NOT NULL,
      channel TEXT DEFAULT 'ticket',
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'open',
      assigned_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

      CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        sender_type TEXT NOT NULL,
        sender_id INTEGER,
        body TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
      );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT DEFAULT 'system',
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  try { sqlite.exec('ALTER TABLE users ADD COLUMN profile_photo TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE users ADD COLUMN current_session_token TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE esim_packages ADD COLUMN commission_percent REAL DEFAULT 10'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
    try { sqlite.exec('ALTER TABLE support_tickets ADD COLUMN assigned_admin_id INTEGER'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
    try { sqlite.exec("ALTER TABLE support_tickets ADD COLUMN channel TEXT DEFAULT 'ticket'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
    try { sqlite.exec('ALTER TABLE support_tickets ADD COLUMN assigned_at DATETIME'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE admin_users ADD COLUMN profile_photo TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE admin_users ADD COLUMN profit_total REAL DEFAULT 0'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE admin_users ADD COLUMN joined_users_count INTEGER DEFAULT 0'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE admin_users ADD COLUMN current_session_token TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE esim_packages ADD COLUMN progress_percent_per_hour REAL DEFAULT 0.42'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec("ALTER TABLE esim_packages ADD COLUMN renewal_schedule TEXT DEFAULT '[]'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE user_esims ADD COLUMN progress_percent_per_hour REAL DEFAULT 0.42'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE user_esims ADD COLUMN renewal_count INTEGER DEFAULT 0'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE payment_requests ADD COLUMN package_id TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE payment_requests ADD COLUMN target_esim_id INTEGER'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec("ALTER TABLE payment_requests ADD COLUMN payment_status TEXT DEFAULT 'PAYMENT_AWAITING_VERIFICATION'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec("ALTER TABLE payment_requests ADD COLUMN order_status TEXT DEFAULT 'NOT_APPLICABLE'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec("ALTER TABLE payment_requests ADD COLUMN provisioning_status TEXT DEFAULT 'NOT_APPLICABLE'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE notifications ADD COLUMN admin_id INTEGER'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  sqlite.exec(`
    DELETE FROM user_esims
    WHERE iccid IS NOT NULL
      AND rowid NOT IN (SELECT MAX(rowid) FROM user_esims WHERE iccid IS NOT NULL GROUP BY iccid)
  `);
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_esims_iccid_unique ON user_esims (iccid) WHERE iccid IS NOT NULL');
  try { sqlite.exec('ALTER TABLE withdrawals ADD COLUMN reference TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE withdrawals ADD COLUMN processed_by INTEGER'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  try { sqlite.exec('ALTER TABLE withdrawals ADD COLUMN processed_at DATETIME'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  for (const column of ['provider TEXT', 'merchant_id TEXT', 'app_version TEXT', 'credential_hash TEXT', 'device_secret TEXT', 'revoked_at DATETIME', 'last_sync DATETIME']) {
    try { sqlite.exec(`ALTER TABLE bridge_devices ADD COLUMN ${column}`); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  }
  for (const column of ['mtn_merchant_id TEXT', 'airtel_merchant_id TEXT']) {
    try { sqlite.exec(`ALTER TABLE bridge_devices ADD COLUMN ${column}`); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  }
  const bridgeDevices = sqlite.prepare('SELECT id, device_secret FROM bridge_devices WHERE device_secret IS NULL OR device_secret = \'\' OR device_secret NOT LIKE \'v1:%\'').all();
  const updateBridgeSecret = sqlite.prepare('UPDATE bridge_devices SET device_secret = ?, credential_hash = ? WHERE id = ?');
  for (const device of bridgeDevices) {
    const deviceSecret = device.device_secret || crypto.randomBytes(16).toString('hex');
    updateBridgeSecret.run(encryptBridgeSecret(deviceSecret), hashBridgeSecret(deviceSecret), device.id);
  }

  const usersWithoutReferral = sqlite.prepare("SELECT id FROM users WHERE referral_code IS NULL OR referral_code = '' ORDER BY id").all();
  const referralCodeExists = sqlite.prepare('SELECT 1 FROM users WHERE referral_code = ?');
  const assignReferralCode = sqlite.prepare('UPDATE users SET referral_code = ? WHERE id = ?');
  for (const user of usersWithoutReferral) {
    let code;
    do {
      code = `VSIM${Math.floor(100000 + Math.random() * 900000)}`;
      if (!referralCodeExists.get(code)) break;
    } while (true);
    assignReferralCode.run(code, user.id);
  }

  // Seed default active merchants in SQLite if table is empty
  try {
    const merchantCountRow = sqlite.prepare('SELECT COUNT(*) AS total FROM merchants').get();
    if (!merchantCountRow || merchantCountRow.total === 0) {
      const insertMerchant = sqlite.prepare(`
        INSERT INTO merchants (name, merchant_code, network, account_name, phone, instructions, priority, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertMerchant.run(
        'VSIM MTN Merchant Line 1', '552109', 'MTN', 'VSIM TELECOM SERVICES UG', '+256 784 567 890',
        'Dial *165*3# -> Select Enter Merchant Code -> Enter 552109 -> Enter Amount -> Enter Reference -> Confirm with PIN', 1, 'active'
      );
      insertMerchant.run(
        'VSIM Airtel Pay Digital 1', '771024', 'AIRTEL', 'VSIM CONNECT AIRTEL UG', '+256 702 345 678',
        'Dial *185*9# -> Select Pay Merchant -> Enter Merchant ID 771024 -> Enter Amount -> Enter Reference -> Confirm with PIN', 2, 'active'
      );
    }
  } catch (seedErr) {
    console.error('Error seeding merchants in SQLite:', seedErr);
  }

  queryFn = async (text, params = []) => {
    let sql = text.trim();
    
    // Adapt Postgres $1, $2 query syntax to SQLite ? syntax
    sql = sql.replace(/\$(\d+)/g, '?');

    if (sql.toUpperCase().startsWith('SELECT') || sql.toUpperCase().includes('RETURNING')) {
      const rows = sqlite.prepare(sql).all(...params);
      return { rows };
    } else {
      const info = sqlite.prepare(sql).run(...params);
      emitDataChanged('database');
      return { rows: [{ id: info.lastInsertRowid, changes: info.changes }] };
    }
  };
}

export const query = queryFn;

export async function closeDatabase() {
  if (pool) {
    await pool.end();
  }
}

