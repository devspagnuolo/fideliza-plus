import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const databasePath = path.join(os.tmpdir(), `fideliza-audit-${Date.now()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'audit-evolution-secret-32-characters';

const { db } = await import('./database/db.js');
await import('./database/migrate.js');
const { pointBalanceDivergences, reconcilePointBalances, redemptionLimit } = await import('./loyalty.js');
const { secureStringEqual } = await import('./security.js');

describe('evolucao orientada pela auditoria', () => {
  beforeAll(() => {
    db.prepare("INSERT INTO tenants(id,name,slug) VALUES('audit-tenant','Loja Auditoria','loja-auditoria')").run();
    db.prepare("INSERT INTO customers(id,tenant_id,name,points_balance) VALUES('audit-customer','audit-tenant','Cliente',999)").run();
    db.prepare("INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type) VALUES('audit-ledger','audit-tenant','audit-customer',125,'Compra','earn')").run();
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('detecta e corrige o saldo cache a partir do ledger', () => {
    expect(pointBalanceDivergences('audit-tenant')).toEqual([expect.objectContaining({ storedBalance: 999, ledgerBalance: 125, difference: -874 })]);
    expect(reconcilePointBalances('audit-tenant').corrected).toBe(1);
    expect((db.prepare("SELECT points_balance balance FROM customers WHERE id='audit-customer'").get() as { balance: number }).balance).toBe(125);
    expect(pointBalanceDivergences('audit-tenant')).toHaveLength(0);
  });

  it('aplica limite antifraude configuravel', () => {
    db.prepare("UPDATE global_settings SET value='1' WHERE key='security.daily_redemption_limit'").run();
    expect(redemptionLimit('audit-tenant', 'audit-customer')).toEqual({ allowed: true, used: 0, limit: 1 });
    db.prepare("INSERT INTO rewards(id,tenant_id,name,points_cost) VALUES('audit-reward','audit-tenant','Cupom',10)").run();
    db.prepare("INSERT INTO reward_redemptions(id,tenant_id,reward_id,customer_id,points_spent) VALUES('audit-redemption','audit-tenant','audit-reward','audit-customer',10)").run();
    expect(redemptionLimit('audit-tenant', 'audit-customer')).toEqual({ allowed: false, used: 1, limit: 1 });
  });

  it('compara segredos sem igualdade direta', () => {
    expect(secureStringEqual('segredo', 'segredo')).toBe(true);
    expect(secureStringEqual('segredo', 'outro')).toBe(false);
  });
});
