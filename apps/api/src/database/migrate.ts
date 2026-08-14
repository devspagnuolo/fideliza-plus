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
ensureColumn('customers', 'external_id', 'TEXT');
ensureColumn('integration_connections', 'external_company_id', 'TEXT');
ensureColumn('users', 'two_factor_secret_encrypted', 'TEXT');
ensureColumn('users', 'two_factor_enabled', 'INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_external ON customers(tenant_id,external_id) WHERE external_id IS NOT NULL');
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
