import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';

const sql = fs.readFileSync(path.resolve(process.cwd(), 'src/database/schema.sql'), 'utf8');
db.exec(sql);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('tenants', 'points_validity_days', 'INTEGER NOT NULL DEFAULT 365');
ensureColumn('sales', 'reversed_at', 'TEXT');
ensureColumn('sales', 'order_number', 'TEXT');
ensureColumn('customers', 'external_id', 'TEXT');
ensureColumn('integration_connections', 'external_company_id', 'TEXT');
ensureColumn('users', 'two_factor_secret_encrypted', 'TEXT');
ensureColumn('users', 'two_factor_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'cpf', 'TEXT');
ensureColumn('users', 'phone', 'TEXT');
ensureColumn('users', 'job_title', 'TEXT');
ensureColumn('users', 'last_login_at', 'TEXT');
ensureColumn('users', 'avatar_data', 'TEXT');
ensureColumn('tenants', 'legal_name', 'TEXT');
ensureColumn('tenants', 'cnpj', 'TEXT');
ensureColumn('tenants', 'email', 'TEXT');
ensureColumn('tenants', 'phone', 'TEXT');
ensureColumn('tenants', 'website', 'TEXT');
ensureColumn('tenants', 'address', 'TEXT');
ensureColumn('tenants', 'city', 'TEXT');
ensureColumn('tenants', 'state', 'TEXT');
ensureColumn('tenants', 'postal_code', 'TEXT');
ensureColumn('tenants', 'logo_data', 'TEXT');
ensureColumn('customers', 'cpf', 'TEXT');
ensureColumn('customers', 'address', 'TEXT');
ensureColumn('customers', 'city', 'TEXT');
ensureColumn('customers', 'state', 'TEXT');
ensureColumn('customers', 'postal_code', 'TEXT');
ensureColumn('customers', 'notes', 'TEXT');
ensureColumn('customers', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('customers', 'updated_at', 'TEXT');
ensureColumn('customers', 'enrolled_at', 'TEXT');
ensureColumn('customers', 'deleted_at', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_external ON customers(tenant_id,external_id) WHERE external_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_cpf ON users(tenant_id,cpf) WHERE cpf IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_cnpj ON tenants(cnpj) WHERE cnpj IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_cpf ON customers(tenant_id,cpf) WHERE cpf IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_tenant_visible ON customers(tenant_id,deleted_at,name)');
const blingReset='2026-08-14-reset-initial-bling-customers';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(blingReset)){
  db.transaction(()=>{
    db.prepare("DELETE FROM loyalty_ledger WHERE sale_id IN (SELECT id FROM sales WHERE source='bling')").run();
    db.prepare("UPDATE customers SET points_balance=0,deleted_at=CURRENT_TIMESTAMP,enrolled_at=NULL WHERE external_id LIKE 'bling:%'").run();
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(blingReset);
  })();
}
db.exec(`CREATE TABLE IF NOT EXISTS erp_connectors (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, provider TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK(connection_type IN ('api','webhook','csv','database')),
  base_url TEXT, credentials_encrypted TEXT, status TEXT NOT NULL DEFAULT 'draft', capabilities TEXT NOT NULL DEFAULT '["customers","sales"]',
  last_test_at TEXT, last_sync_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,name)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_erp_connectors_tenant ON erp_connectors(tenant_id,status)');
db.exec(`CREATE TABLE IF NOT EXISTS customer_accounts (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),customer_id TEXT NOT NULL REFERENCES customers(id),password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,last_login_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(tenant_id,customer_id));
CREATE TABLE IF NOT EXISTS customer_sessions (id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS platform_admins (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'super_admin',active INTEGER NOT NULL DEFAULT 1,last_login_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS platform_sessions (id TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id),plan_code TEXT NOT NULL DEFAULT 'pilot',status TEXT NOT NULL DEFAULT 'trialing',monthly_price_cents INTEGER NOT NULL DEFAULT 0,current_period_start TEXT,current_period_end TEXT,cancel_at_period_end INTEGER NOT NULL DEFAULT 0,external_customer_id TEXT,external_subscription_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_tenant ON customer_accounts(tenant_id,active);CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status,plan_code);`);
db.prepare("INSERT OR IGNORE INTO subscriptions (id,tenant_id,plan_code,status) SELECT 'sub-'||id,id,'pilot','trialing' FROM tenants").run();
ensureColumn('loyalty_ledger', 'entry_type', "TEXT NOT NULL DEFAULT 'adjustment'");
ensureColumn('loyalty_ledger', 'expires_at', 'TEXT');
ensureColumn('loyalty_ledger', 'expired_at', 'TEXT');
ensureColumn('campaigns', 'subject', 'TEXT');
ensureColumn('campaigns', 'message', 'TEXT');
ensureColumn('campaigns', 'template_name', 'TEXT');
ensureColumn('campaigns', 'variant_a_message', 'TEXT');
ensureColumn('campaigns', 'variant_b_message', 'TEXT');
ensureColumn('campaigns', 'attribution_window_days', 'INTEGER NOT NULL DEFAULT 7');
ensureColumn('campaign_deliveries', 'variant', "TEXT NOT NULL DEFAULT 'A'");
console.log('Banco atualizado com sucesso.');
