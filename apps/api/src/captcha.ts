/**
 * Verificação do Cloudflare Turnstile no cadastro público. Sem TURNSTILE_SECRET_KEY o captcha fica
 * desligado (desenvolvimento e testes); com a chave, todo pedido precisa de um token válido.
 */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type CaptchaResult = 'ok' | 'invalid' | 'unavailable';

export function captchaPublicConfig() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  return process.env.TURNSTILE_SECRET_KEY?.trim() && siteKey ? { provider: 'turnstile' as const, siteKey } : null;
}

export async function verifyCaptcha(token: unknown, remoteIp?: string): Promise<CaptchaResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return 'ok';
  if (typeof token !== 'string' || !token || token.length > 2048) return 'invalid';
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const response = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return 'unavailable';
    const result = await response.json() as { success?: boolean };
    return result.success === true ? 'ok' : 'invalid';
  } catch {
    return 'unavailable';
  }
}
