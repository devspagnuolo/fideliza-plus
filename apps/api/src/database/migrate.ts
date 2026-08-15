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
ensureColumn('tenants', 'responsible_name', 'TEXT');
ensureColumn('tenants', 'login_blocked', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('subscriptions', 'joined_at', 'TEXT');
ensureColumn('users', 'mfa_required', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS platform_plans (
  code TEXT PRIMARY KEY,name TEXT NOT NULL,monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  user_limit INTEGER NOT NULL DEFAULT 1,consumer_limit INTEGER NOT NULL DEFAULT 100,
  storage_mb INTEGER NOT NULL DEFAULT 100,features TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),subscription_id TEXT REFERENCES subscriptions(id),
  amount_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',due_at TEXT NOT NULL,paid_at TEXT,
  external_id TEXT,description TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id TEXT PRIMARY KEY,admin_id TEXT REFERENCES platform_admins(id),action TEXT NOT NULL,entity_type TEXT NOT NULL,
  entity_id TEXT,ip TEXT,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platform_login_attempts (
  id TEXT PRIMARY KEY,email TEXT NOT NULL,success INTEGER NOT NULL,ip TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),subject TEXT NOT NULL,description TEXT,
  status TEXT NOT NULL DEFAULT 'open',priority TEXT NOT NULL DEFAULT 'medium',sla_due_at TEXT,assigned_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_incidents (
  id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT,severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,created_by TEXT REFERENCES platform_admins(id)
);
CREATE TABLE IF NOT EXISTS global_settings (
  key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_by TEXT REFERENCES platform_admins(id),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status,due_at);
CREATE INDEX IF NOT EXISTS idx_platform_audit_date ON platform_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status,priority);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON platform_incidents(status,severity);`);
const defaultPlans=[
  ['pilot','Piloto',0,2,1000,250,'["crm","loyalty","dashboard","bling"]'],
  ['essential','Essencial',9900,5,5000,1024,'["crm","loyalty","dashboard","campaigns","integrations"]'],
  ['growth','Crescimento',19900,15,25000,5120,'["crm","loyalty","gie","campaigns","integrations","api"]'],
  ['professional','Profissional',39900,50,100000,20480,'["all","priority_support","advanced_reports"]']
];
const insertPlan=db.prepare('INSERT OR IGNORE INTO platform_plans (code,name,monthly_price_cents,user_limit,consumer_limit,storage_mb,features) VALUES (?,?,?,?,?,?,?)');
db.transaction(()=>defaultPlans.forEach(plan=>insertPlan.run(...plan)))();
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
db.exec(`CREATE TABLE IF NOT EXISTS customer_notifications (
  id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,message TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'info',action_url TEXT,read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_support_requests (
  id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,message TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'other',status TEXT NOT NULL DEFAULT 'open',
  response TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_notifications ON customer_notifications(tenant_id,customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_customer_support ON customer_support_requests(tenant_id,customer_id,created_at);`);
console.log('Banco atualizado com sucesso.');
