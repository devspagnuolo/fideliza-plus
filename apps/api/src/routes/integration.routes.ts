import { createHash,createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth,requireRole } from '../auth.js';
import { blingAuthorizationUrl,blingCompanyTenant,encryptSecret,exchangeBlingToken,fetchBlingCompanyId } from '../bling.js';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { erpProvider,publicErpCatalog } from '../erp/catalog.js';

export const integrationRoutes=Router();
integrationRoutes.get('/public/integrations/erp',(_req,res)=>res.json({providers:publicErpCatalog(),policy:{availableMeans:'Conector implementado e homologado no Fidelizei',plannedMeans:'Roadmap técnico; ainda não aceita credenciais nem sincroniza dados'}}));
export function validBlingWebhookSignature(secret:string,raw:Buffer,provided:string){const expected=`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`;return provided.length===expected.length&&timingSafeEqual(Buffer.from(provided),Buffer.from(expected));}
function enqueueBlingSync(tenantId:string){const existing=db.prepare("SELECT id FROM jobs WHERE tenant_id=? AND type='sync_bling' AND status IN ('queued','processing') LIMIT 1").get(tenantId);if(!existing)db.prepare("INSERT INTO jobs (id,tenant_id,type,payload) VALUES (?,?,'sync_bling',?)").run(randomUUID(),tenantId,JSON.stringify({trigger:'webhook'}));}
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
  // Só aceita contas vinculadas no OAuth (ou na sincronização de conexões antigas).
  // Um companyId desconhecido nunca é atribuído a uma empresa por adivinhação.
  const connection=db.prepare("SELECT tenant_id FROM integration_connections WHERE provider='bling' AND external_company_id=? AND status='connected'").get(parsed.data.companyId) as {tenant_id:string}|undefined;
  if(!connection)return res.status(409).json({error:'Empresa Bling não identificada'});
  db.prepare("INSERT INTO integration_webhook_events (id,provider,external_event_id,tenant_id,event_type,occurred_at,payload) VALUES (?,'bling',?,?,?,?,?)").run(randomUUID(),parsed.data.eventId,connection.tenant_id,parsed.data.event,parsed.data.date,raw.toString('utf8'));
  enqueueBlingSync(connection.tenant_id);
  res.status(202).json({accepted:true});
});
// Restrinja somente o namespace das integrações. Um middleware global neste
// Router também interceptava rotas registradas depois dele (recompensas,
// fidelidade e analytics), bloqueando indevidamente gestores e operadores.
integrationRoutes.use('/integrations',requireAuth,requireRole('owner'));

integrationRoutes.get('/integrations/erp/catalog',(req,res)=>{
  const tenantId=req.auth!.tenantId;
  const oauthConnections=db.prepare('SELECT provider,status,last_sync_at lastSyncAt,last_error lastError,external_company_id externalAccountId,created_at connectedAt FROM integration_connections WHERE tenant_id=?').all(tenantId) as any[];
  const customConnections=db.prepare('SELECT id,provider,status,last_sync_at lastSyncAt,last_error lastError,created_at connectedAt FROM erp_connectors WHERE tenant_id=?').all(tenantId) as any[];
  const normalize=(value:string)=>value.trim().toLocaleLowerCase('pt-BR').replace(/[\s-]+/g,'_');
  const providers=publicErpCatalog().map(provider=>{
    const oauth=oauthConnections.find(item=>normalize(item.provider)===provider.code),custom=customConnections.find(item=>normalize(item.provider)===provider.code);
    const connection=oauth??custom??null;
    return {...provider,connection:connection?{id:custom?.id??null,status:connection.status,lastSyncAt:connection.lastSyncAt??null,lastError:connection.lastError??null,externalAccountId:connection.externalAccountId??null,connectedAt:connection.connectedAt}:null,canConnect:provider.status==='available'};
  });
  const recentRuns=db.prepare(`SELECT id,provider,trigger,status,summary,error_code errorCode,error_message errorMessage,started_at startedAt,completed_at completedAt
    FROM integration_sync_runs WHERE tenant_id=? ORDER BY started_at DESC LIMIT 30`).all(tenantId);
  res.json({providers,recentRuns});
});

integrationRoutes.get('/integrations/erp/:provider',(req,res)=>{
  const provider=erpProvider(String(req.params.provider));
  if(!provider)return res.status(404).json({error:'ERP não reconhecido pelo catálogo Fidelizei'});
  const connection=db.prepare('SELECT status,last_sync_at lastSyncAt,last_error lastError,external_company_id externalAccountId,created_at connectedAt FROM integration_connections WHERE tenant_id=? AND provider=?').get(req.auth!.tenantId,provider.code)??null;
  res.json({...provider,connection,canConnect:provider.status==='available'});
});

integrationRoutes.get('/integrations/bling',(req,res)=>{const connection=db.prepare("SELECT status,expires_at,last_sync_at,created_at FROM integration_connections WHERE tenant_id=? AND provider='bling'").get(req.auth!.tenantId);res.json({configured:Boolean(process.env.BLING_CLIENT_ID&&process.env.BLING_CLIENT_SECRET),connected:Boolean(connection),connection:connection??null});});
integrationRoutes.post('/integrations/bling/authorize',(req,res)=>{if(!process.env.BLING_CLIENT_ID||!process.env.BLING_CLIENT_SECRET)return res.status(503).json({error:'Credenciais do Bling ainda não configuradas'});const state=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(state).digest('hex'),expires=new Date(Date.now()+10*60_000).toISOString();db.prepare("DELETE FROM oauth_states WHERE expires_at<datetime('now')").run();db.prepare('INSERT INTO oauth_states (state_hash,tenant_id,user_id,provider,expires_at) VALUES (?,?,?,?,?)').run(hash,req.auth!.tenantId,req.auth!.userId,'bling',expires);res.json({url:blingAuthorizationUrl(state)});});
integrationRoutes.get('/integrations/bling/callback',async(req,res)=>{const parsed=z.object({code:z.string().min(1),state:z.string().min(20)}).safeParse(req.query);if(!parsed.success)return res.status(400).json({error:'Retorno OAuth inválido'});const hash=createHash('sha256').update(parsed.data.state).digest('hex'),saved=db.prepare("SELECT tenant_id,user_id FROM oauth_states WHERE state_hash=? AND provider='bling' AND expires_at>datetime('now')").get(hash) as {tenant_id:string;user_id:string}|undefined;if(!saved||saved.tenant_id!==req.auth!.tenantId||saved.user_id!==req.auth!.userId)return res.status(403).json({error:'Estado OAuth inválido ou expirado'});db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash);
  const tenantId=req.auth!.tenantId,tokens=await exchangeBlingToken('authorization_code',parsed.data.code),expiresAt=new Date(Date.now()+tokens.expiresIn*1000).toISOString();
  // Sem a conta Bling não há como rotear webhooks: os tokens são descartados e a empresa volta com um aviso, não com erro 500.
  let companyId:string;try{companyId=await fetchBlingCompanyId(tokens.accessToken);}catch(error){console.warn(`Bling: conexão de ${tenantId} recusada sem a conta conectada: ${(error as Error).message}`);audit(tenantId,req.auth!.userId,'connect_rejected','integration',undefined,{provider:'bling',reason:'account_unavailable'});return res.redirect(`${config.webOrigin}/?bling=account_unavailable`);}
  // A conta Bling autorizada é gravada junto com os tokens: o webhook roteia por ela.
  // Se a mesma conta já está ligada a outra empresa, os tokens são descartados.
  const bound=db.transaction(()=>{const owner=blingCompanyTenant(companyId);if(owner&&owner!==tenantId)return false;db.prepare(`INSERT INTO integration_connections (id,tenant_id,provider,access_token_encrypted,refresh_token_encrypted,expires_at,external_company_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant_id,provider) DO UPDATE SET access_token_encrypted=excluded.access_token_encrypted,refresh_token_encrypted=excluded.refresh_token_encrypted,expires_at=excluded.expires_at,external_company_id=excluded.external_company_id,status='connected',updated_at=CURRENT_TIMESTAMP`).run(randomUUID(),tenantId,'bling',encryptSecret(tokens.accessToken),encryptSecret(tokens.refreshToken),expiresAt,companyId);return true;})();
  if(!bound){audit(tenantId,req.auth!.userId,'connect_rejected','integration',undefined,{provider:'bling',reason:'company_in_use'});return res.redirect(`${config.webOrigin}/?bling=company_in_use`);}
  audit(tenantId,req.auth!.userId,'connect','integration',undefined,{provider:'bling'});res.redirect(`${config.webOrigin}/?bling=connected`);});
integrationRoutes.delete('/integrations/bling',(req,res)=>{db.prepare("DELETE FROM integration_connections WHERE tenant_id=? AND provider='bling'").run(req.auth!.tenantId);audit(req.auth!.tenantId,req.auth!.userId,'disconnect','integration',undefined,{provider:'bling'});res.status(204).end();});
integrationRoutes.post('/integrations/bling/sync',(req,res)=>{const connection=db.prepare("SELECT id FROM integration_connections WHERE tenant_id=? AND provider='bling' AND status='connected'").get(req.auth!.tenantId);if(!connection)return res.status(409).json({error:'Conecte o Bling antes de sincronizar'});const existing=db.prepare("SELECT id,status FROM jobs WHERE tenant_id=? AND type='sync_bling' AND status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1").get(req.auth!.tenantId) as {id:string;status:string}|undefined;if(existing)return res.status(202).json(existing);const id=randomUUID();db.prepare("INSERT INTO jobs (id,tenant_id,type,payload) VALUES (?,?,'sync_bling',?)").run(id,req.auth!.tenantId,JSON.stringify({trigger:'manual'}));audit(req.auth!.tenantId,req.auth!.userId,'enqueue','integration',id,{provider:'bling',type:'sync'});res.status(202).json({id,status:'queued'});});
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
