import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { db } from './database/db.js';

export function recordAccess(req: Request, userType: 'platform' | 'company' | 'customer', userId: string, success: boolean, tenantId?: string | null, reason?: string) {
  try {
    db.prepare(`INSERT INTO platform_access_logs
      (id,user_type,user_id,tenant_id,success,ip,user_agent,reason)
      VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), userType, userId.slice(0, 160), tenantId ?? null, success ? 1 : 0, req.ip ?? null, String(req.header('user-agent') ?? '').slice(0, 500) || null, reason?.slice(0, 300) ?? null);
  } catch (error) {
    console.error('Não foi possível registrar o acesso', (error as Error).message);
  }
}
