import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.cwd(), `data/test-reward-channels-${randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'reward-channels-test-secret-32-chars';
const { db } = await import('./database/db.js');
await import('./database/migrate.js');
const { hashPassword } = await import('./security.js');
const { app } = await import('./app.js');

describe('canal das recompensas (App, Site ou ambos)', () => {
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const coupon = { pointsCost: 100, discountType: 'percent', discountValue: 10, validUntil: nextWeek };
  beforeAll(() => {
    db.prepare("INSERT INTO tenants (id,name,slug,customer_portal_enabled) VALUES ('ch-site','Loja com site','ch-site',1),('ch-store','Loja física','ch-store',1)").run();
    db.prepare("INSERT INTO subscriptions(id,tenant_id,plan_code,status)VALUES('sub-ch-site','ch-site','professional','active'),('sub-ch-store','ch-store','professional','active')").run();
    db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)').run('ch-site-owner', 'ch-site', 'Dona Site', 'ch-site@example.com', hashPassword('Senha@123'), 'owner', 'ch-store-owner', 'ch-store', 'Dona Loja', 'ch-store@example.com', hashPassword('Senha@123'), 'owner');
    db.prepare("INSERT INTO customers (id,tenant_id,name,cpf,points_balance,enrolled_at) VALUES ('ch-customer','ch-site','Cliente Canal','52998224725',1000,CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT INTO customer_accounts(id,tenant_id,customer_id,password_hash)VALUES('ch-account','ch-site','ch-customer',?)").run(hashPassword('Cliente@123'));
    db.prepare("INSERT INTO storeos_customer_links(tenant_id,external_customer_id,customer_id)VALUES('ch-site','ext-ch-1','ch-customer')").run();
  });
  afterAll(() => {
    db.close();
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('mantém recompensas antigas no App e no site', () => {
    const column = (db.prepare('PRAGMA table_info(rewards)').all() as { name: string; dflt_value: string }[]).find(item => item.name === 'channel');
    expect(column?.dflt_value).toBe("'both'");
  });

  it('só permite Site ou Ambos para lojas com integração de site', async () => {
    const owner = request.agent(app);
    await owner.post('/auth/login').send({ email: 'ch-store@example.com', password: 'Senha@123' }).expect(200);
    expect((await owner.get('/rewards/channels').expect(200)).body).toEqual({ siteIntegration: false });
    await owner.post('/rewards').set('x-fideliza-request', 'web').send({ ...coupon, name: 'Só site', channel: 'site' }).expect(400);
    await owner.post('/rewards').set('x-fideliza-request', 'web').send({ ...coupon, name: 'Ambos', channel: 'both' }).expect(400);
    const created = await owner.post('/rewards').set('x-fideliza-request', 'web').send({ ...coupon, name: 'Padrão loja' }).expect(201);
    expect(db.prepare('SELECT channel FROM rewards WHERE id=?').get(created.body.id)).toEqual({ channel: 'app' });
    await owner.patch(`/rewards/${created.body.id}`).set('x-fideliza-request', 'web').send({ channel: 'site' }).expect(400);
  });

  it('exibe cada recompensa apenas no canal escolhido', async () => {
    const owner = request.agent(app);
    await owner.post('/auth/login').send({ email: 'ch-site@example.com', password: 'Senha@123' }).expect(200);
    const key = (await owner.post('/api-keys').set('x-fideliza-request', 'web').send({ name: 'StoreOS', scopes: ['rewards:read', 'rewards:redeem'] }).expect(201)).body.key;
    expect((await owner.get('/rewards/channels').expect(200)).body).toEqual({ siteIntegration: true });
    const ids: Record<string, string> = {};
    for (const channel of ['app', 'site', 'both']) ids[channel] = (await owner.post('/rewards').set('x-fideliza-request', 'web').send({ ...coupon, name: `Cupom ${channel}`, channel }).expect(201)).body.id;
    const defaulted = await owner.post('/rewards').set('x-fideliza-request', 'web').send({ ...coupon, name: 'Sem canal' }).expect(201);
    expect(db.prepare('SELECT channel FROM rewards WHERE id=?').get(defaulted.body.id)).toEqual({ channel: 'both' });
    await owner.delete(`/rewards/${defaulted.body.id}`).set('x-fideliza-request', 'web').expect(200);
    expect((await owner.get('/rewards').expect(200)).body.map((item: { channel: string }) => item.channel).sort()).toEqual(['app', 'both', 'site']);

    const customer = request.agent(app);
    await customer.post('/customer/auth/login').set('x-fideliza-request', 'web').send({ tenantSlug: 'ch-site', cpf: '52998224725', password: 'Cliente@123' }).expect(200);
    const inApp = (await customer.get('/customer/rewards').expect(200)).body.items.map((item: { id: string }) => item.id).sort();
    expect(inApp).toEqual([ids.app, ids.both].sort());
    await customer.post(`/customer/rewards/${ids.site}/redeem`).set('x-fideliza-request', 'web').send({}).expect(404);
    await owner.post(`/rewards/${ids.site}/redeem`).set('x-fideliza-request', 'web').send({ customerId: 'ch-customer' }).expect(404);

    const loyalty = await request(app).get('/public/v1/storeos/customers/ext-ch-1/loyalty').set('authorization', `Bearer ${key}`).expect(200);
    expect(loyalty.body.data.rewards.map((item: { id: string }) => item.id).sort()).toEqual([ids.site, ids.both].sort());
    await request(app).post('/public/v1/storeos/redemptions').set('authorization', `Bearer ${key}`).set('Idempotency-Key', 'channel-app-only-1').send({ externalCustomerId: 'ext-ch-1', rewardId: ids.app, checkoutId: 'chk-1' }).expect(404);
    await request(app).post('/public/v1/storeos/redemptions').set('authorization', `Bearer ${key}`).set('Idempotency-Key', 'channel-site-only-1').send({ externalCustomerId: 'ext-ch-1', rewardId: ids.site, checkoutId: 'chk-2' }).expect(201);

    await owner.patch(`/rewards/${ids.app}`).set('x-fideliza-request', 'web').send({ channel: 'both' }).expect(204);
    expect((await customer.get('/customer/rewards').expect(200)).body.items.some((item: { id: string }) => item.id === ids.app)).toBe(true);
  });
});
