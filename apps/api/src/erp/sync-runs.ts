import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import type { ErpProviderCode } from './types.js';

export type ErpSyncTrigger='manual'|'scheduled'|'webhook'|'reconciliation';

export function startErpSyncRun(tenantId:string,provider:ErpProviderCode,trigger:ErpSyncTrigger,correlationId?:string){
  const id=randomUUID();
  db.prepare(`INSERT INTO integration_sync_runs(id,tenant_id,provider,trigger,status,correlation_id)
    VALUES(?,?,?,?, 'processing',?)`).run(id,tenantId,provider,trigger,correlationId??null);
  return id;
}

export function completeErpSyncRun(id:string,summary:unknown){
  db.prepare(`UPDATE integration_sync_runs SET status='completed',summary=?,completed_at=CURRENT_TIMESTAMP,error_code=NULL,error_message=NULL WHERE id=?`).run(JSON.stringify(summary),id);
}

export function failErpSyncRun(id:string,error:unknown,code='SYNC_FAILED'){
  const message=error instanceof Error?error.message:String(error);
  db.prepare(`UPDATE integration_sync_runs SET status='failed',error_code=?,error_message=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).run(code,message.slice(0,1000),id);
}
