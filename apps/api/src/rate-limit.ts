import type { NextFunction, Request, Response } from 'express';
import { db } from './database/db.js';

function normalize(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : trimmed.replace(/\D/g, '') || trimmed;
}

function identities(req: Request, values?: unknown[]) {
  return [...new Set((values ?? [req.body?.email, req.body?.cpf]).map(normalize).filter(Boolean))];
}

function userType(req: Request): 'platform' | 'company' | 'customer' {
  const path = req.originalUrl || req.path;
  if (path.includes('/platform/')) return 'platform';
  if (path.includes('/customer/')) return 'customer';
  return 'company';
}

function configuredLimit() {
  try {
    const row = db.prepare("SELECT value FROM global_settings WHERE key='security.lock_attempts'").get() as { value: string } | undefined;
    const value = Number(row?.value || 5);
    return Number.isInteger(value) ? Math.min(10, Math.max(3, value)) : 5;
  } catch {
    return 5;
  }
}

/** Normaliza a rota para que prefixo /api/v1 ou query string não criem janelas separadas. */
export function rateLimitRoute(url: string) {
  return (url.split('?')[0] || '/').replace(/^\/api\/v1(?=\/)/, '').replace(/\/+$/, '').slice(0, 200) || '/';
}

const IP_LIMIT_FACTOR = 4;

/**
 * Persiste a janela no banco, sobrevivendo a deploys e a processos que compartilham a mesma base.
 * O limite por identidade só é zerado por um sucesso da própria identidade; o teto por IP nunca é
 * zerado por sucesso, para que um login válido em outra conta não libere novas tentativas.
 */
export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  try {
    const type = userType(req), subjects = identities(req), ip = req.ip ?? '', route = rateLimitRoute(req.originalUrl || req.path), limit = configuredLimit();
    let blocked = false;
    if (subjects.length) {
      const placeholders = subjects.map(() => '?').join(',');
      const row = db.prepare(`SELECT COUNT(*) count FROM platform_access_logs failed
        WHERE failed.success=0 AND failed.user_type=? AND failed.route=? AND failed.created_at>=datetime('now','-15 minutes')
          AND lower(failed.user_id) IN (${placeholders})
          AND failed.rowid>COALESCE((SELECT MAX(success.rowid) FROM platform_access_logs success
            WHERE success.success=1 AND success.user_type=? AND success.route=? AND lower(success.user_id) IN (${placeholders})),0)`).get(type, route, ...subjects, type, route, ...subjects) as { count: number };
      blocked = row.count >= limit;
    }
    if (!blocked && ip) {
      const row = db.prepare(`SELECT COUNT(*) count FROM platform_access_logs
        WHERE success=0 AND user_type=? AND route=? AND ip=? AND created_at>=datetime('now','-15 minutes')`).get(type, route, ip) as { count: number };
      blocked = row.count >= limit * IP_LIMIT_FACTOR;
    }
    if (blocked) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.', retryAfterSeconds: 900 });
    }
  } catch (error) {
    console.error('Rate limit persistente indisponivel', (error as Error).message);
  }
  next();
}

/** Conta pedidos de recuperação e códigos incorretos na mesma janela do login, sem gerar alerta de ataque. */
export function recordRateLimitedAttempt(req: Request, subject: unknown, reason: string) {
  const normalized = normalize(subject);
  if (!normalized) return;
  try {
    db.prepare(`INSERT INTO platform_access_logs(id,user_type,user_id,success,ip,user_agent,reason,route)
      VALUES(lower(hex(randomblob(16))),?,?,0,?,?,?,?)`).run(userType(req), normalized.slice(0, 160), req.ip ?? null, String(req.header('user-agent') ?? '').slice(0, 500) || null, reason.slice(0, 300), rateLimitRoute(req.originalUrl || req.path));
  } catch {}
}

export function clearLoginRateLimit(req: Request, values?: unknown[], path?: string) {
  const subject = identities(req, values)[0] || 'rate-limit-reset';
  try {
    db.prepare(`INSERT INTO platform_access_logs(id,user_type,user_id,success,ip,user_agent,reason,route)
      VALUES(lower(hex(randomblob(16))),?,?,1,?,?, 'rate_limit_reset',?)`).run(userType(req), subject, req.ip ?? null, String(req.header('user-agent') ?? '').slice(0, 500) || null, rateLimitRoute(path || req.originalUrl || req.path));
  } catch {}
}
