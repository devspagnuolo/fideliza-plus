import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.cwd(), `data/outbound-${randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'outbound-test-secret-with-32-characters';
process.env.RESEND_API_KEY = 're_test_key';
process.env.EMAIL_FROM = 'Fideliza Plus <contato@fidelizaplus.com.br>';
const { db } = await import('./database/db.js');
await import('./database/migrate.js');
const { processOutboundMessages } = await import('./outbound-delivery.js');

describe('entrega de mensagens transacionais', () => {
  beforeAll(() => {
    db.prepare('INSERT INTO tenants(id,name,slug)VALUES(?,?,?)').run('outbound-tenant', 'Loja Teste', 'loja-teste');
  });
  afterAll(() => {
    vi.restoreAllMocks();
    db.close();
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });
  it('envia pelo Resend, usa idempotência e registra o identificador externo', async () => {
    db.prepare("INSERT INTO outbound_messages(id,tenant_id,recipient,channel,template,subject,message,scheduled_at)VALUES(?,?,?,'email','customer.welcome',?,?,CURRENT_TIMESTAMP)")
      .run('welcome-1', 'outbound-tenant', 'cliente@example.com', 'Bem-vindo à Loja Teste', 'Mensagem de boas-vindas');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'email-resend-1' }), { status: 200 }));
    expect(await processOutboundMessages()).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      headers: expect.objectContaining({ 'idempotency-key': 'welcome-1' }),
    }));
    expect(db.prepare("SELECT status,external_id,attempts FROM outbound_messages WHERE id='welcome-1'").get()).toEqual({
      status: 'sent', external_id: 'email-resend-1', attempts: 1,
    });
  });
});
