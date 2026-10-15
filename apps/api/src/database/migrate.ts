import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { PLAN_CATALOG } from '../plan-catalog.js';
import { decryptSecret,encryptSecret } from '../bling.js';
import { decryptTotp,encryptTotp } from '../two-factor.js';
import { isCurrentDataCipher } from '../data-encryption.js';

const sql = fs.readFileSync(path.resolve(process.cwd(), 'src/database/schema.sql'), 'utf8');
db.exec(sql);
db.exec(`CREATE TABLE IF NOT EXISTS api_key_rate_limits(
 api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,window_start INTEGER NOT NULL,request_count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(api_key_id,window_start)
);
CREATE INDEX IF NOT EXISTS idx_api_key_rate_limits_window ON api_key_rate_limits(window_start);`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('tenants', 'points_validity_days', 'INTEGER NOT NULL DEFAULT 365');
ensureColumn('sales', 'reversed_at', 'TEXT');
ensureColumn('sales', 'order_number', 'TEXT');
ensureColumn('sales', 'external_status', 'TEXT');
ensureColumn('sales', 'external_updated_at', 'TEXT');
ensureColumn('sales', 'reversal_source', 'TEXT');
db.prepare("UPDATE sales SET reversal_source='manual' WHERE reversed_at IS NOT NULL AND reversal_source IS NULL").run();
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_tenant_external_status ON sales(tenant_id,source,external_status,reversed_at)');
ensureColumn('customers', 'external_id', 'TEXT');
ensureColumn('integration_connections', 'external_company_id', 'TEXT');
ensureColumn('users', 'two_factor_secret_encrypted', 'TEXT');
ensureColumn('users', 'two_factor_pending_secret_encrypted', 'TEXT');
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
ensureColumn('tenants', 'address_number', 'TEXT');
ensureColumn('tenants', 'address_complement', 'TEXT');
ensureColumn('tenants', 'district', 'TEXT');
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
ensureColumn('customer_consents', 'document_version', 'TEXT');
ensureColumn('customer_consents', 'privacy_version', 'TEXT');
ensureColumn('customer_consents', 'ip_address', 'TEXT');
ensureColumn('customer_consents', 'user_agent', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_external ON customers(tenant_id,external_id) WHERE external_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_cpf ON users(tenant_id,cpf) WHERE cpf IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_cnpj ON tenants(cnpj) WHERE cnpj IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_cpf ON customers(tenant_id,cpf) WHERE cpf IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_tenant_visible ON customers(tenant_id,deleted_at,name)');
const blingReset='2026-08-14-reset-initial-bling-customers';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(blingReset)){
  const existingBlingData=(db.prepare("SELECT (SELECT COUNT(*) FROM sales WHERE source='bling')+(SELECT COUNT(*) FROM customers WHERE external_id LIKE 'bling:%') total").get() as {total:number}).total;
  if(existingBlingData)console.warn('Migração histórica de limpeza Bling ignorada para preservar dados existentes.');
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(blingReset);
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
CREATE TABLE IF NOT EXISTS customer_password_reset_tokens (id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS platform_admins (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'super_admin',active INTEGER NOT NULL DEFAULT 1,last_login_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS platform_sessions (id TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id),plan_code TEXT NOT NULL DEFAULT 'pilot',status TEXT NOT NULL DEFAULT 'trialing',monthly_price_cents INTEGER NOT NULL DEFAULT 0,current_period_start TEXT,current_period_end TEXT,cancel_at_period_end INTEGER NOT NULL DEFAULT 0,external_customer_id TEXT,external_subscription_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_tenant ON customer_accounts(tenant_id,active);CREATE INDEX IF NOT EXISTS idx_customer_password_resets ON customer_password_reset_tokens(account_id,expires_at);CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status,plan_code);`);
ensureColumn('platform_admins','two_factor_secret_encrypted','TEXT');
ensureColumn('platform_admins','two_factor_pending_secret_encrypted','TEXT');
ensureColumn('platform_admins','two_factor_enabled','INTEGER NOT NULL DEFAULT 0');
ensureColumn('customer_accounts','must_change_password','INTEGER NOT NULL DEFAULT 0');
ensureColumn('customer_accounts','temporary_password_expires_at','TEXT');
for (const table of ['sessions','customer_sessions','platform_sessions']) {
  ensureColumn(table,'ip_address','TEXT');
  ensureColumn(table,'user_agent','TEXT');
  ensureColumn(table,'last_seen_at','TEXT');
}
db.exec(`CREATE TABLE IF NOT EXISTS security_events(
 id TEXT PRIMARY KEY,event_type TEXT NOT NULL,severity TEXT NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
 user_type TEXT,identity TEXT,tenant_id TEXT,ip TEXT,user_agent TEXT,reason TEXT,metadata TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','contained','resolved','false_positive')),
 occurrence_count INTEGER NOT NULL DEFAULT 1,first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_events_status ON security_events(status,severity,last_seen_at);
CREATE INDEX IF NOT EXISTS idx_security_events_identity ON security_events(user_type,identity,last_seen_at);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip,last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_expiry ON platform_sessions(expires_at);`);
db.prepare("INSERT OR IGNORE INTO subscriptions (id,tenant_id,plan_code,status) SELECT 'sub-'||id,id,'pilot','trialing' FROM tenants").run();
ensureColumn('tenants', 'responsible_name', 'TEXT');
ensureColumn('tenants', 'login_blocked', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tenants', 'customer_portal_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('subscriptions', 'joined_at', 'TEXT');
ensureColumn('subscriptions', 'payment_method', "TEXT NOT NULL DEFAULT 'boleto'");
ensureColumn('subscriptions', 'billing_day', 'INTEGER NOT NULL DEFAULT 10');
ensureColumn('subscriptions', 'gateway', 'TEXT');
ensureColumn('subscriptions', 'billing_consent_at', 'TEXT');
ensureColumn('subscriptions', 'billing_setup_status', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('subscriptions', 'billing_setup_error', 'TEXT');
ensureColumn('subscriptions', 'billing_setup_token_hash', 'TEXT');
ensureColumn('subscriptions', 'external_checkout_id', 'TEXT');
ensureColumn('subscriptions', 'checkout_url', 'TEXT');
ensureColumn('subscriptions', 'asaas_environment', 'TEXT');
ensureColumn('users', 'mfa_required', 'INTEGER NOT NULL DEFAULT 0');
const customerPortalRollout='2026-08-20-enable-vivi-customer-portal';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(customerPortalRollout)){
  db.transaction(()=>{
    db.prepare("UPDATE tenants SET customer_portal_enabled=CASE WHEN slug='vivi-moda-plus-size' THEN 1 ELSE 0 END").run();
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(customerPortalRollout);
  })();
}
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
db.prepare("INSERT OR IGNORE INTO global_settings(key,value) VALUES('security.daily_redemption_limit','10')").run();
const defaultPlans=PLAN_CATALOG.map(plan=>[plan.code,plan.name,plan.monthlyPriceCents,plan.userLimit,plan.consumerLimit,plan.storageMb,JSON.stringify(plan.features)]);
const insertPlan=db.prepare('INSERT OR IGNORE INTO platform_plans (code,name,monthly_price_cents,user_limit,consumer_limit,storage_mb,features) VALUES (?,?,?,?,?,?,?)');
db.transaction(()=>defaultPlans.forEach(plan=>insertPlan.run(...plan)))();
const planRealityMigration='plan-reality-v1';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(planRealityMigration))db.transaction(()=>{const update=db.prepare('UPDATE platform_plans SET name=?,monthly_price_cents=?,user_limit=?,consumer_limit=?,storage_mb=?,features=?,active=1,updated_at=CURRENT_TIMESTAMP WHERE code=?');for(const plan of PLAN_CATALOG)update.run(plan.name,plan.monthlyPriceCents,plan.userLimit,plan.consumerLimit,plan.storageMb,JSON.stringify(plan.features),plan.code);db.prepare('INSERT INTO migrations(name)VALUES(?)').run(planRealityMigration)})();
db.exec(`CREATE TABLE IF NOT EXISTS public_trial_signups (
  id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),plan_code TEXT NOT NULL REFERENCES platform_plans(code),
  company_name TEXT NOT NULL,cnpj TEXT NOT NULL,email TEXT NOT NULL,responsible_name TEXT NOT NULL,phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'activated',source TEXT NOT NULL DEFAULT 'public_plans',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);CREATE INDEX IF NOT EXISTS idx_trial_signups_created ON public_trial_signups(created_at,status);
CREATE TABLE IF NOT EXISTS subscription_contract_acceptances (
  id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  contract_version TEXT NOT NULL,contract_hash TEXT NOT NULL,contract_snapshot TEXT NOT NULL,
  signer_name TEXT NOT NULL,signer_email TEXT NOT NULL,signer_document TEXT NOT NULL,
  plan_code TEXT NOT NULL,monthly_price_cents INTEGER NOT NULL,payment_method TEXT NOT NULL,
  minimum_term_consent INTEGER NOT NULL DEFAULT 1,billing_consent INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,user_agent TEXT,accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subscription_id,contract_version)
);CREATE INDEX IF NOT EXISTS idx_contract_acceptances_tenant ON subscription_contract_acceptances(tenant_id,accepted_at);
CREATE TRIGGER IF NOT EXISTS subscriptions_trial_7_days_insert AFTER INSERT ON subscriptions WHEN NEW.status='trialing' BEGIN UPDATE subscriptions SET current_period_start=CURRENT_TIMESTAMP,current_period_end=date('now','+7 days') WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS subscriptions_trial_7_days_update AFTER UPDATE OF status ON subscriptions WHEN NEW.status='trialing' AND OLD.status<>'trialing' BEGIN UPDATE subscriptions SET current_period_start=CURRENT_TIMESTAMP,current_period_end=date('now','+7 days') WHERE id=NEW.id; END;`);
ensureColumn('loyalty_ledger', 'entry_type', "TEXT NOT NULL DEFAULT 'adjustment'");
ensureColumn('loyalty_ledger', 'expires_at', 'TEXT');
ensureColumn('loyalty_ledger', 'expired_at', 'TEXT');
ensureColumn('reward_redemptions', 'redemption_code', 'TEXT');
ensureColumn('reward_redemptions', 'code_generated_at', 'TEXT');
ensureColumn('reward_redemptions', 'used_at', 'TEXT');
ensureColumn('reward_redemptions', 'used_by', 'TEXT REFERENCES users(id)');
ensureColumn('reward_redemptions', 'order_number', 'TEXT');
ensureColumn('reward_redemptions', 'expires_at', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_redemptions_code ON reward_redemptions(redemption_code) WHERE redemption_code IS NOT NULL');
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
ensureColumn('tenants','suspension_reason','TEXT');
ensureColumn('tenants','suspended_at','TEXT');
ensureColumn('users','blocked_reason','TEXT');
ensureColumn('users','blocked_at','TEXT');
ensureColumn('users','source','TEXT NOT NULL DEFAULT \'company\'');
ensureColumn('invoices','payment_method',"TEXT NOT NULL DEFAULT 'boleto'");
ensureColumn('invoices','boleto_url','TEXT');
ensureColumn('invoices','invoice_pdf_url','TEXT');
ensureColumn('invoices','notified_at','TEXT');
ensureColumn('invoices','payment_reference','TEXT');
ensureColumn('invoices','gateway',"TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('invoices','external_payment_id','TEXT');
ensureColumn('invoices','external_status','TEXT');
ensureColumn('invoices','invoice_url','TEXT');
ensureColumn('invoices','bank_slip_url','TEXT');
ensureColumn('invoices','pix_copy_paste','TEXT');
ensureColumn('invoices','last_synced_at','TEXT');
ensureColumn('invoices','asaas_environment','TEXT');
ensureColumn('subscriptions','payment_method',"TEXT NOT NULL DEFAULT 'boleto'");
ensureColumn('subscriptions','billing_day','INTEGER NOT NULL DEFAULT 10');
ensureColumn('subscriptions','gateway',"TEXT NOT NULL DEFAULT 'asaas'");
ensureColumn('integration_connections','last_error','TEXT');
ensureColumn('integration_webhook_events','processed_at','TEXT');
ensureColumn('integration_webhook_events','last_error','TEXT');
ensureColumn('integration_webhook_events','attempts','INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS idx_webhook_events_pending ON integration_webhook_events(tenant_id,provider,status,occurred_at)');
db.exec(`CREATE TABLE IF NOT EXISTS loyalty_tiers(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 name TEXT NOT NULL,rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 20),
 min_lifetime_points INTEGER NOT NULL CHECK(min_lifetime_points>=0),color TEXT,benefits TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,rank)
);CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_tenant_points ON loyalty_tiers(tenant_id,min_lifetime_points);`);
db.exec(`CREATE TABLE IF NOT EXISTS platform_permissions(
  role TEXT NOT NULL,permission TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,description TEXT NOT NULL,
  updated_by TEXT REFERENCES platform_admins(id),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(role,permission)
);
CREATE TABLE IF NOT EXISTS platform_access_logs(
  id TEXT PRIMARY KEY,user_type TEXT NOT NULL,user_id TEXT NOT NULL,tenant_id TEXT,success INTEGER NOT NULL,
  ip TEXT,user_agent TEXT,reason TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS billing_events(
  id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),invoice_id TEXT REFERENCES invoices(id),
  event_type TEXT NOT NULL,description TEXT NOT NULL,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS outbound_messages(
  id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),recipient TEXT NOT NULL,channel TEXT NOT NULL,template TEXT NOT NULL,
  subject TEXT,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',external_id TEXT,error TEXT,scheduled_at TEXT,
  sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_verifications(
  id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,destination TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at TEXT NOT NULL,verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_access_logs_date ON platform_access_logs(created_at,user_type);
CREATE INDEX IF NOT EXISTS idx_billing_events_tenant ON billing_events(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_messages(status,scheduled_at);`);
ensureColumn('outbound_messages', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('platform_access_logs', 'route', 'TEXT');
ensureColumn('customer_password_reset_tokens', 'delivery_channel', "TEXT NOT NULL DEFAULT 'email'");
ensureColumn('customer_password_reset_tokens', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('password_reset_tokens', 'delivery_channel', "TEXT NOT NULL DEFAULT 'email'");
ensureColumn('password_reset_tokens', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS platform_module_records(
 id TEXT PRIMARY KEY,module TEXT NOT NULL,section TEXT NOT NULL,tenant_id TEXT REFERENCES tenants(id),title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',priority TEXT NOT NULL DEFAULT 'medium',owner TEXT,due_at TEXT,payload TEXT NOT NULL DEFAULT '{}',created_by TEXT REFERENCES platform_admins(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_module_records_view ON platform_module_records(module,section,status,created_at);
CREATE TABLE IF NOT EXISTS platform_configuration_history(
 id TEXT PRIMARY KEY,module TEXT NOT NULL,section TEXT NOT NULL,record_id TEXT,admin_id TEXT REFERENCES platform_admins(id),before_value TEXT,after_value TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

// Fluxos SaaS integrados: atendimento, cobranca, catalogo e ofertas.
ensureColumn('support_tickets','source',"TEXT NOT NULL DEFAULT 'platform'");
ensureColumn('support_tickets','customer_id','TEXT REFERENCES customers(id)');
ensureColumn('support_tickets','customer_request_id','TEXT');
ensureColumn('support_tickets','category',"TEXT NOT NULL DEFAULT 'other'");
ensureColumn('support_tickets','first_response_at','TEXT');
ensureColumn('support_tickets','last_response_at','TEXT');
ensureColumn('customer_support_requests','support_ticket_id','TEXT');
ensureColumn('rewards','reward_type',"TEXT NOT NULL DEFAULT 'coupon'");
ensureColumn('rewards','image_data','TEXT');
ensureColumn('rewards','product_sku','TEXT');
ensureColumn('rewards','discount_type','TEXT');
ensureColumn('rewards','discount_value','INTEGER');
ensureColumn('rewards','minimum_order_cents','INTEGER NOT NULL DEFAULT 0');
ensureColumn('rewards','valid_from','TEXT');
ensureColumn('rewards','valid_until','TEXT');
ensureColumn('rewards','minimum_tier_rank','INTEGER');
const rewardValidityMigration='reward-validity-tier-v1';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(rewardValidityMigration))db.transaction(()=>{
  db.prepare("UPDATE rewards SET stock=NULL WHERE reward_type='coupon'").run();
  db.prepare('INSERT INTO migrations(name)VALUES(?)').run(rewardValidityMigration);
})();
db.exec(`CREATE TABLE IF NOT EXISTS support_ticket_events(
 id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 tenant_id TEXT REFERENCES tenants(id),actor_type TEXT NOT NULL,actor_id TEXT,action TEXT NOT NULL,
 message TEXT,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_events ON support_ticket_events(ticket_id,created_at);
CREATE TABLE IF NOT EXISTS billing_followups(
 id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),channel TEXT NOT NULL DEFAULT 'internal',status TEXT NOT NULL DEFAULT 'open',
 note TEXT NOT NULL,outcome TEXT,next_action_at TEXT,created_by TEXT REFERENCES platform_admins(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_followups ON billing_followups(invoice_id,next_action_at,created_at);
CREATE TABLE IF NOT EXISTS platform_coupons(
 id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,description TEXT,discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),
 discount_value INTEGER NOT NULL,valid_from TEXT,valid_until TEXT,max_uses INTEGER,used_count INTEGER NOT NULL DEFAULT 0,
 plan_code TEXT REFERENCES platform_plans(code),active INTEGER NOT NULL DEFAULT 1,created_by TEXT REFERENCES platform_admins(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_coupons_active ON platform_coupons(active,valid_until);
CREATE TABLE IF NOT EXISTS payment_webhook_events(
 id TEXT PRIMARY KEY,provider TEXT NOT NULL,external_event_id TEXT NOT NULL,event_type TEXT NOT NULL,
 payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'processed',error TEXT,processed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(provider,external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events ON payment_webhook_events(provider,event_type,created_at);
CREATE TABLE IF NOT EXISTS store_offers(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,description TEXT,
 product_sku TEXT,price_cents INTEGER NOT NULL,original_price_cents INTEGER,image_data TEXT,stock INTEGER,
 status TEXT NOT NULL DEFAULT 'draft',starts_at TEXT,ends_at TEXT,created_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_store_offers_public ON store_offers(tenant_id,status,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS offer_interests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),offer_id TEXT NOT NULL REFERENCES store_offers(id),
 customer_id TEXT NOT NULL REFERENCES customers(id),status TEXT NOT NULL DEFAULT 'new',message TEXT,
 preferred_contact TEXT NOT NULL DEFAULT 'whatsapp',internal_notes TEXT,assigned_to TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(offer_id,customer_id)
);
CREATE INDEX IF NOT EXISTS idx_offer_interests_queue ON offer_interests(tenant_id,status,created_at);
CREATE TABLE IF NOT EXISTS plan_change_requests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),from_plan_code TEXT,to_plan_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',reason TEXT,admin_notes TEXT,requested_by TEXT REFERENCES users(id),
 reviewed_by TEXT REFERENCES platform_admins(id),reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_plan_change_requests ON plan_change_requests(tenant_id,status,created_at);`);

// Governanca comercial dos planos: extensoes, trials e regras deixam de ser configuracoes implicitas.
db.exec(`CREATE TABLE IF NOT EXISTS plan_addons(
 id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT,
 monthly_price_cents INTEGER NOT NULL DEFAULT 0,additional_users INTEGER NOT NULL DEFAULT 0,
 additional_consumers INTEGER NOT NULL DEFAULT 0,additional_storage_mb INTEGER NOT NULL DEFAULT 0,
 compatible_plans TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,
 created_by TEXT REFERENCES platform_admins(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plan_addon_assignments(
 id TEXT PRIMARY KEY,addon_id TEXT NOT NULL REFERENCES plan_addons(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),
 quantity INTEGER NOT NULL DEFAULT 1,monthly_price_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at TEXT,created_by TEXT REFERENCES platform_admins(id)
);
CREATE INDEX IF NOT EXISTS idx_plan_addon_assignments ON plan_addon_assignments(tenant_id,status);
CREATE TABLE IF NOT EXISTS plan_trial_policies(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,plan_code TEXT NOT NULL REFERENCES platform_plans(code),duration_days INTEGER NOT NULL,
 extension_days INTEGER NOT NULL DEFAULT 0,auto_convert INTEGER NOT NULL DEFAULT 0,
 requires_payment_method INTEGER NOT NULL DEFAULT 0,conversion_plan_code TEXT REFERENCES platform_plans(code),
 communication_days TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,created_by TEXT REFERENCES platform_admins(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plan_commercial_rules(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,rule_type TEXT NOT NULL,source_plan_code TEXT REFERENCES platform_plans(code),
 target_plan_code TEXT REFERENCES platform_plans(code),discount_percent INTEGER NOT NULL DEFAULT 0,
 approval_required INTEGER NOT NULL DEFAULT 0,notice_days INTEGER NOT NULL DEFAULT 0,valid_from TEXT,valid_until TEXT,
 active INTEGER NOT NULL DEFAULT 1,created_by TEXT REFERENCES platform_admins(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_plan_commercial_rules ON plan_commercial_rules(active,rule_type);`);
ensureColumn('plan_addon_assignments','notes','TEXT');
ensureColumn('plan_addon_assignments','created_at','TEXT');
ensureColumn('plan_addon_assignments','updated_at','TEXT');
ensureColumn('plan_addon_assignments','updated_by','TEXT');
db.prepare(`UPDATE plan_addon_assignments SET created_at=COALESCE(created_at,started_at),updated_at=COALESCE(updated_at,started_at)`).run();
db.exec(`CREATE TABLE IF NOT EXISTS platform_analytics_reports(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,metrics TEXT NOT NULL DEFAULT '[]',dimensions TEXT NOT NULL DEFAULT '[]',
 period TEXT NOT NULL DEFAULT '90',format TEXT NOT NULL DEFAULT 'csv',recipients TEXT,
 active INTEGER NOT NULL DEFAULT 1,last_generated_at TEXT,created_by TEXT REFERENCES platform_admins(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_analytics_reports ON platform_analytics_reports(active,created_at);`);
db.exec(`CREATE TABLE IF NOT EXISTS platform_integration_configs(
 id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),category TEXT NOT NULL CHECK(category IN ('api','webhook','erp','crm','payments','email','sso')),
 name TEXT NOT NULL,provider TEXT NOT NULL,environment TEXT NOT NULL DEFAULT 'production',base_url TEXT,
 config TEXT NOT NULL DEFAULT '{}',credentials_encrypted TEXT,credential_hint TEXT,status TEXT NOT NULL DEFAULT 'draft',
 active INTEGER NOT NULL DEFAULT 1,last_test_at TEXT,last_sync_at TEXT,last_error TEXT,created_by TEXT REFERENCES platform_admins(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_integration_configs ON platform_integration_configs(category,tenant_id,status,active);
CREATE TABLE IF NOT EXISTS platform_integration_events(
 id TEXT PRIMARY KEY,integration_id TEXT REFERENCES platform_integration_configs(id) ON DELETE SET NULL,tenant_id TEXT REFERENCES tenants(id),
 category TEXT NOT NULL,provider TEXT NOT NULL,event_type TEXT NOT NULL,status TEXT NOT NULL,duration_ms INTEGER,message TEXT,
 metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_integration_events ON platform_integration_events(category,status,created_at);`);
ensureColumn('jobs','priority',"INTEGER NOT NULL DEFAULT 5");
ensureColumn('jobs','dead_lettered_at','TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS platform_queue_policies(
 job_type TEXT PRIMARY KEY,display_name TEXT NOT NULL,paused INTEGER NOT NULL DEFAULT 0,concurrency INTEGER NOT NULL DEFAULT 1,
 max_attempts INTEGER NOT NULL DEFAULT 3,retention_days INTEGER NOT NULL DEFAULT 30,updated_by TEXT REFERENCES platform_admins(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platform_operation_schedules(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,job_type TEXT NOT NULL,
 frequency TEXT NOT NULL CHECK(frequency IN ('hourly','daily','weekly')),run_at TEXT NOT NULL DEFAULT '03:00',timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
 payload TEXT,active INTEGER NOT NULL DEFAULT 1,last_run_at TEXT,next_run_at TEXT NOT NULL,last_status TEXT,last_error TEXT,
 created_by TEXT REFERENCES platform_admins(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_operation_schedules_due ON platform_operation_schedules(active,next_run_at);
CREATE TABLE IF NOT EXISTS platform_operation_exports(
 id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),dataset TEXT NOT NULL,format TEXT NOT NULL DEFAULT 'csv',status TEXT NOT NULL DEFAULT 'ready',
 filters TEXT NOT NULL DEFAULT '{}',row_count INTEGER NOT NULL DEFAULT 0,error TEXT,expires_at TEXT NOT NULL,created_by TEXT REFERENCES platform_admins(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,downloaded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_operation_exports ON platform_operation_exports(status,expires_at,created_at);
INSERT OR IGNORE INTO platform_queue_policies(job_type,display_name)VALUES
 ('sync_bling','Sincronização Bling'),('import_customers','Importação de clientes'),('import_sales','Importação de vendas'),('refresh_gie','Atualização de inteligência');`);
ensureColumn('platform_incidents','service','TEXT');
ensureColumn('platform_incidents','impact','TEXT');
ensureColumn('platform_incidents','commander','TEXT');
ensureColumn('platform_incidents','acknowledged_at','TEXT');
ensureColumn('platform_incidents','next_update_at','TEXT');
ensureColumn('platform_incidents','root_cause','TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS platform_monitors(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,target TEXT NOT NULL CHECK(target IN ('api','database','worker','integrations','communications','payments')),
 path TEXT,threshold_ms INTEGER NOT NULL DEFAULT 1000,expected_status INTEGER NOT NULL DEFAULT 200,interval_seconds INTEGER NOT NULL DEFAULT 300,
 active INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',last_checked_at TEXT,last_duration_ms INTEGER,last_error TEXT,
 created_by TEXT REFERENCES platform_admins(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_monitors ON platform_monitors(target,active,status);
CREATE TABLE IF NOT EXISTS platform_monitoring_snapshots(
 id TEXT PRIMARY KEY,requests INTEGER NOT NULL,errors INTEGER NOT NULL,error_rate REAL NOT NULL,average_response_ms REAL NOT NULL,
 queued_jobs INTEGER NOT NULL,processing_jobs INTEGER NOT NULL,failed_jobs INTEGER NOT NULL,integration_errors INTEGER NOT NULL,
 outbound_failures INTEGER NOT NULL,open_incidents INTEGER NOT NULL,database_bytes INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_date ON platform_monitoring_snapshots(created_at);
CREATE TABLE IF NOT EXISTS platform_incident_events(
 id TEXT PRIMARY KEY,incident_id TEXT NOT NULL REFERENCES platform_incidents(id) ON DELETE CASCADE,admin_id TEXT REFERENCES platform_admins(id),
 action TEXT NOT NULL,message TEXT,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_incident_events ON platform_incident_events(incident_id,created_at);
CREATE TABLE IF NOT EXISTS platform_log_queries(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,query TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'all',severity TEXT NOT NULL DEFAULT 'all',
 notify INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_by TEXT REFERENCES platform_admins(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_log_queries ON platform_log_queries(active,source);`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_external_payment ON invoices(external_payment_id) WHERE external_payment_id IS NOT NULL');
const asaasEnvironmentMigration='2026-08-31-track-asaas-environment';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(asaasEnvironmentMigration)){
  db.transaction(()=>{
    db.prepare("UPDATE subscriptions SET asaas_environment='sandbox' WHERE asaas_environment IS NULL AND (external_customer_id IS NOT NULL OR external_subscription_id IS NOT NULL OR external_checkout_id IS NOT NULL)").run();
    db.prepare("UPDATE invoices SET asaas_environment='sandbox' WHERE asaas_environment IS NULL AND external_payment_id IS NOT NULL").run();
    db.prepare('INSERT INTO migrations(name)VALUES(?)').run(asaasEnvironmentMigration);
  })();
}

// Ofertas comerciais pagas diretamente à loja, sem consumo de pontos.
ensureColumn('store_offers','payment_type',"TEXT NOT NULL DEFAULT 'store'");
ensureColumn('store_offers','payment_instructions','TEXT');
ensureColumn('store_offers','payment_url','TEXT');
ensureColumn('offer_interests','reservation_code','TEXT');
ensureColumn('offer_interests','price_cents','INTEGER');
ensureColumn('offer_interests','reserved_at','TEXT');
ensureColumn('offer_interests','expires_at','TEXT');
ensureColumn('offer_interests','paid_at','TEXT');
ensureColumn('offer_interests','payment_method','TEXT');
ensureColumn('offer_interests','order_number','TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_reservation_code ON offer_interests(reservation_code) WHERE reservation_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offer_reservations_status ON offer_interests(tenant_id,status,reserved_at);`);

const paidOffersMigration='2026-08-26-separate-paid-offers';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(paidOffersMigration)){
  db.transaction(()=>{
    const products=db.prepare("SELECT * FROM rewards WHERE reward_type='product'").all() as any[];
    for(const product of products){
      db.prepare(`INSERT OR IGNORE INTO store_offers(id,tenant_id,name,description,product_sku,price_cents,image_data,stock,status,created_at,updated_at)
        VALUES(?,?,?,?,?,0,?,?, 'draft',?,CURRENT_TIMESTAMP)`).run(`offer-${product.id}`,product.tenant_id,product.name,product.description,product.product_sku,product.image_data,product.stock,product.created_at);
      db.prepare('UPDATE rewards SET active=0 WHERE id=?').run(product.id);
    }
    db.prepare('INSERT INTO migrations(name) VALUES(?)').run(paidOffersMigration);
  })();
}

const supportBridge='2026-08-25-bridge-customer-support';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(supportBridge)){
  db.transaction(()=>{
    const requests=db.prepare('SELECT id,tenant_id,customer_id,subject,message,category,status,response,created_at,updated_at FROM customer_support_requests WHERE support_ticket_id IS NULL').all() as any[];
    for(const request of requests){
      const ticketId=`support-${request.id}`;
      db.prepare(`INSERT OR IGNORE INTO support_tickets(id,tenant_id,subject,description,status,priority,source,customer_id,customer_request_id,category,created_at,updated_at)
        VALUES(?,?,?,?,?,'medium','customer',?,?,?,?,?)`).run(ticketId,request.tenant_id,request.subject,request.message,request.status,request.customer_id,request.id,request.category,request.created_at,request.updated_at);
      db.prepare('UPDATE customer_support_requests SET support_ticket_id=? WHERE id=?').run(ticketId,request.id);
      db.prepare("INSERT OR IGNORE INTO support_ticket_events(id,ticket_id,tenant_id,actor_type,actor_id,action,message,created_at) VALUES(?,?,?,?,?,'created',?,?)")
        .run(`event-${request.id}`,ticketId,request.tenant_id,'customer',request.customer_id,request.message,request.created_at);
    }
    db.prepare('INSERT INTO migrations(name) VALUES(?)').run(supportBridge);
  })();
}
const permissions=[
 ['super_admin','platform.manage','Gerenciar toda a plataforma e configurações globais'],['super_admin','billing.manage','Gerenciar assinaturas, cobranças e conciliação'],
 ['owner','company.manage','Gerenciar cadastro, equipe e integrações da própria empresa'],['owner','billing.read','Consultar plano, faturas e pagamentos da própria empresa'],
 ['manager','crm.manage','Gerenciar clientes, vendas, campanhas e relatórios'],['operator','operation.write','Cadastrar clientes e vendas na operação diária']
];
const permissionInsert=db.prepare('INSERT OR IGNORE INTO platform_permissions(role,permission,description) VALUES(?,?,?)');
db.transaction(()=>permissions.forEach(x=>permissionInsert.run(...x)))();
const ledgerBaseline='loyalty-ledger-source-of-truth-v1';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(ledgerBaseline)){
  db.transaction(()=>{
    const rows=db.prepare(`SELECT c.id customerId,c.tenant_id tenantId,c.points_balance-COALESCE(SUM(l.points),0) delta
      FROM customers c LEFT JOIN loyalty_ledger l ON l.tenant_id=c.tenant_id AND l.customer_id=c.id
      GROUP BY c.id,c.tenant_id,c.points_balance HAVING delta<>0`).all()as{customerId:string;tenantId:string;delta:number}[];
    const insert=db.prepare(`INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type)
      VALUES(lower(hex(randomblob(16))),?,?,?,'Saldo inicial consolidado na adocao do ledger','adjustment')`);
    for(const row of rows)insert.run(row.tenantId,row.customerId,row.delta);
    db.prepare('INSERT INTO migrations(name)VALUES(?)').run(ledgerBaseline);
  })();
}
// Núcleo provider-neutral para que novos ERPs compartilhem rastreabilidade,
// idempotência e vínculos de entidades sem duplicar as regras de fidelidade.
db.exec(`CREATE TABLE IF NOT EXISTS integration_sync_runs(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,provider TEXT NOT NULL,
 trigger TEXT NOT NULL CHECK(trigger IN ('manual','scheduled','webhook','reconciliation')),
 status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','completed','failed')),
 correlation_id TEXT,summary TEXT NOT NULL DEFAULT '{}',error_code TEXT,error_message TEXT,
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_integration_sync_runs ON integration_sync_runs(tenant_id,provider,started_at DESC);
CREATE TABLE IF NOT EXISTS integration_entity_links(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,provider TEXT NOT NULL,
 entity_type TEXT NOT NULL CHECK(entity_type IN ('customer','sale','product','inventory')),
 external_id TEXT NOT NULL,local_id TEXT NOT NULL,external_updated_at TEXT,checksum TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,provider,entity_type,external_id)
);
CREATE INDEX IF NOT EXISTS idx_integration_entity_local ON integration_entity_links(tenant_id,provider,entity_type,local_id);`);

// Rotação assistida: com DATA_ENCRYPTION_KEY definida, migra segredos legados e
// chaves anteriores para a chave ativa antes de a aplicação começar a atender.
if(process.env.DATA_ENCRYPTION_KEY?.trim()){
  const migrateEncryptedColumns=(table:string,columns:string[],purpose:'bling'|'totp',decrypt:(value:string)=>string,encrypt:(value:string)=>string)=>{
    const available=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(item=>item.name));
    if(!available.has('id'))return;
    for(const column of columns){
      if(!available.has(column))continue;
      const rows=db.prepare(`SELECT id,${column} value FROM ${table} WHERE ${column} IS NOT NULL AND ${column}<>''`).all() as {id:string;value:string}[];
      for(const row of rows){
        if(isCurrentDataCipher(row.value,purpose))continue;
        const clear=decrypt(row.value);
        db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(encrypt(clear),row.id);
      }
    }
  };
  db.transaction(()=>{
    migrateEncryptedColumns('integration_connections',['access_token_encrypted','refresh_token_encrypted'],'bling',decryptSecret,encryptSecret);
    migrateEncryptedColumns('platform_integration_configs',['credentials_encrypted'],'bling',decryptSecret,encryptSecret);
    migrateEncryptedColumns('erp_connectors',['credentials_encrypted'],'bling',decryptSecret,encryptSecret);
    migrateEncryptedColumns('users',['two_factor_secret_encrypted','two_factor_pending_secret_encrypted'],'totp',decryptTotp,encryptTotp);
    migrateEncryptedColumns('platform_admins',['two_factor_secret_encrypted','two_factor_pending_secret_encrypted'],'totp',decryptTotp,encryptTotp);
  })();
}
\nconsole.log('Banco atualizado com sucesso.');
