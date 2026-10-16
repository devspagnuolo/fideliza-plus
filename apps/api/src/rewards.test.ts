import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.cwd(), `data/test-rewards-${randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'rewards-test-secret-with-32-chars';
const { db } = await import('./database/db.js');
await import('./database/migrate.js');
const { hashPassword } = await import('./security.js');
const { app } = await import('./app.js');

describe('catálogo de recompensas', () => {
  const tomorrow=new Date(Date.now()+86_400_000).toISOString().slice(0,10);
  const dayAfterTomorrow=new Date(Date.now()+2*86_400_000).toISOString().slice(0,10);
  beforeAll(() => {
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('reward-a', 'Vivi Moda', 'reward-a');
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('reward-b', 'Outra Loja', 'reward-b');
    db.prepare("INSERT INTO subscriptions(id,tenant_id,plan_code,status)VALUES('sub-reward-a','reward-a','pilot','active'),('sub-reward-b','reward-b','pilot','active')").run();
    db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('reward-owner', 'reward-a', 'Viviane', 'rewards@example.com', hashPassword('Senha@123'), 'owner');
    db.prepare('INSERT INTO customers (id,tenant_id,name,cpf,phone,points_balance,enrolled_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)').run('reward-customer', 'reward-a', 'Cliente Fiel', '52998224725', '11999990001', 200);
    db.prepare('UPDATE tenants SET customer_portal_enabled=1 WHERE id=?').run('reward-a');
    db.prepare('INSERT INTO customer_accounts(id,tenant_id,customer_id,password_hash)VALUES(?,?,?,?)').run('reward-account','reward-a','reward-customer',hashPassword('Cliente@123'));
    db.prepare('INSERT INTO customers (id,tenant_id,name,points_balance) VALUES (?,?,?,?)').run('reward-other', 'reward-b', 'Outro Cliente', 500);
    db.prepare("INSERT INTO rewards (id,tenant_id,name,points_cost,stock) VALUES ('reward-other-tenant','reward-b','Outro prêmio',100,2)").run();
    db.prepare("INSERT INTO loyalty_tiers(id,tenant_id,name,rank,min_lifetime_points)VALUES('reward-tier-base','reward-a','Essencial',1,0),('reward-tier-gold','reward-a','Ouro',2,500)").run();
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('resgata de forma transacional sem cruzar empresa e sem limitar quantidade de cupons', async () => {
    const owner = request.agent(app);
    await owner.post('/auth/login').send({ email: 'rewards@example.com', password: 'Senha@123' }).expect(200);
    const reward = await owner.post('/rewards').set('x-fideliza-request', 'web').send({ name: 'Cupom R$ 20', pointsCost: 150, discountType: 'fixed', discountValue: 2000, validUntil:tomorrow }).expect(201);
    await owner.post(`/rewards/${reward.body.id}/redeem`).set('x-fideliza-request', 'web').send({ customerId: 'reward-other' }).expect(404);
    const redeemed = await owner.post(`/rewards/${reward.body.id}/redeem`).set('x-fideliza-request', 'web').send({ customerId: 'reward-customer' }).expect(201);
    expect(redeemed.body).toMatchObject({ pointsSpent: 150, balance: 50 });
    await owner.post(`/rewards/${reward.body.id}/redeem`).set('x-fideliza-request', 'web').send({ customerId: 'reward-customer' }).expect(409);
    expect((db.prepare("SELECT points_balance FROM customers WHERE id='reward-customer'").get() as { points_balance: number }).points_balance).toBe(50);
    expect((db.prepare('SELECT stock,valid_until FROM rewards WHERE id=?').get(reward.body.id) as any)).toEqual({stock:null,valid_until:tomorrow});
    expect((db.prepare('SELECT COUNT(*) total FROM reward_redemptions').get() as { total: number }).total).toBe(1);

    const customer = request.agent(app);
    await customer.post('/customer/auth/login').set('x-fideliza-request', 'web').send({ tenantSlug: 'reward-a', cpf: '52998224725', password: 'Cliente@123' }).expect(200);
    const released = await customer.post(`/customer/redemptions/${redeemed.body.id}/use`).set('x-fideliza-request', 'web').send({}).expect(200);
    expect(released.body.code).toMatch(/^FZ-[A-F0-9]{8}$/);
    const repeated = await customer.post(`/customer/redemptions/${redeemed.body.id}/use`).set('x-fideliza-request', 'web').send({}).expect(200);
    expect(repeated.body.code).toBe(released.body.code);

    await owner.post('/reward-redemptions/validate').set('x-fideliza-request', 'web').send({ code: released.body.code, orderNumber: '25781' }).expect(200);
    await owner.post('/reward-redemptions/validate').set('x-fideliza-request', 'web').send({ code: released.body.code, orderNumber: '25782' }).expect(409);
    expect(db.prepare('SELECT status,order_number,used_by,used_at FROM reward_redemptions WHERE id=?').get(redeemed.body.id)).toMatchObject({ status: 'used', order_number: '25781', used_by: 'reward-owner' });
  });

  it('edita, exclui e arquiva recompensas preservando histórico e isolamento', async () => {
    const owner = request.agent(app);
    await owner.post('/auth/login').send({ email: 'rewards@example.com', password: 'Senha@123' }).expect(200);
    const created = await owner.post('/rewards').set('x-fideliza-request', 'web').send({ name: 'Brinde teste', description: 'Original', pointsCost: 80, discountType: 'fixed', discountValue: 1000, validUntil:tomorrow }).expect(201);
    await owner.patch(`/rewards/${created.body.id}`).set('x-fideliza-request', 'web').send({ name: 'Brinde atualizado', description: 'Nova descrição', pointsCost: 90, validUntil:dayAfterTomorrow,minimumTierRank:1 }).expect(204);
    expect(db.prepare('SELECT name,description,points_cost,stock,valid_until,minimum_tier_rank FROM rewards WHERE id=?').get(created.body.id)).toEqual({ name: 'Brinde atualizado', description: 'Nova descrição', points_cost: 90, stock:null,valid_until:dayAfterTomorrow,minimum_tier_rank:1 });
    expect((await owner.delete(`/rewards/${created.body.id}`).set('x-fideliza-request', 'web').expect(200)).body).toEqual({ deleted: true, archived: false });
    expect(db.prepare('SELECT id FROM rewards WHERE id=?').get(created.body.id)).toBeUndefined();

    await owner.patch('/rewards/reward-other-tenant').set('x-fideliza-request', 'web').send({ name: 'Tentativa indevida' }).expect(404);
    await owner.delete('/rewards/reward-other-tenant').set('x-fideliza-request', 'web').expect(404);

    const redeemedReward = db.prepare("SELECT id FROM rewards WHERE tenant_id='reward-a' LIMIT 1").get() as { id: string };
    expect((await owner.delete(`/rewards/${redeemedReward.id}`).set('x-fideliza-request', 'web').expect(200)).body).toEqual({ deleted: false, archived: true });
    expect(db.prepare('SELECT active FROM rewards WHERE id=?').get(redeemedReward.id)).toEqual({ active: 0 });
    await owner.patch(`/rewards/${redeemedReward.id}`).set('x-fideliza-request', 'web').send({ active: true }).expect(204);
    expect(db.prepare('SELECT active FROM rewards WHERE id=?').get(redeemedReward.id)).toEqual({ active: 1 });
    expect((db.prepare('SELECT COUNT(*) total FROM reward_redemptions WHERE reward_id=?').get(redeemedReward.id) as { total: number }).total).toBe(1);
  });

  it('publica somente benefícios vigentes e compatíveis com o nível do cliente',async()=>{
    const owner=request.agent(app),customer=request.agent(app);
    await owner.post('/auth/login').send({email:'rewards@example.com',password:'Senha@123'}).expect(200);
    await customer.post('/customer/auth/login').set('x-fideliza-request','web').send({tenantSlug:'reward-a',cpf:'52998224725',password:'Cliente@123'}).expect(200);
    const gold=await owner.post('/rewards').set('x-fideliza-request','web').send({name:'Experiência Ouro',pointsCost:10,discountType:'fixed',discountValue:1000,validUntil:tomorrow,minimumTierRank:2}).expect(201);
    const scheduled=await owner.post('/rewards').set('x-fideliza-request','web').send({name:'Cupom futuro',pointsCost:10,discountType:'fixed',discountValue:1000,validFrom:tomorrow,validUntil:dayAfterTomorrow,minimumTierRank:1}).expect(201);
    const catalog=await customer.get('/customer/rewards').expect(200);
    expect(catalog.body.items.map((item:any)=>item.id)).not.toEqual(expect.arrayContaining([gold.body.id,scheduled.body.id]));
    await owner.post(`/rewards/${gold.body.id}/redeem`).set('x-fideliza-request','web').send({customerId:'reward-customer'}).expect(403);
    await owner.post(`/rewards/${scheduled.body.id}/redeem`).set('x-fideliza-request','web').send({customerId:'reward-customer'}).expect(409);
  });
});
