import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databasePath = path.resolve(process.cwd(), `data/tiers-health-${randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'tiers-health-secret-with-32-characters';
process.env.PLATFORM_ADMIN_NAME = 'Admin Operações';
process.env.PLATFORM_ADMIN_EMAIL = 'operations-health@fideliza.test';
process.env.PLATFORM_ADMIN_PASSWORD = 'Operations@123';

const { db } = await import('./database/db.js');
await import('./database/migrate.js');
const { hashPassword } = await import('./security.js');
const { customerVipTier } = await import('./loyalty.js');
const { app } = await import('./app.js');

describe('níveis de fidelidade e saúde operacional', () => {
  beforeAll(() => {
    db.prepare("INSERT INTO tenants(id,name,slug)VALUES('tier-tenant','Loja Níveis','loja-niveis')").run();
    db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role)VALUES('tier-owner','tier-tenant','Gestora','gestora@niveis.test',?,'owner')").run(hashPassword('Gestora@123'));
    db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role)VALUES('tier-operator','tier-tenant','Operadora','operadora@niveis.test',?,'operator')").run(hashPassword('Operadora@123'));
    db.prepare("INSERT INTO customers(id,tenant_id,name,email,points_balance)VALUES('tier-customer','tier-tenant','Cliente VIP','vip@niveis.test',999)").run();
    db.prepare("INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type)VALUES('tier-earn','tier-tenant','tier-customer',1200,'Compras acumuladas','earn')").run();
    db.prepare("INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type)VALUES('tier-reversal','tier-tenant','tier-customer',-100,'Pedido cancelado','reversal')").run();
    db.prepare("INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type)VALUES('tier-redemption','tier-tenant','tier-customer',-200,'Resgate','redemption')").run();
    for (let index = 0; index < 5; index++) db.prepare("INSERT INTO platform_access_logs(id,user_type,user_id,tenant_id,success,reason)VALUES(?, 'company','attacked-identity','tier-tenant',0,'invalid_credentials')").run(`failed-login-${index}`);
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('permite ao gestor configurar níveis com validação e isolamento', async () => {
    const owner = request.agent(app);
    await owner.post('/auth/login').send({ email: 'gestora@niveis.test', password: 'Gestora@123' }).expect(200);
    const tiers = [
      { name: 'Essencial', rank: 1, minLifetimePoints: 0, color: '#00978F', benefits: 'Acesso ao programa' },
      { name: 'Prata', rank: 2, minLifetimePoints: 1000, color: '#6D7A8A', benefits: 'Ofertas antecipadas' },
      { name: 'Ouro', rank: 3, minLifetimePoints: 3000, color: '#C9971A', benefits: 'Benefícios premium' },
    ];
    expect((await owner.put('/loyalty/tiers').set('x-fideliza-request', 'web').send({ tiers }).expect(200)).body.items).toHaveLength(3);
    expect((await owner.get('/loyalty/tiers').expect(200)).body.items[1]).toMatchObject({ name: 'Prata', minLifetimePoints: 1000 });
    await owner.put('/loyalty/tiers').set('x-fideliza-request', 'web').send({ tiers: [{ ...tiers[0] }, { ...tiers[1], minLifetimePoints: 0 }] }).expect(400);

    const operator = request.agent(app);
    await operator.post('/auth/login').send({ email: 'operadora@niveis.test', password: 'Operadora@123' }).expect(200);
    await operator.get('/loyalty/tiers').expect(200);
    await operator.put('/loyalty/tiers').set('x-fideliza-request', 'web').send({ tiers }).expect(403);

    expect(customerVipTier('tier-tenant', 'tier-customer')).toMatchObject({
      lifetimePoints: 1100,
      current: { name: 'Prata' },
      next: { name: 'Ouro' },
      pointsToNext: 1900,
      progressPercent: 5,
    });
  });

  it('consolida divergências e contenções para o administrador', async () => {
    const admin = request.agent(app);
    await admin.post('/platform/auth/login').set('x-fideliza-request', 'web').send({ email: process.env.PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD }).expect(200);
    const health = (await admin.get('/platform/operations-health').expect(200)).body;
    expect(health.ledger).toMatchObject({ divergingCustomers: 1, sample: [expect.objectContaining({ customerId: 'tier-customer' })] });
    expect(health.loginLockouts).toHaveLength(1);
    expect(health.loginLockouts[0]).toMatchObject({ companyName: 'Loja Níveis', attempts: 5 });
    expect(health.circuits).toEqual(expect.any(Array));
    expect(health.alerts.map((item: { label: string }) => item.label)).toEqual(expect.arrayContaining(['Saldos divergentes', 'Bloqueios de login']));
  });
});
