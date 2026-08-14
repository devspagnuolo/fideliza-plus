import { describe, expect, it } from 'vitest';
import { validateProductionEnvironment } from './production-config.js';

const valid = { NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32), WEB_ORIGIN: 'https://app.fidelizamais.com.br', WORKER_INTERVAL_MS: '15000' };

describe('configuração de produção', () => {
  it('aceita configuração segura', () => expect(() => validateProductionEnvironment(valid)).not.toThrow());
  it('rejeita segredo curto e origem pública sem HTTPS', () => {
    expect(() => validateProductionEnvironment({ ...valid, SESSION_SECRET: 'curto' })).toThrow(/SESSION_SECRET/);
    expect(() => validateProductionEnvironment({ ...valid, WEB_ORIGIN: 'http://fidelizamais.com.br' })).toThrow(/HTTPS/);
  });
  it('exige credenciais externas completas', () => {
    expect(() => validateProductionEnvironment({ ...valid, BLING_CLIENT_ID: 'id' })).toThrow(/BLING_CLIENT_SECRET/);
    expect(() => validateProductionEnvironment({ ...valid, WHATSAPP_ACCESS_TOKEN: 'token' })).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    expect(() => validateProductionEnvironment({ ...valid, RESEND_API_KEY: 'key' })).toThrow(/EMAIL_FROM/);
  });
  it('rejeita política de backup inválida', () => {
    expect(() => validateProductionEnvironment({ ...valid, BACKUP_RETENTION_DAYS: 'zero' })).toThrow(/BACKUP_RETENTION_DAYS/);
    expect(() => validateProductionEnvironment({ ...valid, BACKUP_MAX_FILES: '0' })).toThrow(/BACKUP_MAX_FILES/);
  });
});
