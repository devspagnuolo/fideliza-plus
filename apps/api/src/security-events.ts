import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { db } from './database/db.js';

export type SecuritySeverity='info'|'low'|'medium'|'high'|'critical';

export function recordSecurityEvent(req:Request,input:{eventType:string;severity:SecuritySeverity;userType?:string;identity?:string;tenantId?:string|null;reason?:string;metadata?:Record<string,unknown>}){
  try{
    const ip=req.ip||null,identity=input.identity?.slice(0,160)||null,userAgent=String(req.header('user-agent')||'').slice(0,500)||null;
    const existing=db.prepare(`SELECT id FROM security_events WHERE event_type=? AND status IN ('open','investigating') AND COALESCE(user_type,'')=COALESCE(?,'') AND COALESCE(identity,'')=COALESCE(?,'') AND COALESCE(ip,'')=COALESCE(?,'') AND last_seen_at>=datetime('now','-30 minutes') ORDER BY last_seen_at DESC LIMIT 1`).get(input.eventType,input.userType||null,identity,ip)as{id:string}|undefined;
    if(existing){db.prepare('UPDATE security_events SET occurrence_count=occurrence_count+1,severity=?,reason=?,metadata=?,last_seen_at=CURRENT_TIMESTAMP WHERE id=?').run(input.severity,input.reason?.slice(0,500)||null,JSON.stringify(input.metadata||{}),existing.id);return existing.id}
    const id=randomUUID();db.prepare(`INSERT INTO security_events(id,event_type,severity,user_type,identity,tenant_id,ip,user_agent,reason,metadata)VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,input.eventType,input.severity,input.userType||null,identity,input.tenantId||null,ip,userAgent,input.reason?.slice(0,500)||null,JSON.stringify(input.metadata||{}));return id;
  }catch(error){console.error('Não foi possível registrar o evento de segurança',(error as Error).message);return null}
}

export function detectCredentialAttack(req:Request,userType:string,identity:string,tenantId?:string|null){
  const normalized=identity.trim().toLowerCase().slice(0,160),ip=req.ip||'';
  const result=db.prepare(`SELECT COUNT(*) total,COUNT(DISTINCT user_id) identities FROM platform_access_logs WHERE success=0 AND user_type=? AND created_at>=datetime('now','-15 minutes') AND (lower(user_id)=? OR ip=?)`).get(userType,normalized,ip)as{total:number;identities:number};
  if(result.total<5)return;
  const distributed=result.identities>=4,eventType=distributed?'credential_stuffing':'brute_force',severity:SecuritySeverity=result.total>=15?'critical':result.total>=10?'high':'medium';
  recordSecurityEvent(req,{eventType,severity,userType,identity:normalized,tenantId,reason:distributed?'Múltiplas identidades atacadas a partir da mesma origem':'Múltiplas falhas consecutivas de autenticação',metadata:{attempts15Minutes:result.total,distinctIdentities:result.identities}});
}
