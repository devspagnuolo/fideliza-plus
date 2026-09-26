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

/** Persiste a janela no banco, sobrevivendo a deploys e a processos que compartilham a mesma base. */
export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  try {
    const type = userType(req), subjects = identities(req), ip = req.ip ?? '', route = (req.originalUrl || req.path).slice(0, 200);
    const placeholders = subjects.length ? subjects.map(() => '?').join(',') : "''";
    const args = [type, route, ...subjects, ip, type, route, ...subjects, ip];
    const row = db.prepare(`SELECT COUNT(*) count FROM platform_access_logs failed
      WHERE failed.success=0 AND failed.user_type=? AND failed.route=? AND failed.created_at>=datetime('now','-15 minutes')
        AND (lower(failed.user_id) IN (${placeholders}) OR failed.ip=?)
        AND failed.rowid>COALESCE((SELECT MAX(success.rowid) FROM platform_access_logs success
          WHERE success.success=1 AND success.user_type=? AND success.route=?
            AND (lower(success.user_id) IN (${placeholders}) OR success.ip=?)),0)`).get(...args) as { count: number };
    if (row.count >= configuredLimit()) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.', retryAfterSeconds: 900 });
    }
  } catch (error) {
    console.error('Rate limit persistente indisponivel', (error as Error).message);
  }
  next();
}

export function clearLoginRateLimit(req: Request, values?: unknown[], path?: string) {
  const subject = identities(req, values)[0] || 'rate-limit-reset';
  try {
    db.prepare(`INSERT INTO platform_access_logs(id,user_type,user_id,success,ip,user_agent,reason,route)
      VALUES(lower(hex(randomblob(16))),?,?,1,?,?, 'rate_limit_reset',?)`).run(userType(req), subject, req.ip ?? null, String(req.header('user-agent') ?? '').slice(0, 500) || null, (path || req.originalUrl || req.path).slice(0, 200));
  } catch {}
}
