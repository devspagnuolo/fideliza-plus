import { randomUUID } from 'node:crypto';
import type { Request,Response } from 'express';
import { db } from './database/db.js';
import { config } from './config.js';
import { hashToken,newToken } from './security.js';

type SessionKind='company'|'customer'|'platform';
const definitions={
  company:{table:'sessions',ownerColumn:'user_id',cookie:'fideliza_session',hours:24},
  customer:{table:'customer_sessions',ownerColumn:'account_id',cookie:'fideliza_customer_session',hours:168},
  platform:{table:'platform_sessions',ownerColumn:'admin_id',cookie:'fideliza_platform_session',hours:12},
}as const;

function configuredHours(kind:SessionKind){
  const definition=definitions[kind],key=kind==='platform'?'security.admin_session_hours':kind==='customer'?'security.customer_session_hours':'security.session_hours',maximum=kind==='customer'?720:kind==='company'?168:24;
  try{const row=db.prepare('SELECT value FROM global_settings WHERE key=?').get(key)as{value:string}|undefined,value=Number(row?.value||definition.hours);return Number.isFinite(value)?Math.min(maximum,Math.max(1,value)):definition.hours}catch{return definition.hours}
}

export function cookieOptions(expires?:Date){return{httpOnly:true,sameSite:'lax' as const,secure:config.isProduction,path:'/',priority:'high' as const,...(expires?{expires}:{})}}

export function createSecureSession(kind:SessionKind,ownerId:string,req:Request,res:Response){
  const definition=definitions[kind],token=newToken(),expires=new Date(Date.now()+configuredHours(kind)*3_600_000),ip=req.ip||null,userAgent=String(req.header('user-agent')||'').slice(0,500)||null;
  db.transaction(()=>{
    db.prepare(`DELETE FROM ${definition.table} WHERE expires_at<=datetime('now')`).run();
    db.prepare(`INSERT INTO ${definition.table}(id,${definition.ownerColumn},token_hash,expires_at,ip_address,user_agent,last_seen_at)VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(randomUUID(),ownerId,hashToken(token),expires.toISOString(),ip,userAgent);
    db.prepare(`DELETE FROM ${definition.table} WHERE ${definition.ownerColumn}=? AND id NOT IN (SELECT id FROM ${definition.table} WHERE ${definition.ownerColumn}=? ORDER BY created_at DESC,rowid DESC LIMIT 5)`).run(ownerId,ownerId);
  })();
  res.cookie(definition.cookie,token,cookieOptions(expires));
}

export function touchSession(table:'sessions'|'customer_sessions'|'platform_sessions',token:string){
  db.prepare(`UPDATE ${table} SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<datetime('now','-5 minutes'))`).run(hashToken(token));
}

export function clearSessionCookie(kind:SessionKind,res:Response){res.clearCookie(definitions[kind].cookie,cookieOptions())}

/**
 * Administradores da plataforma controlam todas as empresas, então em produção o painel só libera
 * as rotas depois que o segundo fator estiver ativo. A desativação fica na política global de MFA.
 */
export function platformMfaRequired(){
  if(!config.isProduction&&process.env.PLATFORM_ADMIN_MFA_REQUIRED!=='true')return false;
  try{const row=db.prepare("SELECT value FROM global_settings WHERE key='security.mfa_admin'").get()as{value:string}|undefined;return row?.value!=='false'}catch{return true}
}
