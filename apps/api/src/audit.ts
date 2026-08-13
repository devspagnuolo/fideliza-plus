import { randomUUID } from 'node:crypto';
import { db } from './database/db.js';

export function audit(tenantId:string,userId:string,action:string,entityType:string,entityId?:string,metadata:Record<string,unknown>={}) {
  db.prepare('INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?,?,?)')
    .run(randomUUID(),tenantId,userId,action,entityType,entityId??null,JSON.stringify(metadata));
}
