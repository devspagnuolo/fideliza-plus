import type { NextFunction, Request, Response } from 'express';
import { db } from './database/db.js';
import { hashToken } from './security.js';
import { parseFeatures } from './plan-catalog.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.fideliza_session as string | undefined;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const row = db.prepare(`SELECT u.id userId, u.tenant_id tenantId, u.role, u.name,sub.plan_code planCode,sub.status subscriptionStatus,sub.current_period_end trialEndsAt,p.name planName,p.features,p.user_limit userLimit,p.consumer_limit consumerLimit,p.storage_mb storageMb
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN tenants t ON t.id=u.tenant_id
    LEFT JOIN subscriptions sub ON sub.tenant_id=t.id LEFT JOIN platform_plans p ON p.code=sub.plan_code
    WHERE s.token_hash=? AND s.expires_at > datetime('now') AND u.active=1
      AND COALESCE(t.login_blocked,0)=0
      AND COALESCE(sub.status,'trialing') IN ('active','trialing')`).get(hashToken(token)) as Request['auth'];
  if (!row) return res.status(401).json({ error: 'Sessão inválida' });
  req.auth = {...row,features:parseFeatures((row as any).features),limits:{users:Number((row as any).userLimit||0),consumers:Number((row as any).consumerLimit||0),storageMb:Number((row as any).storageMb||0)}}; next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Sem permissão para esta ação' });
    next();
  };
}
