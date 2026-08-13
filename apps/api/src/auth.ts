import type { NextFunction, Request, Response } from 'express';
import { db } from './database/db.js';
import { hashToken } from './security.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.fideliza_session as string | undefined;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const row = db.prepare(`SELECT u.id userId, u.tenant_id tenantId, u.role, u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > datetime('now') AND u.active=1`).get(hashToken(token)) as Request['auth'];
  if (!row) return res.status(401).json({ error: 'Sessão inválida' });
  req.auth = row; next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Sem permissão para esta ação' });
    next();
  };
}
