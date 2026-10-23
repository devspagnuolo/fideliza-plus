import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.cwd(), `data/hardening-${randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'hardening-test-secret-with-32-characters';
process.env.PLATFORM_ADMIN_NAME = 'Admin';
process.env.PLATFORM_ADMIN_EMAIL = 'admin@hardening.test';
process.env.PLATFORM_ADMIN_PASSWORD = 'AdminHardening@123';
process.env.ASAAS_ENVIRONMENT = 'sandbox';
process.env.ASAAS_WEBHOOK_TOKEN = 'hardening-webhook-token-with-32-characters';

const { db } = await import('./database/db.js');
await import('./database/migrate.js');
const { app } = await import('./app.js');
const { hashPassword } = await import('./security.js');
const { csvCell } = await import('./csv.js');
const { assertPublicHttpsUrl } = await import('./safe-url.js');
const { decryptBackup, uploadBackupOffsite } = await import('./database/backup-offsite.js');
const { totpCode } = await import('./two-factor.js');

const web = { 'x-fideliza-request': 'web' };
const clearAttempts = () => db.prepare('DELETE FROM platform_access_logs').run();

afterAll(() => { db.close(); for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true }); });

db.prepare("INSERT INTO tenants (id,name,slug,customer_portal_enabled) VALUES ('hard-t','Loja Segura','loja-segura',1)").run();
db.prepare("INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES ('hard-victim','hard-t','Vítima','vitima@hardening.test',?,'owner')").run(hashPassword('SenhaVitima123'));
db.prepare("INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES ('hard-attacker','hard-t','Atacante','atacante@hardening.test',?,'owner')").run(hashPassword('SenhaAtacante1'));

describe('cadastro no portal com CPF já existente', () => {
  const register = (overrides: Record<string, unknown> = {}) => request.agent(app).post('/customer/auth/register').set(web).send({
    tenantSlug: 'loja-segura', name: 'Outra Pessoa', cpf: '529.982.247-25', phone: '11888887777', email: 'outra@evil.test', password: 'OutraSenha123', acceptTerms: true, ...overrides,
  });

  it('exige código enviado ao contato que a loja já tinha antes de entregar a conta', async () => {
    clearAttempts();
    db.prepare("INSERT INTO customers (id,tenant_id,name,email,phone,cpf,points_balance,enrolled_at) VALUES ('hard-c1','hard-t','Maria','maria@hardening.test','11999990000','52998224725',900,CURRENT_TIMESTAMP)").run();
    const pending = await register().expect(202);
    expect(pending.body).toMatchObject({ verificationRequired: true, channel: 'email', destination: 'ma***@hardening.test' });
    expect(db.prepare("SELECT name,email FROM customers WHERE id='hard-c1'").get()).toEqual({ name: 'Maria', email: 'maria@hardening.test' });
    expect(db.prepare("SELECT COUNT(*) total FROM customer_accounts WHERE customer_id='hard-c1'").get()).toEqual({ total: 0 });
    const message = db.prepare("SELECT recipient,message FROM outbound_messages WHERE template='customer.registration_code'").get() as { recipient: string; message: string };
    expect(message.recipient).toBe('maria@hardening.test');
    expect(message.message).toContain(pending.body.developmentCode);

    const wrong = pending.body.developmentCode === '000000' ? '111111' : '000000';
    await register({ verificationCode: wrong }).expect(400);
    expect(db.prepare("SELECT COUNT(*) total FROM customer_accounts WHERE customer_id='hard-c1'").get()).toEqual({ total: 0 });

    const agent = request.agent(app);
    await agent.post('/customer/auth/register').set(web).send({ tenantSlug: 'loja-segura', name: 'Maria Silva', cpf: '52998224725', phone: '11999990000', email: 'maria@hardening.test', password: 'MariaSenha123', acceptTerms: true, verificationCode: pending.body.developmentCode }).expect(201);
    expect((await agent.get('/customer/dashboard').expect(200)).body.customer).toMatchObject({ id: 'hard-c1', name: 'Maria Silva', points_balance: 900 });
  });

  it('recusa quando o cliente não tem contato para confirmar a identidade', async () => {
    clearAttempts();
    db.prepare("INSERT INTO customers (id,tenant_id,name,cpf,enrolled_at) VALUES ('hard-c2','hard-t','Sem Contato','11144477735',CURRENT_TIMESTAMP)").run();
    await register({ cpf: '11144477735' }).expect(409);
    expect(db.prepare("SELECT COUNT(*) total FROM customer_accounts WHERE customer_id='hard-c2'").get()).toEqual({ total: 0 });
  });
});

describe('limites de tentativas', () => {
  it('um login válido em outra conta não libera novas tentativas contra a vítima', async () => {
    clearAttempts();
    const statuses: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (let attempt = 0; attempt < 4; attempt++) statuses.push((await request(app).post('/auth/login').set(web).send({ email: 'vitima@hardening.test', password: `Errada${round}${attempt}xx` })).status);
      await request(app).post('/auth/login').set(web).send({ email: 'atacante@hardening.test', password: 'SenhaAtacante1' });
    }
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses).toContain(429);
  });

  it('variar query string ou prefixo /api/v1 não abre uma janela nova', async () => {
    clearAttempts();
    for (let attempt = 0; attempt < 5; attempt++) await request(app).post(`/auth/login?n=${attempt}`).set(web).send({ email: 'vitima@hardening.test', password: `Errada${attempt}xxxx` }).expect(401);
    await request(app).post('/api/v1/auth/login?n=x').set(web).send({ email: 'vitima@hardening.test', password: 'SenhaVitima123' }).expect(429);
  });

  it('limita pedidos de recuperação de senha por conta', async () => {
    clearAttempts();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) statuses.push((await request(app).post('/auth/forgot-password').set(web).send({ email: 'vitima@hardening.test' })).status);
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it('limita códigos de recuperação incorretos', async () => {
    clearAttempts();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) statuses.push((await request(app).post('/auth/reset-password-code').set(web).send({ email: 'vitima@hardening.test', phone: '11999990000', code: String(100000 + attempt), password: 'NovaSenha12345' })).status);
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe('painel da plataforma', () => {
  it('bloqueia rotas administrativas até o MFA ser ativado quando ele é obrigatório', async () => {
    clearAttempts();
    process.env.PLATFORM_ADMIN_MFA_REQUIRED = 'true';
    try {
      const admin = request.agent(app);
      await admin.post('/platform/auth/login').set(web).send({ email: 'admin@hardening.test', password: 'AdminHardening@123' }).expect(200);
      expect((await admin.get('/platform/me').expect(200)).body).toMatchObject({ twoFactorEnabled: false, mfaRequired: true });
      expect((await admin.get('/platform/overview').expect(403)).body.code).toBe('PLATFORM_MFA_REQUIRED');
      await admin.get('/platform/asaas/status').expect(403);
      const setup = await admin.post('/platform/me/security/2fa/setup').set(web).send({}).expect(200);
      await admin.post('/platform/me/security/2fa/confirm').set(web).send({ code: totpCode(setup.body.secret) }).expect(204);
      await admin.get('/platform/overview').expect(200);
    } finally { delete process.env.PLATFORM_ADMIN_MFA_REQUIRED; }
  });
});

describe('demais correções', () => {
  it('neutraliza fórmulas em células CSV', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('-10')).toBe('"\'-10"');
    expect(csvCell('Maria')).toBe('"Maria"');
  });

  it('recusa URLs internas no teste de conector', async () => {
    await expect(assertPublicHttpsUrl('http://example.com')).rejects.toThrow();
    await expect(assertPublicHttpsUrl('https://169.254.169.254/latest')).rejects.toThrow();
    await expect(assertPublicHttpsUrl('https://10.0.0.5')).rejects.toThrow();
    await expect(assertPublicHttpsUrl('https://[::1]/')).rejects.toThrow();
    await expect(assertPublicHttpsUrl('https://interno.test', (async () => [{ address: '192.168.0.10', family: 4 }]) as never)).rejects.toThrow();
    await expect(assertPublicHttpsUrl('https://erp.test', (async () => [{ address: '8.8.8.8', family: 4 }]) as never)).resolves.toBeInstanceOf(URL);
  });

  it('reprocessa um webhook do Asaas que falhou quando o Asaas reenviar', async () => {
    const payload = { id: 'evt_retry_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_retry_1', status: 'RECEIVED', value: 99, externalReference: 'hard-sub', dueDate: '2026-11-01' } };
    await request(app).post('/webhooks/asaas').set('asaas-access-token', process.env.ASAAS_WEBHOOK_TOKEN!).send(payload).expect(422);
    expect(db.prepare("SELECT COUNT(*) total FROM invoices WHERE external_payment_id='pay_retry_1'").get()).toEqual({ total: 0 });
    db.prepare("INSERT INTO subscriptions(id,tenant_id,plan_code,status,monthly_price_cents,current_period_end,payment_method,billing_day,gateway) VALUES('hard-sub','hard-t','essential','past_due',9900,date('now'),'boleto',10,'asaas')").run();
    const retried = await request(app).post('/webhooks/asaas').set('asaas-access-token', process.env.ASAAS_WEBHOOK_TOKEN!).send(payload).expect(200);
    expect(retried.body).toMatchObject({ duplicate: false, status: 'paid' });
    expect(db.prepare("SELECT status FROM subscriptions WHERE id='hard-sub'").get()).toEqual({ status: 'active' });
    expect((await request(app).post('/webhooks/asaas').set('asaas-access-token', process.env.ASAAS_WEBHOOK_TOKEN!).send(payload).expect(200)).body).toEqual({ duplicate: true });
  });

  it('não repete o teste grátis para o mesmo CNPJ', async () => {
    db.prepare("INSERT INTO public_trial_signups(id,tenant_id,plan_code,company_name,cnpj,email,responsible_name,phone) VALUES('hard-trial','hard-t','essential','Loja Segura','11222333000181','loja@hardening.test','Resp','11999990000')").run();
    const plans = (await request(app).get('/public/plans').expect(200)).body;
    const planCode = (Array.isArray(plans) ? plans : plans.plans)[0].code;
    const response = await request(app).post('/public/trials').set(web).send({
      planCode, companyName: 'Loja Repetida', legalName: 'Loja Repetida Ltda', cnpj: '11.222.333/0001-81', email: 'nova@hardening.test', phone: '11999990000', responsibleName: 'Resp', password: 'SenhaForte123',
      postalCode: '01001000', address: 'Rua A', addressNumber: '1', district: 'Centro', city: 'São Paulo', state: 'SP', paymentMethod: 'boleto', acceptTerms: true, acceptContract: true, minimumTermConsent: true, billingConsent: true,
    });
    expect(response.status).toBe(409);
    expect(db.prepare("SELECT COUNT(*) total FROM tenants WHERE name='Loja Repetida'").get()).toEqual({ total: 0 });
  });

});

describe('teste grátis com captcha e confirmação de e-mail', () => {
  const trial = (overrides: Record<string, unknown> = {}) => request(app).post('/public/trials').set(web).send({
    planCode: 'essential', companyName: 'Loja Confirmada', legalName: 'Loja Confirmada Ltda', cnpj: '45.723.174/0001-10', email: 'dona@confirmada.test', phone: '11977770000', responsibleName: 'Dona',
    password: 'SenhaForte123', postalCode: '01001000', address: 'Rua B', addressNumber: '2', district: 'Centro', city: 'São Paulo', state: 'SP', paymentMethod: 'boleto',
    acceptTerms: true, acceptContract: true, minimumTermConsent: true, billingConsent: true, ...overrides,
  });
  const requestCode = (body: Record<string, unknown>) => request(app).post('/public/trials/email-code').set(web).send(body);

  it('só cria o ambiente depois que o código enviado ao e-mail é confirmado', async () => {
    db.prepare('DELETE FROM trial_email_codes').run();
    expect((await trial().expect(400)).body.code).toBe('EMAIL_CODE_REQUIRED');
    const sent = await requestCode({ email: 'Dona@Confirmada.test' }).expect(202);
    expect(sent.body).toMatchObject({ destination: 'do***@confirmada.test', expiresInMinutes: 30 });
    const message = db.prepare("SELECT recipient,message FROM outbound_messages WHERE template='trial.email_code'").get() as { recipient: string; message: string };
    expect(message.recipient).toBe('dona@confirmada.test');
    expect(message.message).toContain(sent.body.developmentCode);
    expect(db.prepare('SELECT code_hash FROM trial_email_codes').get()).not.toEqual({ code_hash: sent.body.developmentCode });

    const wrong = sent.body.developmentCode === '000000' ? '111111' : '000000';
    expect((await trial({ emailCode: wrong }).expect(400)).body.code).toBe('EMAIL_CODE_INVALID');
    expect((await trial({ email: 'outra@confirmada.test', emailCode: sent.body.developmentCode }).expect(400)).body.code).toBe('EMAIL_CODE_INVALID');
    expect(db.prepare("SELECT COUNT(*) total FROM tenants WHERE name='Loja Confirmada'").get()).toEqual({ total: 0 });

    await trial({ emailCode: sent.body.developmentCode }).expect(201);
    expect(db.prepare("SELECT COUNT(*) total FROM tenants WHERE name='Loja Confirmada'").get()).toEqual({ total: 1 });
    expect((await trial({ cnpj: '11.444.777/0001-61', emailCode: sent.body.developmentCode }).expect(400)).body.code).toBe('EMAIL_CODE_INVALID');
    await requestCode({ email: 'dona@confirmada.test' }).expect(409);
  });

  it('bloqueia o código após 5 tentativas erradas e limita novos pedidos', async () => {
    db.prepare('DELETE FROM trial_email_codes').run();
    const sent = await requestCode({ email: 'tentativas@confirmada.test' }).expect(202);
    const wrong = sent.body.developmentCode === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) await trial({ email: 'tentativas@confirmada.test', cnpj: '19.131.243/0001-97', emailCode: wrong }).expect(400);
    await trial({ email: 'tentativas@confirmada.test', cnpj: '19.131.243/0001-97', emailCode: sent.body.developmentCode }).expect(400);
    await requestCode({ email: 'tentativas@confirmada.test' }).expect(202);
    await requestCode({ email: 'tentativas@confirmada.test' }).expect(202);
    await requestCode({ email: 'tentativas@confirmada.test' }).expect(429);
  });

  it('exige o Turnstile quando as chaves estão configuradas', async () => {
    db.prepare('DELETE FROM trial_email_codes').run();
    process.env.TURNSTILE_SITE_KEY = '0x4AAAAAAA-site';
    process.env.TURNSTILE_SECRET_KEY = '0x4AAAAAAA-secret';
    const calls: URLSearchParams[] = [];
    let outcome: 'success' | 'fail' | 'down' = 'fail';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      calls.push(new URLSearchParams(String(init?.body)));
      if (outcome === 'down') throw new Error('timeout');
      return new Response(JSON.stringify({ success: outcome === 'success' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      expect((await request(app).get('/public/plans').expect(200)).body.captcha).toEqual({ provider: 'turnstile', siteKey: '0x4AAAAAAA-site' });
      expect((await requestCode({ email: 'robo@captcha.test' }).expect(400)).body.code).toBe('CAPTCHA_INVALID');
      expect(calls).toHaveLength(0);
      expect((await requestCode({ email: 'robo@captcha.test', captchaToken: 'token-falso' }).expect(400)).body.code).toBe('CAPTCHA_INVALID');
      outcome = 'down';
      expect((await requestCode({ email: 'robo@captcha.test', captchaToken: 'token' }).expect(503)).body.code).toBe('CAPTCHA_UNAVAILABLE');
      expect(db.prepare('SELECT COUNT(*) total FROM trial_email_codes').get()).toEqual({ total: 0 });
      outcome = 'success';
      await requestCode({ email: 'humano@captcha.test', captchaToken: 'token-valido' }).expect(202);
      expect(calls.at(-1)?.get('secret')).toBe('0x4AAAAAAA-secret');
      expect(calls.at(-1)?.get('response')).toBe('token-valido');
    } finally {
      fetchMock.mockRestore();
      delete process.env.TURNSTILE_SITE_KEY;
      delete process.env.TURNSTILE_SECRET_KEY;
    }
  });
});

describe('backup externo', () => {
  it('envia o backup criptografado ao armazenamento externo compatível com S3', async () => {
    const received: { url?: string; auth?: string; body: Buffer[] } = { body: [] };
    const server = createServer((req, res) => { received.url = req.url; received.auth = String(req.headers.authorization); req.on('data', chunk => received.body.push(chunk)); req.on('end', () => { res.writeHead(200); res.end(); }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port, file = `${databasePath}.copy`;
    fs.writeFileSync(file, 'conteudo-do-banco');
    try {
      const result = await uploadBackupOffsite(file, { endpoint: `http://127.0.0.1:${port}`, bucket: 'backups', region: 'auto', accessKeyId: 'key', secretAccessKey: 'secret', prefix: 'fidelizei/', encryptionKey: 'chave-de-backup-com-mais-de-32-caracteres' });
      expect(result).toMatchObject({ key: `fidelizei/${path.basename(file)}.gz.enc` });
      expect(received.url).toBe(`/backups/fidelizei/${path.basename(file)}.gz.enc`);
      expect(received.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/auto\/s3\/aws4_request/);
      const uploaded = Buffer.concat(received.body);
      expect(uploaded.toString()).not.toContain('conteudo-do-banco');
      expect(decryptBackup(uploaded, 'chave-de-backup-com-mais-de-32-caracteres').toString()).toBe('conteudo-do-banco');
    } finally { server.close(); fs.rmSync(file, { force: true }); }
  });
});
