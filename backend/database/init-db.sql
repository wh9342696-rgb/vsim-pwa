CREATE TABLE IF NOT EXISTS users (
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
);

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'super_admin',
  status TEXT DEFAULT 'active',
  current_session_token TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS esim_packages (
  id TEXT PRIMARY KEY,
  country TEXT,
  title TEXT NOT NULL,
  validity TEXT,
  data_quota TEXT,
  type TEXT DEFAULT 'Data Only',
  price NUMERIC(12,2) NOT NULL,
  income NUMERIC(12,2) NOT NULL,
  sold_count INTEGER DEFAULT 0,
  revenue NUMERIC(12,2) DEFAULT 0,
  image_url TEXT,
  region TEXT,
  renewal_schedule TEXT DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS merchants (
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
);

CREATE TABLE IF NOT EXISTS user_esims (
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
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reference TEXT,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  admin_id INTEGER REFERENCES admin_users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT DEFAULT 'system',
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_esims_iccid_unique ON user_esims (iccid) WHERE iccid IS NOT NULL;
