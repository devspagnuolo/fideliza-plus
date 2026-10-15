import { describe, expect, it } from 'vitest';
import { validateProductionEnvironment } from './production-config.js';

const valid = { NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32), DATA_ENCRYPTION_KEY:'d'.repeat(48), WEB_ORIGIN: 'https://app.fidelizamais.com.br', WORKER_INTERVAL_MS: '15000' };

describe('configuração de produção', () => {
  it('aceita configuração segura', () => expect(() => validateProductionEnvironment(valid)).not.toThrow());
  it('exige chave de dados independente e com tamanho mínimo',()=>{const{DATA_ENCRYPTION_KEY,...withoutKey}=valid;expect(()=>validateProductionEnvironment(withoutKey)).toThrow(/DATA_ENCRYPTION_KEY/);expect(()=>validateProductionEnvironment({...valid,DATA_ENCRYPTION_KEY:'short'})).toThrow(/DATA_ENCRYPTION_KEY/);});
  it('rejeita segredo curto e origem pública sem HTTPS', () => {
    expect(() => validateProductionEnvironment({ ...valid, SESSION_SECRET: 'curto' })).toThrow(/SESSION_SECRET/);
    expect(() => validateProductionEnvironment({ ...valid, WEB_ORIGIN: 'http://fidelizamais.com.br' })).toThrow(/HTTPS/);
  });
  it('exige credenciais externas completas', () => {
    expect(() => validateProductionEnvironment({ ...valid, BLING_CLIENT_ID: 'id' })).toThrow(/BLING_CLIENT_SECRET/);
    expect(() => validateProductionEnvironment({ ...valid, WHATSAPP_ACCESS_TOKEN: 'token' })).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    expect(() => validateProductionEnvironment({ ...valid, WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_PHONE_NUMBER_ID: 'phone' })).toThrow(/WHATSAPP_PASSWORD_RESET_TEMPLATE/);
    expect(() => validateProductionEnvironment({ ...valid, RESEND_API_KEY: 'key' })).toThrow(/EMAIL_FROM/);
  });
  it('ativa o Asaas real somente com configuração de produção completa', () => {
    expect(() => validateProductionEnvironment({
      ...valid,
      ASAAS_BILLING_ENABLED: 'True',
      ASAAS_ENVIRONMENT: 'Production',
      ASAAS_API_KEY: 'production-key',
      ASAAS_WEBHOOK_TOKEN: 'webhook-token',
    })).not.toThrow();
    expect(() => validateProductionEnvironment({ ...valid, ASAAS_BILLING_ENABLED: 'true', ASAAS_ENVIRONMENT: 'production' })).toThrow(/ASAAS_API_KEY/);
    expect(() => validateProductionEnvironment({
      ...valid,
      ASAAS_BILLING_ENABLED: 'true',
      ASAAS_ENVIRONMENT: 'sandbox',
      ASAAS_API_KEY: 'sandbox-key',
      ASAAS_WEBHOOK_TOKEN: 'webhook-token',
    })).toThrow(/production/);
  });
  it('rejeita política de backup inválida', () => {
    expect(() => validateProductionEnvironment({ ...valid, BACKUP_RETENTION_DAYS: 'zero' })).toThrow(/BACKUP_RETENTION_DAYS/);
    expect(() => validateProductionEnvironment({ ...valid, BACKUP_MAX_FILES: '0' })).toThrow(/BACKUP_MAX_FILES/);
  });
});
