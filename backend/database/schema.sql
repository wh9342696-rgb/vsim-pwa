-- ============================================================================
-- VSIM Database Schema - Withdrawal & Payment Tracking Tables
-- ============================================================================

-- Table for withdrawal requests (user submits to app, admin processes)
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  momo_number TEXT NOT NULL,
  amount REAL NOT NULL,
  fee REAL DEFAULT 2000,
  net_amount REAL NOT NULL,
  network TEXT DEFAULT 'MTN',
  reference TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, approved, rejected, completed
  processed_by INTEGER,
  processed_at DATETIME,
  rejected_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (processed_by) REFERENCES admin_users(id)
);

-- Table for payment requests (mobile money purchases & top-ups)
CREATE TABLE IF NOT EXISTS payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  phone TEXT,
  amount REAL NOT NULL,
  type TEXT, -- topup, esim_purchase, airtime_buy
  method TEXT, -- momo, wallet, card
  merchant TEXT,
  network TEXT,
  reference TEXT UNIQUE NOT NULL,
  related_id INTEGER,
  status TEXT DEFAULT 'pending', -- pending, completed, failed, cancelled
  verified_by INTEGER,
  verified_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (verified_by) REFERENCES admin_users(id)
);

-- Table for admin notifications (withdrawal, payment alerts)
CREATE TABLE IF NOT EXISTS admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  type TEXT, -- withdrawal, payment, purchase, refund
  title TEXT NOT NULL,
  message TEXT,
  reference TEXT,
  related_id INTEGER,
  status TEXT DEFAULT 'pending', -- pending, read, actioned
  action_taken TEXT,
  acted_on_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- Table for system logs (audit trail)
CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  details TEXT,
  level TEXT DEFAULT 'info', -- info, warning, error, success
  user_id INTEGER,
  admin_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_withdrawal_user ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_reference ON withdrawal_requests(reference);

CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_reference ON payment_requests(reference);

CREATE INDEX IF NOT EXISTS idx_admin_notif_admin ON admin_notifications(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_notif_status ON admin_notifications(status);
CREATE INDEX IF NOT EXISTS idx_admin_notif_type ON admin_notifications(type);

CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
