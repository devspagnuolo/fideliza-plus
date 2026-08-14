export type Environment = Record<string, string | undefined>;

function paired(env: Environment, first: string, second: string) {
  if (Boolean(env[first]) !== Boolean(env[second])) throw new Error(`${first} e ${second} devem ser configurados juntos`);
}

export function validateProductionEnvironment(env: Environment) {
  if (env.NODE_ENV !== 'production') return;
  if ((env.SESSION_SECRET ?? '').length < 32) throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres em produção');
  const origin = new URL(env.WEB_ORIGIN ?? '');
  const localOrigin = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !localOrigin) throw new Error('WEB_ORIGIN deve usar HTTPS em produção');
  paired(env, 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');
  paired(env, 'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET');
  if (env.RESEND_API_KEY && !env.EMAIL_FROM) throw new Error('EMAIL_FROM é obrigatório com RESEND_API_KEY');
  const interval = Number(env.WORKER_INTERVAL_MS ?? 15_000);
  if (!Number.isFinite(interval) || interval < 5_000) throw new Error('WORKER_INTERVAL_MS deve ser um número de pelo menos 5000');
}
