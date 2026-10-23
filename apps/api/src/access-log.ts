import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { db } from './database/db.js';
import { detectCredentialAttack } from './security-events.js';
import { rateLimitRoute } from './rate-limit.js';

export function recordAccess(req: Request, userType: 'platform' | 'company' | 'customer', userId: string, success: boolean, tenantId?: string | null, reason?: string) {
  try {
    db.prepare(`INSERT INTO platform_access_logs
      (id,user_type,user_id,tenant_id,success,ip,user_agent,reason,route)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), userType, userId.slice(0, 160), tenantId ?? null, success ? 1 : 0, req.ip ?? null, String(req.header('user-agent') ?? '').slice(0, 500) || null, reason?.slice(0, 300) ?? null, rateLimitRoute(req.originalUrl || req.path));
    if (!success) detectCredentialAttack(req,userType,userId,tenantId);
  } catch (error) {
    console.error('Não foi possível registrar o acesso', (error as Error).message);
  }
}
