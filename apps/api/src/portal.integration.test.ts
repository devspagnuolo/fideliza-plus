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
    db.prepare('INSERT INTO tenants (id,name,slug,customer_portal_enabled) VALUES (?,?,?,1)').run('tenant-portal-a', 'Loja Portal A', 'loja-a');
    db.prepare('INSERT INTO tenants (id,name,slug,customer_portal_enabled) VALUES (?,?,?,1)').run('tenant-portal-b', 'Loja Portal B', 'loja-b');
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('oferece somente programas de lojas disponíveis no seletor público', async () => {
    const stores = await request(app).get('/customer/stores').expect(200);
    expect(stores.body.map((store: { slug: string }) => store.slug)).toEqual(expect.arrayContaining(['loja-a', 'loja-b']));
    db.prepare("UPDATE tenants SET login_blocked=1 WHERE id='tenant-portal-b'").run();
    const available = await request(app).get('/customer/stores?search=Loja').expect(200);
    expect(available.body.map((store: { slug: string }) => store.slug)).toEqual(['loja-a']);
    await request(app).get('/customer/store/loja-b').expect(404);
    db.prepare("UPDATE tenants SET login_blocked=0 WHERE id='tenant-portal-b'").run();
    db.prepare("UPDATE tenants SET customer_portal_enabled=0 WHERE id='tenant-portal-b'").run();
    const unpublished = await request(app).get('/customer/stores').expect(200);
    expect(unpublished.body.map((store: { slug: string }) => store.slug)).not.toContain('loja-b');
    await request(app).get('/customer/store/loja-b').expect(404);
    db.prepare("UPDATE tenants SET customer_portal_enabled=1 WHERE id='tenant-portal-b'").run();
  });

  it('cadastra o consumidor na loja correta e isola sua sessão', async () => {
    await request(app).post('/customer/auth/register').send({
      tenantSlug: 'loja-a', name: 'Sem e-mail', cpf: '11144477735', phone: '11999999999',
      password: 'Cliente@123', acceptTerms: true,
    }).expect(400);
    const consumer = request.agent(app);
    await consumer.post('/customer/auth/register').set('x-fideliza-request', 'web').send({
      tenantSlug: 'loja-a',
      name: 'Cliente Portal',
      cpf: '529.982.247-25',
      phone: '(11) 99999-9999',
      email: 'cliente@portal.test',
      password: '  Cliente@123  ',
      acceptTerms: true,
    }).expect(201);

    const me = await consumer.get('/customer/me').expect(200);
    expect(me.body).toMatchObject({ companyName: 'Loja Portal A', slug: 'loja-a' });
    expect((await consumer.get('/customer/dashboard').expect(200)).body.customer.name).toBe('Cliente Portal');

    // O cadastro abre uma sessão automaticamente, portanto validamos também
    // um novo login sem cookies para garantir que a senha digitada foi persistida corretamente.
    const freshLogin = request.agent(app);
    await freshLogin.post('/customer/auth/login').set('x-fideliza-request', 'web').send({
      tenantSlug: 'loja-a', cpf: '52998224725', password: 'Cliente@123',
    }).expect(200);
    expect((await freshLogin.get('/customer/me').expect(200)).body.customerId).toBe(me.body.customerId);
    expect(db.prepare("SELECT status FROM outbound_messages WHERE tenant_id='tenant-portal-a' AND template='customer.welcome'").get()).toEqual({ status: 'queued' });
    expect(db.prepare("SELECT document_version,privacy_version,source FROM customer_consents WHERE tenant_id='tenant-portal-a' AND purpose='loyalty'").get()).toEqual({ document_version: '2026-08-22', privacy_version: '2026-08-22', source: 'customer_portal' });

    const customerId = me.body.customerId;
    db.prepare('UPDATE customers SET points_balance=500 WHERE id=?').run(customerId);
    db.prepare(`INSERT INTO sales (id,tenant_id,customer_id,total_cents,occurred_at,source,order_number)
      VALUES ('sale-portal','tenant-portal-a',?,15990,CURRENT_TIMESTAMP,'site','PED-1001')`).run(customerId);
    db.prepare(`INSERT INTO loyalty_ledger (id,tenant_id,customer_id,sale_id,points,reason,entry_type)
      VALUES ('ledger-portal','tenant-portal-a',?,'sale-portal',160,'Compra PED-1001','earn')`).run(customerId);
    db.prepare(`INSERT INTO rewards (id,tenant_id,name,description,points_cost,stock)
      VALUES ('reward-portal','tenant-portal-a','Cupom de teste','Benefício do portal',200,3)`).run();

    expect((await consumer.get('/customer/purchases?search=PED-1001').expect(200)).body.items[0]).toMatchObject({ order_number: 'PED-1001', source: 'site' });
    expect((await consumer.get('/customer/ledger?type=earn').expect(200)).body.items[0].points).toBe(160);
    await consumer.post('/customer/rewards/reward-portal/redeem').set('x-fideliza-request', 'web').expect(201);
    expect((db.prepare('SELECT points_balance FROM customers WHERE id=?').get(customerId) as {points_balance:number}).points_balance).toBe(300);
    await consumer.patch('/customer/profile').set('x-fideliza-request', 'web').send({name:'Cliente Atualizado',email:'novo@portal.test',phone:'11988887777',birthDate:'1990-01-02',city:'São Paulo',state:'SP'}).expect(204);
    await consumer.put('/customer/preferences').set('x-fideliza-request', 'web').send({marketing:true}).expect(204);
    await consumer.post('/customer/support').set('x-fideliza-request', 'web').send({subject:'Dúvida de pontos',message:'Preciso conferir meus pontos da compra.',category:'points'}).expect(201);
    expect((await consumer.get('/customer/data-export').expect(200)).body).toEqual(expect.objectContaining({profile:expect.any(Object),purchases:expect.any(Array),points:expect.any(Array)}));

    const duplicate = request.agent(app);
    await duplicate.post('/customer/auth/register').set('x-fideliza-request', 'web').send({
      tenantSlug: 'loja-a', name: 'Outro nome', cpf: '52998224725', phone: '11999999999',
      email: 'outro@portal.test', password: 'Cliente@123', acceptTerms: true,
    }).expect(409);

    const otherStore = request.agent(app);
    await otherStore.post('/customer/auth/login').set('x-fideliza-request', 'web').send({
      tenantSlug: 'loja-b', cpf: '52998224725', password: 'Cliente@123',
    }).expect(401);

    const unknownRecovery = await request(app).post('/customer/auth/forgot-password').send({
      tenantSlug: 'loja-a', cpf: '11144477735', email: 'nao-existe@portal.test',
    }).expect(202);
    expect(unknownRecovery.body).toEqual({
      channel: 'email',
      message: 'Se os dados estiverem cadastrados, enviaremos um link por e-mail válido por 30 minutos.',
    });

    const recovery = await request(app).post('/customer/auth/forgot-password').send({
      tenantSlug: 'loja-a', cpf: '529.982.247-25', email: 'novo@portal.test',
    }).expect(202);
    expect(recovery.body.developmentToken).toEqual(expect.any(String));
    const queuedReset = db.prepare("SELECT status,message FROM outbound_messages WHERE tenant_id='tenant-portal-a' AND template='customer.password_reset'").get() as {status:string;message:string};
    expect(queuedReset.status).toBe('queued');
    expect(queuedReset.message).toContain('/cliente/loja-a/recuperar?token=');

    await request(app).post('/customer/auth/reset-password').send({
      token: recovery.body.developmentToken, password: 'NovaCliente123',
    }).expect(204);
    await consumer.get('/customer/me').expect(401);
    await request(app).post('/customer/auth/reset-password').send({
      token: recovery.body.developmentToken, password: 'OutraSenha123',
    }).expect(400);
    await request(app).post('/customer/auth/login').send({
      tenantSlug: 'loja-a', cpf: '52998224725', password: 'Cliente@123',
    }).expect(401);
    await request(app).post('/customer/auth/login').send({
      tenantSlug: 'loja-a', cpf: '52998224725', password: 'NovaCliente123',
    }).expect(200);

    const whatsappRecovery = await request(app).post('/customer/auth/forgot-password').send({
      tenantSlug: 'loja-a', cpf: '529.982.247-25', channel: 'whatsapp',
      phone: '11988887777', consentWhatsApp: true,
    }).expect(202);
    expect(whatsappRecovery.body).toMatchObject({ channel: 'whatsapp', developmentToken: expect.stringMatching(/^\d{6}$/) });
    expect(db.prepare("SELECT channel,status,recipient FROM outbound_messages WHERE tenant_id='tenant-portal-a' AND template='customer.password_reset_otp'").get()).toEqual({
      channel: 'whatsapp', status: 'queued', recipient: '11988887777',
    });
    expect(db.prepare("SELECT granted,source FROM customer_consents WHERE tenant_id='tenant-portal-a' AND purpose='security_whatsapp' ORDER BY created_at DESC LIMIT 1").get()).toEqual({ granted: 1, source: 'password_recovery' });
    await request(app).post('/customer/auth/reset-password-code').send({
      tenantSlug: 'loja-a', cpf: '52998224725', code: '000000', password: 'SenhaWhatsApp123',
    }).expect(400);
    await request(app).post('/customer/auth/reset-password-code').send({
      tenantSlug: 'loja-a', cpf: '52998224725', code: whatsappRecovery.body.developmentToken, password: 'SenhaWhatsApp123',
    }).expect(204);
    await request(app).post('/customer/auth/login').send({
      tenantSlug: 'loja-a', cpf: '52998224725', password: 'NovaCliente123',
    }).expect(401);
    await request(app).post('/customer/auth/login').send({
      tenantSlug: 'loja-a', cpf: '52998224725', password: 'SenhaWhatsApp123',
    }).expect(200);

    db.prepare("UPDATE tenants SET login_blocked=1 WHERE id='tenant-portal-a'").run();
    await consumer.get('/customer/me').expect(401);
    db.prepare("UPDATE tenants SET login_blocked=0 WHERE id='tenant-portal-a'").run();
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

    const created = await platform.post('/platform/modules/security/lgpd').set('x-fideliza-request', 'web').send({
      title: 'Solicitação de acesso do titular', tenantId: 'tenant-portal-a', status: 'pending', priority: 'high',
      owner: 'Encarregado LGPD', dueAt: '2026-09-01', payload: { Titular: 'Cliente Portal', Canal: 'Portal' },
    }).expect(201);
    const moduleView = await platform.get('/platform/modules/security/lgpd').expect(200);
    expect(moduleView.body.summary).toMatchObject({ total: 1, active: 1 });
    expect(moduleView.body.records[0]).toMatchObject({ id: created.body.id, companyName: 'Loja Portal A', priority: 'high' });
    const exported = await platform.get('/platform/modules/security/lgpd/export').expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain('Solicitação de acesso do titular');
    await platform.patch(`/platform/modules/security/lgpd/${created.body.id}`).set('x-fideliza-request', 'web').send({
      title: 'Solicitação concluída', tenantId: 'tenant-portal-a', status: 'resolved', priority: 'medium',
      owner: 'Encarregado LGPD', dueAt: null, payload: { Titular: 'Cliente Portal', Resultado: 'Entregue' },
    }).expect(204);
    await platform.delete(`/platform/modules/security/lgpd/${created.body.id}`).set('x-fideliza-request', 'web').expect(204);
    expect((await platform.get('/platform/modules/security/lgpd').expect(200)).body.records).toHaveLength(0);

    const ticket = await platform.post('/platform/support/tickets').set('x-fideliza-request', 'web').send({
      tenantId: 'tenant-portal-a', subject: 'Falha na integração', description: 'Sincronização precisa de análise.',
      priority: 'high', assignedTo: 'Suporte N2', slaDueAt: '2026-08-21T12:00:00',
    }).expect(201);
    await platform.patch(`/platform/support/tickets/${ticket.body.id}`).set('x-fideliza-request', 'web').send({
      status: 'resolved', priority: 'high', assignedTo: 'Suporte N2', slaDueAt: '2026-08-21T12:00:00',
    }).expect(204);
    expect(db.prepare('SELECT status,resolved_at FROM support_tickets WHERE id=?').get(ticket.body.id)).toEqual(
      expect.objectContaining({ status: 'resolved', resolved_at: expect.any(String) }),
    );

    const incident = await platform.post('/platform/incidents').set('x-fideliza-request', 'web').send({
      title: 'Latência elevada', description: 'API acima do limite operacional.', severity: 'critical',
    }).expect(201);
    await platform.patch(`/platform/incidents/${incident.body.id}`).set('x-fideliza-request', 'web').send({
      status: 'resolved', severity: 'high', description: 'Capacidade normalizada e monitorada.',
    }).expect(204);
    expect(db.prepare('SELECT status,resolved_at FROM platform_incidents WHERE id=?').get(incident.body.id)).toEqual(
      expect.objectContaining({ status: 'resolved', resolved_at: expect.any(String) }),
    );

    await platform.patch('/platform/settings').set('x-fideliza-request', 'web').send({
      'branding.primary': '#0b2b5b', 'feature.customer_portal': 'true',
    }).expect(204);
    expect(db.prepare("SELECT value FROM global_settings WHERE key='branding.primary'").get()).toEqual({ value: '#0b2b5b' });

    await platform.patch('/platform/plans/essential').set('x-fideliza-request', 'web').send({
      name: 'Essencial', monthlyPriceCents: 10900, userLimit: 6, consumerLimit: 6000, storageMb: 1024, active: true,
    }).expect(204);
    expect(db.prepare("SELECT monthly_price_cents,user_limit FROM platform_plans WHERE code='essential'").get()).toEqual({
      monthly_price_cents: 10900, user_limit: 6,
    });

    db.prepare("INSERT INTO jobs(id,tenant_id,type,status,error,attempts) VALUES('job-retry','tenant-portal-a','sync_bling','failed','timeout',3)").run();
    const system = await platform.get('/platform/system').expect(200);
    expect(system.body).toEqual(expect.objectContaining({ jobs: expect.any(Array), connectors: expect.any(Array), sessions: expect.any(Array) }));
    await platform.post('/platform/jobs/job-retry/retry').set('x-fideliza-request', 'web').expect(202);
    expect(db.prepare("SELECT status,error FROM jobs WHERE id='job-retry'").get()).toEqual({ status: 'queued', error: null });

    await platform.put('/platform/me/profile').set('x-fideliza-request', 'web').send({
      name: 'Administrador Atualizado', email: 'contato@fideliza.test',
      currentPassword: process.env.PLATFORM_ADMIN_PASSWORD, newPassword: 'NovaSenha@1234',
    }).expect(200);
    expect(db.prepare("SELECT name,email FROM platform_admins WHERE email='contato@fideliza.test'").get()).toEqual({
      name: 'Administrador Atualizado', email: 'contato@fideliza.test',
    });

    const reset = await platform.post('/platform/companies/tenant-portal-a/homologation-reset').set('x-fideliza-request', 'web').send({
      confirmation: 'REINICIAR loja-a', adminName: 'Nova Gestora', adminEmail: 'nova.gestora@loja.test', temporaryPassword: 'Temporaria@123',
    }).expect(200);
    expect(reset.body).toMatchObject({ ok: true, company: 'Loja Portal A', removed: { customers: 1, sales: 1 } });
    expect(db.prepare("SELECT COUNT(*) total FROM customers WHERE tenant_id='tenant-portal-a'").get()).toEqual({ total: 0 });
    expect(db.prepare("SELECT name,email,role FROM users WHERE tenant_id='tenant-portal-a'").get()).toEqual({ name: 'Nova Gestora', email: 'nova.gestora@loja.test', role: 'owner' });
    expect(db.prepare("SELECT email FROM platform_admins WHERE email='contato@fideliza.test'").get()).toEqual({ email: 'contato@fideliza.test' });
  });
});
