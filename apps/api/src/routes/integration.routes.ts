import { createHash,createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth,requireRole } from '../auth.js';
import { blingAuthorizationUrl,decryptSecret,encryptSecret,exchangeBlingToken } from '../bling.js';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { exchangeLinkedInCode,inspectLinkedInToken,linkedInAuthorizationUrl,linkedInConfigured,linkedInScopes } from '../linkedin.js';

export const integrationRoutes=Router();
export function validBlingWebhookSignature(secret:string,raw:Buffer,provided:string){const expected=`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`;return provided.length===expected.length&&timingSafeEqual(Buffer.from(provided),Buffer.from(expected));}
function enqueueBlingSync(tenantId:string){const existing=db.prepare("SELECT id FROM jobs WHERE tenant_id=? AND type='sync_bling' AND status IN ('queued','processing') LIMIT 1").get(tenantId);if(!existing)db.prepare("INSERT INTO jobs (id,tenant_id,type) VALUES (?,?,'sync_bling')").run(randomUUID(),tenantId);}
integrationRoutes.post('/webhooks/bling',(req,res)=>{
  const secret=process.env.BLING_CLIENT_SECRET,raw=(req as typeof req&{rawBody?:Buffer}).rawBody,provided=String(req.header('x-bling-signature-256')??'');
  if(!secret||!raw)return res.status(503).json({error:'Webhook não configurado'});
  if(!validBlingWebhookSignature(secret,raw,provided))return res.status(401).json({error:'Assinatura inválida'});
  const parsed=z.object({eventId:z.string().min(1),date:z.string().datetime(),version:z.union([z.string(),z.number()]),event:z.string().min(3),companyId:z.union([z.string().min(1),z.number()]).transform(String),data:z.unknown()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Evento inválido'});
  const duplicate=db.prepare("SELECT id,tenant_id,status,attempts FROM integration_webhook_events WHERE provider='bling' AND external_event_id=?").get(parsed.data.eventId) as {id:string;tenant_id:string;status:string;attempts:number}|undefined;
  if(duplicate){
    const retrying=duplicate.status==='failed'&&duplicate.attempts<10;
    if(retrying)db.prepare("UPDATE integration_webhook_events SET status='accepted',last_error=NULL,processed_at=NULL WHERE id=?").run(duplicate.id);
    if(duplicate.status!=='processed')enqueueBlingSync(duplicate.tenant_id);
    return res.status(retrying?202:200).json({accepted:true,duplicate:true,...(retrying?{retrying:true}:{})});
  }
  let connection=db.prepare("SELECT tenant_id FROM integration_connections WHERE provider='bling' AND external_company_id=? AND status='connected'").get(parsed.data.companyId) as {tenant_id:string}|undefined;
  if(!connection){
    const candidates=db.prepare("SELECT tenant_id FROM integration_connections WHERE provider='bling' AND external_company_id IS NULL AND status='connected'").all() as {tenant_id:string}[];
    if(candidates.length!==1)return res.status(409).json({error:'Empresa Bling não identificada'});
    connection=candidates[0]!;
    db.prepare("UPDATE integration_connections SET external_company_id=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='bling'").run(parsed.data.companyId,connection.tenant_id);
  }
  db.prepare("INSERT INTO integration_webhook_events (id,provider,external_event_id,tenant_id,event_type,occurred_at,payload) VALUES (?,'bling',?,?,?,?,?)").run(randomUUID(),parsed.data.eventId,connection.tenant_id,parsed.data.event,parsed.data.date,raw.toString('utf8'));
  enqueueBlingSync(connection.tenant_id);
  res.status(202).json({accepted:true});
});
integrationRoutes.use(requireAuth,requireRole('owner'));

type LinkedInConnectionRow={status:string;expires_at:string;created_at:string;updated_at:string;scopes:string;metadata:string;last_error:string|null;access_token_encrypted:string};
function parseJson<T>(value:string,fallback:T):T{try{return JSON.parse(value) as T}catch{return fallback}}
function linkedInCapabilities(scopes:string[]){return {tokenValidation:true,memberPublishing:scopes.includes('w_member_social'),organizationPublishing:scopes.includes('w_organization_social'),organizationAnalytics:scopes.includes('r_organization_social')};}

integrationRoutes.get('/integrations/linkedin',(req,res)=>{
  const connection=db.prepare("SELECT status,expires_at,created_at,updated_at,scopes,metadata,last_error,access_token_encrypted FROM integration_connections WHERE tenant_id=? AND provider='linkedin'").get(req.auth!.tenantId) as LinkedInConnectionRow|undefined;
  const scopes=connection?parseJson<string[]>(connection.scopes,[]):[];
  const expired=Boolean(connection&&new Date(connection.expires_at).getTime()<=Date.now());
  const metadata=connection?parseJson<Record<string,unknown>>(connection.metadata,{}):{};
  res.json({configured:linkedInConfigured(),connected:Boolean(connection)&&connection!.status==='connected'&&!expired,expired,requestedScopes:linkedInScopes(),capabilities:linkedInCapabilities(scopes),connection:connection?{status:expired?'expired':connection.status,expiresAt:connection.expires_at,createdAt:connection.created_at,updatedAt:connection.updated_at,scopes,lastError:connection.last_error,profile:metadata.profile??null,lastVerifiedAt:metadata.lastVerifiedAt??null}:null});
});

integrationRoutes.post('/integrations/linkedin/authorize',(req,res)=>{
  if(!linkedInConfigured())return res.status(503).json({error:'Credenciais do LinkedIn ainda não configuradas'});
  const state=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(state).digest('hex'),expires=new Date(Date.now()+10*60_000).toISOString();
  db.prepare("DELETE FROM oauth_states WHERE expires_at<datetime('now')").run();
  db.prepare('INSERT INTO oauth_states (state_hash,tenant_id,user_id,provider,expires_at) VALUES (?,?,?,?,?)').run(hash,req.auth!.tenantId,req.auth!.userId,'linkedin',expires);
  res.json({url:linkedInAuthorizationUrl(state),requestedScopes:linkedInScopes()});
});

integrationRoutes.get('/integrations/linkedin/callback',async(req,res,next)=>{
  try{
    const parsed=z.object({code:z.string().min(1),state:z.string().min(20)}).safeParse(req.query);
    if(!parsed.success)return res.status(400).json({error:'Retorno OAuth do LinkedIn inválido'});
    const hash=createHash('sha256').update(parsed.data.state).digest('hex');
    const saved=db.prepare("SELECT tenant_id,user_id FROM oauth_states WHERE state_hash=? AND provider='linkedin' AND expires_at>datetime('now')").get(hash) as {tenant_id:string;user_id:string}|undefined;
    if(!saved||saved.tenant_id!==req.auth!.tenantId||saved.user_id!==req.auth!.userId)return res.status(403).json({error:'Estado OAuth do LinkedIn inválido ou expirado'});
    db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash);
    const tokens=await exchangeLinkedInCode(parsed.data.code);
    const inspection=await inspectLinkedInToken(tokens.accessToken);
    if(!inspection.active)throw new Error('O LinkedIn devolveu uma autorização inativa');
    const grantedScopes=inspection.scopes.length?inspection.scopes:tokens.scopes;
    const expiresAt=new Date((inspection.expiresAt?inspection.expiresAt*1000:Date.now()+tokens.expiresIn*1000)).toISOString();
    const metadata=JSON.stringify({lastVerifiedAt:new Date().toISOString(),authorization:{status:inspection.status??'active',authType:inspection.authType??'3L',authorizedAt:inspection.authorizedAt??null},refreshTokenExpiresIn:tokens.refreshTokenExpiresIn??null});
    db.prepare(`INSERT INTO integration_connections (id,tenant_id,provider,access_token_encrypted,refresh_token_encrypted,expires_at,scopes,metadata,connected_by,last_error) VALUES (?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(tenant_id,provider) DO UPDATE SET access_token_encrypted=excluded.access_token_encrypted,refresh_token_encrypted=excluded.refresh_token_encrypted,expires_at=excluded.expires_at,scopes=excluded.scopes,metadata=excluded.metadata,connected_by=excluded.connected_by,last_error=NULL,status='connected',updated_at=CURRENT_TIMESTAMP`).run(randomUUID(),req.auth!.tenantId,'linkedin',encryptSecret(tokens.accessToken),encryptSecret(tokens.refreshToken),expiresAt,JSON.stringify(grantedScopes),metadata,req.auth!.userId);
    audit(req.auth!.tenantId,req.auth!.userId,'connect','integration',undefined,{provider:'linkedin',scopes:grantedScopes});
    res.redirect(`${config.webOrigins[0]}/?linkedin=connected`);
  }catch(reason){next(reason)}
});

integrationRoutes.post('/integrations/linkedin/test',async(req,res)=>{
  const connection=db.prepare("SELECT status,expires_at,scopes,metadata,access_token_encrypted FROM integration_connections WHERE tenant_id=? AND provider='linkedin'").get(req.auth!.tenantId) as LinkedInConnectionRow|undefined;
  if(!connection||connection.status!=='connected')return res.status(409).json({error:'Conecte o LinkedIn antes de testar'});
  if(new Date(connection.expires_at).getTime()<=Date.now()){db.prepare("UPDATE integration_connections SET status='expired',last_error='Token expirado',updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='linkedin'").run(req.auth!.tenantId);return res.status(409).json({error:'A autorização do LinkedIn expirou. Reconecte a conta.'});}
  try{
    const inspection=await inspectLinkedInToken(decryptSecret(connection.access_token_encrypted));
    if(!inspection.active)throw new Error('A autorização foi revogada ou expirou no LinkedIn');
    const existing=parseJson<Record<string,unknown>>(connection.metadata,{}),verifiedAt=new Date().toISOString();
    const scopes=inspection.scopes.length?inspection.scopes:parseJson<string[]>(connection.scopes,[]);
    const metadata=JSON.stringify({...existing,authorization:{status:inspection.status??'active',authType:inspection.authType??'3L',authorizedAt:inspection.authorizedAt??null},lastVerifiedAt:verifiedAt});
    db.prepare("UPDATE integration_connections SET metadata=?,scopes=?,last_error=NULL,status='connected',updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='linkedin'").run(metadata,JSON.stringify(scopes),req.auth!.tenantId);
    audit(req.auth!.tenantId,req.auth!.userId,'test','integration',undefined,{provider:'linkedin',success:true});
    res.json({healthy:true,verifiedAt,capabilities:linkedInCapabilities(scopes)});
  }catch(reason){const message=reason instanceof Error?reason.message:'Falha ao validar LinkedIn';db.prepare("UPDATE integration_connections SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='linkedin'").run(message,req.auth!.tenantId);audit(req.auth!.tenantId,req.auth!.userId,'test','integration',undefined,{provider:'linkedin',success:false});res.status(502).json({error:message});}
});

integrationRoutes.delete('/integrations/linkedin',(req,res)=>{db.prepare("DELETE FROM integration_connections WHERE tenant_id=? AND provider='linkedin'").run(req.auth!.tenantId);audit(req.auth!.tenantId,req.auth!.userId,'disconnect','integration',undefined,{provider:'linkedin'});res.status(204).end();});

integrationRoutes.get('/integrations/bling',(req,res)=>{const connection=db.prepare("SELECT status,expires_at,last_sync_at,created_at FROM integration_connections WHERE tenant_id=? AND provider='bling'").get(req.auth!.tenantId);res.json({configured:Boolean(process.env.BLING_CLIENT_ID&&process.env.BLING_CLIENT_SECRET),connected:Boolean(connection),connection:connection??null});});
integrationRoutes.post('/integrations/bling/authorize',(req,res)=>{if(!process.env.BLING_CLIENT_ID||!process.env.BLING_CLIENT_SECRET)return res.status(503).json({error:'Credenciais do Bling ainda não configuradas'});const state=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(state).digest('hex'),expires=new Date(Date.now()+10*60_000).toISOString();db.prepare("DELETE FROM oauth_states WHERE expires_at<datetime('now')").run();db.prepare('INSERT INTO oauth_states (state_hash,tenant_id,user_id,provider,expires_at) VALUES (?,?,?,?,?)').run(hash,req.auth!.tenantId,req.auth!.userId,'bling',expires);res.json({url:blingAuthorizationUrl(state)});});
integrationRoutes.get('/integrations/bling/callback',async(req,res)=>{const parsed=z.object({code:z.string().min(1),state:z.string().min(20)}).safeParse(req.query);if(!parsed.success)return res.status(400).json({error:'Retorno OAuth inválido'});const hash=createHash('sha256').update(parsed.data.state).digest('hex'),saved=db.prepare("SELECT tenant_id,user_id FROM oauth_states WHERE state_hash=? AND provider='bling' AND expires_at>datetime('now')").get(hash) as {tenant_id:string;user_id:string}|undefined;if(!saved||saved.tenant_id!==req.auth!.tenantId||saved.user_id!==req.auth!.userId)return res.status(403).json({error:'Estado OAuth inválido ou expirado'});db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash);const tokens=await exchangeBlingToken('authorization_code',parsed.data.code),expiresAt=new Date(Date.now()+tokens.expiresIn*1000).toISOString();db.prepare(`INSERT INTO integration_connections (id,tenant_id,provider,access_token_encrypted,refresh_token_encrypted,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,provider) DO UPDATE SET access_token_encrypted=excluded.access_token_encrypted,refresh_token_encrypted=excluded.refresh_token_encrypted,expires_at=excluded.expires_at,status='connected',updated_at=CURRENT_TIMESTAMP`).run(randomUUID(),req.auth!.tenantId,'bling',encryptSecret(tokens.accessToken),encryptSecret(tokens.refreshToken),expiresAt);audit(req.auth!.tenantId,req.auth!.userId,'connect','integration',undefined,{provider:'bling'});res.redirect(`${config.webOrigin}/?bling=connected`);});
integrationRoutes.delete('/integrations/bling',(req,res)=>{db.prepare("DELETE FROM integration_connections WHERE tenant_id=? AND provider='bling'").run(req.auth!.tenantId);audit(req.auth!.tenantId,req.auth!.userId,'disconnect','integration',undefined,{provider:'bling'});res.status(204).end();});
integrationRoutes.post('/integrations/bling/sync',(req,res)=>{const connection=db.prepare("SELECT id FROM integration_connections WHERE tenant_id=? AND provider='bling' AND status='connected'").get(req.auth!.tenantId);if(!connection)return res.status(409).json({error:'Conecte o Bling antes de sincronizar'});const existing=db.prepare("SELECT id,status FROM jobs WHERE tenant_id=? AND type='sync_bling' AND status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1").get(req.auth!.tenantId) as {id:string;status:string}|undefined;if(existing)return res.status(202).json(existing);const id=randomUUID();db.prepare("INSERT INTO jobs (id,tenant_id,type) VALUES (?,?,'sync_bling')").run(id,req.auth!.tenantId);audit(req.auth!.tenantId,req.auth!.userId,'enqueue','integration',id,{provider:'bling',type:'sync'});res.status(202).json({id,status:'queued'});});
integrationRoutes.get('/integrations/bling/reconciliation',(req,res)=>{
  const tenantId=req.auth!.tenantId,connection=db.prepare("SELECT last_sync_at,external_company_id,last_error FROM integration_connections WHERE tenant_id=? AND provider='bling'").get(tenantId) as {last_sync_at:string|null;external_company_id:string|null;last_error:string|null}|undefined;
  const unidentifiedSales=(db.prepare("SELECT COUNT(*) total FROM sales WHERE tenant_id=? AND source='bling' AND customer_id IS NULL AND reversed_at IS NULL").get(tenantId) as {total:number}).total;
  const reversedSales=(db.prepare("SELECT COUNT(*) total FROM sales WHERE tenant_id=? AND source='bling' AND reversed_at IS NOT NULL").get(tenantId) as {total:number}).total;
  const failedJobs=(db.prepare("SELECT COUNT(*) total FROM jobs WHERE tenant_id=? AND type='sync_bling' AND status='failed' AND completed_at>COALESCE(?,'')").get(tenantId,connection?.last_sync_at??null) as {total:number}).total;
  const failedEvents=(db.prepare("SELECT COUNT(*) total FROM integration_webhook_events WHERE tenant_id=? AND provider='bling' AND status='failed'").get(tenantId) as {total:number}).total;
  const pendingEvents=(db.prepare("SELECT COUNT(*) total FROM integration_webhook_events WHERE tenant_id=? AND provider='bling' AND status='accepted'").get(tenantId) as {total:number}).total;
  const lastEvent=db.prepare("SELECT event_type,status,attempts,occurred_at,processed_at,created_at,last_error FROM integration_webhook_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1").get(tenantId);
  res.json({connection,unidentifiedSales,reversedSales,failedJobs,failedEvents,pendingEvents,lastEvent,healthy:Boolean(connection)&&!connection?.last_error&&unidentifiedSales===0&&failedJobs===0&&failedEvents===0});
});
