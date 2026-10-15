import type { NextFunction,Request,Response } from 'express';import { db } from './database/db.js';import { hashToken } from './security.js';
declare global{namespace Express{interface Request{apiKey?:{id:string;tenantId:string;scopes:string[];createdBy:string|null;name:string}}}}
const rateWindowMs=60_000,rateLimit=120;
let cleanupCounter=0;
export function consumeApiKeyRateLimit(apiKeyId:string,now=Date.now()){
 const windowStart=Math.floor(now/rateWindowMs)*rateWindowMs;
 const row=db.prepare(`INSERT INTO api_key_rate_limits(api_key_id,window_start,request_count)VALUES(?,?,1)
  ON CONFLICT(api_key_id,window_start)DO UPDATE SET request_count=request_count+1 RETURNING request_count`).get(apiKeyId,windowStart)as{request_count:number};
 if(++cleanupCounter%1000===0)db.prepare('DELETE FROM api_key_rate_limits WHERE window_start<?').run(now-7_200_000);
 return row.request_count<=rateLimit;
}
export function requireApiKey(scope:string){return(req:Request,res:Response,next:NextFunction)=>{const raw=String(req.header('authorization')??'').replace(/^Bearer\\s+/i,'');if(!raw.startsWith('fz_live_'))return res.status(401).json({error:'Chave de API ausente'});const row=db.prepare("SELECT id,tenant_id,name,created_by,scopes FROM api_keys WHERE key_hash=? AND active=1 AND (expires_at IS NULL OR expires_at>datetime('now'))").get(hashToken(raw)) as {id:string;tenant_id:string;name:string;created_by:string|null;scopes:string}|undefined;if(!row)return res.status(401).json({error:'Chave de API inválida'});if(!consumeApiKeyRateLimit(row.id))return res.status(429).json({error:'Limite da API excedido'});const scopes=JSON.parse(row.scopes) as string[];if(!scopes.includes(scope))return res.status(403).json({error:'Escopo não autorizado'});req.apiKey={id:row.id,tenantId:row.tenant_id,scopes,createdBy:row.created_by,name:row.name};db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);next();};}
