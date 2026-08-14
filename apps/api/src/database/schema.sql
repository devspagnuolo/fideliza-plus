PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, segment TEXT, points_per_real REAL NOT NULL DEFAULT 1,
  points_validity_days INTEGER NOT NULL DEFAULT 365,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','manager','operator')), active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, email TEXT, phone TEXT,
  birth_date TEXT, tags TEXT NOT NULL DEFAULT '[]', points_balance INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, email)
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT REFERENCES customers(id), external_id TEXT,
  total_cents INTEGER NOT NULL CHECK(total_cents >= 0), occurred_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual',
  reversed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, external_id)
);
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id), sale_id TEXT REFERENCES sales(id),
  points INTEGER NOT NULL, reason TEXT NOT NULL, entry_type TEXT NOT NULL DEFAULT 'adjustment', expires_at TEXT, expired_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, audience_rule TEXT NOT NULL DEFAULT '{}',
  channel TEXT NOT NULL DEFAULT 'whatsapp', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS loyalty_promotions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  multiplier REAL NOT NULL CHECK(multiplier > 1 AND multiplier <= 10), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_consents (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, granted INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_customer ON loyalty_ledger(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant_period ON loyalty_promotions(tenant_id, active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_date ON audit_logs(tenant_id, created_at);
