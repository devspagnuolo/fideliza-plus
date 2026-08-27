export type Environment = Record<string, string | undefined>;

function paired(env: Environment, first: string, second: string) {
  if (Boolean(env[first]) !== Boolean(env[second])) throw new Error(`${first} e ${second} devem ser configurados juntos`);
}

export function validateProductionEnvironment(env: Environment) {
  if (env.NODE_ENV !== 'production') return;
  if ((env.SESSION_SECRET ?? '').length < 32) throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres em produção');
  const origins = (env.WEB_ORIGIN ?? '').split(',').map(value => new URL(value.trim()));
  if (!origins.length || origins.some(origin => origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('WEB_ORIGIN deve usar HTTPS em produção');
  paired(env, 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');
  if (env.WHATSAPP_ACCESS_TOKEN && !env.WHATSAPP_PASSWORD_RESET_TEMPLATE) throw new Error('WHATSAPP_PASSWORD_RESET_TEMPLATE é obrigatório com WhatsApp');
  paired(env, 'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET');
  if (env.RESEND_API_KEY && !env.EMAIL_FROM) throw new Error('EMAIL_FROM é obrigatório com RESEND_API_KEY');
  if (env.ASAAS_API_KEY && !env.ASAAS_WEBHOOK_TOKEN) throw new Error('ASAAS_WEBHOOK_TOKEN é obrigatório com ASAAS_API_KEY');
  if (env.ASAAS_ENVIRONMENT && !['sandbox', 'production'].includes(env.ASAAS_ENVIRONMENT)) throw new Error('ASAAS_ENVIRONMENT deve ser sandbox ou production');
  const interval = Number(env.WORKER_INTERVAL_MS ?? 15_000);
  if (!Number.isFinite(interval) || interval < 5_000) throw new Error('WORKER_INTERVAL_MS deve ser um número de pelo menos 5000');
  const backupNumbers: Array<[string, string]> = [['BACKUP_INTERVAL_HOURS', '24'], ['BACKUP_RETENTION_DAYS', '30'], ['BACKUP_MAX_FILES', '30']];
  for (const [name, fallback] of backupNumbers) {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} deve ser um número inteiro positivo`);
  }
}
