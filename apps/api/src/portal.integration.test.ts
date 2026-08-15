import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.cwd(), `data/portal-${randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'portal-test-secret-with-32-characters';
process.env.PLATFORM_ADMIN_NAME = 'Rafael';
process.env.PLATFORM_ADMIN_EMAIL = 'rafael@fideliza.test';
process.env.PLATFORM_ADMIN_PASSWORD = 'AdminFideliza@123';

const { db } = await import('./database/db.js');
await import('./database/migrate.js');
const { app } = await import('./app.js');

describe('portais separados do Fideliza+', () => {
  beforeAll(() => {
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('tenant-portal-a', 'Loja Portal A', 'loja-a');
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('tenant-portal-b', 'Loja Portal B', 'loja-b');
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('cadastra o consumidor na loja correta e isola sua sessão', async () => {
    const consumer = request.agent(app);
    await consumer.post('/customer/auth/register').set('x-fideliza-request', 'web').send({
      tenantSlug: 'loja-a',
      name: 'Cliente Portal',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
      email: 'cliente@portal.test',
      password: 'Cliente@123',
      acceptTerms: true,
    }).expect(201);

    const me = await consumer.get('/customer/me').expect(200);
    expect(me.body).toMatchObject({ companyName: 'Loja Portal A', slug: 'loja-a' });
    expect((await consumer.get('/customer/dashboard').expect(200)).body.customer.name).toBe('Cliente Portal');

    const duplicate = request.agent(app);
    await duplicate.post('/customer/auth/register').set('x-fideliza-request', 'web').send({
      tenantSlug: 'loja-a', name: 'Outro nome', cpf: '52998224725', phone: '11999999999',
      password: 'Cliente@123', acceptTerms: true,
    }).expect(409);

    const otherStore = request.agent(app);
    await otherStore.post('/customer/auth/login').set('x-fideliza-request', 'web').send({
      tenantSlug: 'loja-b', cpf: '52998224725', password: 'Cliente@123',
    }).expect(401);
  });

  it('provisiona o proprietário da plataforma e administra assinaturas', async () => {
    const platform = request.agent(app);
    await platform.post('/platform/auth/login').set('x-fideliza-request', 'web').send({
      email: process.env.PLATFORM_ADMIN_EMAIL,
      password: process.env.PLATFORM_ADMIN_PASSWORD,
    }).expect(200);

    const dashboard = await platform.get('/platform/dashboard').expect(200);
    expect(dashboard.body.kpis.tenants).toBe(2);
    expect(dashboard.body.business).toMatchObject({ tenants: 2, consumers: 1 });
    expect(dashboard.body.operational).toEqual(expect.objectContaining({ availability: expect.any(Number) }));
    expect(dashboard.body.alerts).toHaveLength(4);

    const overview = await platform.get('/platform/overview').expect(200);
    expect(overview.body.companies).toHaveLength(2);
    expect(overview.body.plans.map((plan: { code: string }) => plan.code)).toEqual(
      expect.arrayContaining(['pilot', 'essential', 'growth', 'professional']),
    );
    expect(overview.body).toEqual(expect.objectContaining({ finance: expect.any(Object), monitoring: expect.any(Object) }));

    await platform.patch('/platform/subscriptions/tenant-portal-a').set('x-fideliza-request', 'web').send({
      planCode: 'growth', status: 'active', monthlyPriceCents: 14990, currentPeriodEnd: '2026-09-14',
    }).expect(204);

    const subscription = db.prepare('SELECT plan_code,status,monthly_price_cents FROM subscriptions WHERE tenant_id=?').get('tenant-portal-a');
    expect(subscription).toEqual({ plan_code: 'growth', status: 'active', monthly_price_cents: 14990 });
  });
});
