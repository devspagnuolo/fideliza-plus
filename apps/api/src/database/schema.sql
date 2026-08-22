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
  two_factor_secret_encrypted TEXT, two_factor_enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL DEFAULT '["customers:read","sales:read"]', active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT, expires_at TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, email TEXT, phone TEXT,
  external_id TEXT, birth_date TEXT, tags TEXT NOT NULL DEFAULT '[]', points_balance INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT,
  points_cost INTEGER NOT NULL CHECK(points_cost>0), stock INTEGER CHECK(stock IS NULL OR stock>=0), active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), reward_id TEXT NOT NULL REFERENCES rewards(id),
  customer_id TEXT NOT NULL REFERENCES customers(id), points_spent INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
  redeemed_by TEXT REFERENCES users(id), redemption_code TEXT, code_generated_at TEXT, used_at TEXT,
  used_by TEXT REFERENCES users(id), order_number TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, audience_rule TEXT NOT NULL DEFAULT '{}',
  channel TEXT NOT NULL DEFAULT 'whatsapp', subject TEXT, message TEXT, template_name TEXT,
  variant_a_message TEXT, variant_b_message TEXT, attribution_window_days INTEGER NOT NULL DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  customer_id TEXT NOT NULL REFERENCES customers(id), channel TEXT NOT NULL, recipient TEXT NOT NULL, provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','sent','failed','simulated')),
  variant TEXT NOT NULL DEFAULT 'A', external_id TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TEXT,
  UNIQUE(campaign_id,customer_id)
);
CREATE TABLE IF NOT EXISTS campaign_attributions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  delivery_id TEXT NOT NULL REFERENCES campaign_deliveries(id), sale_id TEXT NOT NULL REFERENCES sales(id), variant TEXT NOT NULL,
  revenue_cents INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,sale_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed')),
  payload TEXT, result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TEXT, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS integration_connections (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), provider TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL, refresh_token_encrypted TEXT NOT NULL, expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected', last_sync_at TEXT, sync_cursor TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  external_company_id TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,provider)
);
CREATE TABLE IF NOT EXISTS integration_webhook_events (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, external_event_id TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'accepted',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider,external_event_id)
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS loyalty_promotions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  multiplier REAL NOT NULL CHECK(multiplier > 1 AND multiplier <= 10), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS gie_recommendations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), recommendation_key TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL, explanation TEXT NOT NULL, priority INTEGER NOT NULL,
  metric_name TEXT NOT NULL, baseline_value REAL NOT NULL DEFAULT 0, current_value REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','dismissed','completed')),
  accepted_at TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id,recommendation_key)
);
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_consents (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, granted INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'manual',
  document_version TEXT, privacy_version TEXT, ip_address TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_reset_tokens(user_id,expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id,active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_external ON customers(tenant_id,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_customer ON loyalty_ledger(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_rewards_tenant_active ON rewards(tenant_id,active);
CREATE INDEX IF NOT EXISTS idx_redemptions_tenant_customer ON reward_redemptions(tenant_id,customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant_period ON loyalty_promotions(tenant_id, active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_gie_tenant_status ON gie_recommendations(tenant_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant_status ON campaign_deliveries(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_attributions_campaign ON campaign_attributions(tenant_id,campaign_id,variant);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON jobs(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_connections_tenant ON integration_connections(tenant_id, provider);
CREATE INDEX IF NOT EXISTS idx_webhooks_tenant_date ON integration_webhook_events(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_date ON audit_logs(tenant_id, created_at);
