import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth, requireRole } from '../auth.js';
import { db } from '../database/db.js';
import { refreshRecommendations } from '../gie.js';
import { processCampaignBatch } from '../campaign-delivery.js';

export const growthRoutes = Router();
growthRoutes.use(requireAuth);

function activationFor(tenantId:string) {
  const data=db.prepare(`SELECT
    (SELECT segment IS NOT NULL AND length(trim(segment))>0 FROM tenants WHERE id=?) profile,
    (SELECT COUNT(*) FROM users WHERE tenant_id=? AND active=1) users,
    (SELECT COUNT(*) FROM customers WHERE tenant_id=?) customers,
    (SELECT COUNT(*) FROM sales WHERE tenant_id=? AND reversed_at IS NULL) sales,
    (SELECT COUNT(*) FROM campaigns WHERE tenant_id=?) campaigns`).get(tenantId,tenantId,tenantId,tenantId,tenantId) as {profile:number;users:number;customers:number;sales:number;campaigns:number};
  const steps=[
    {id:'profile',title:'Configure o perfil da empresa',description:'Defina segmento e regras de fidelidade.',complete:Boolean(data.profile)},
    {id:'team',title:'Convide sua equipe',description:'Adicione pelo menos mais um usuário.',complete:data.users>=2},
    {id:'customers',title:'Cadastre sua base inicial',description:'Cadastre ou importe ao menos 5 clientes.',complete:data.customers>=5},
    {id:'sale',title:'Registre a primeira venda',description:'Valide a geração automática de pontos.',complete:data.sales>=1},
    {id:'campaign',title:'Prepare a primeira campanha',description:'Crie um rascunho para um segmento.',complete:data.campaigns>=1}
  ];
  const completed=steps.filter(step=>step.complete).length;
  return {steps,completed,total:steps.length,progress:Math.round(completed/steps.length*100),activated:completed===steps.length};
}

growthRoutes.get('/onboarding',(req,res)=>res.json(activationFor(req.auth!.tenantId)));

growthRoutes.get('/dashboard',(req,res)=>{
  const tenantId=req.auth!.tenantId;
  const stats=db.prepare(`SELECT
    (SELECT COUNT(*) FROM customers WHERE tenant_id=?) customers,
    (SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE tenant_id=? AND reversed_at IS NULL AND occurred_at>=datetime('now','-30 days')) revenueCents,
    (SELECT COUNT(*) FROM sales WHERE tenant_id=? AND reversed_at IS NULL AND occurred_at>=datetime('now','-30 days')) sales,
    (SELECT COUNT(DISTINCT customer_id) FROM sales WHERE tenant_id=? AND customer_id IS NOT NULL AND reversed_at IS NULL AND occurred_at>=datetime('now','-30 days')) activeCustomers`).get(tenantId,tenantId,tenantId,tenantId) as any;
  const recommendations=refreshRecommendations(tenantId);
  res.json({...stats,averageTicketCents:stats.sales?Math.round(stats.revenueCents/stats.sales):0,identificationRate:stats.customers?Math.round(stats.activeCustomers/stats.customers*100):0,activation:activationFor(tenantId),recommendations});
});

growthRoutes.patch('/gie/recommendations/:id', (req,res)=>{
  const parsed=z.object({status:z.enum(['accepted','dismissed','completed'])}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Decisão inválida'});
  const id=String(req.params.id),tenantId=req.auth!.tenantId;
  const result=db.prepare(`UPDATE gie_recommendations SET status=?,accepted_at=CASE WHEN ?='accepted' THEN CURRENT_TIMESTAMP ELSE accepted_at END,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`).run(parsed.data.status,parsed.data.status,parsed.data.status,id,tenantId);
  if(!result.changes)return res.status(404).json({error:'Recomendação não encontrada'});
  audit(tenantId,req.auth!.userId,'gie_decision','gie_recommendation',id,{status:parsed.data.status});
  res.json({ok:true});
});

growthRoutes.get('/campaigns',(req,res)=>res.json(db.prepare('SELECT * FROM campaigns WHERE tenant_id=? ORDER BY created_at DESC').all(req.auth!.tenantId)));
growthRoutes.post('/campaigns',(req,res)=>{const p=z.object({name:z.string().min(3),channel:z.enum(['whatsapp','email']).default('whatsapp'),segment:z.enum(['all','active','inactive','vip']).default('all'),subject:z.string().max(150).optional(),message:z.string().min(3).max(2000),templateName:z.string().max(100).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Campanha inválida'});if(p.data.channel==='whatsapp'&&!p.data.templateName)return res.status(400).json({error:'Informe o template aprovado do WhatsApp'});const id=randomUUID();db.prepare('INSERT INTO campaigns (id,tenant_id,name,channel,audience_rule,subject,message,template_name) VALUES (?,?,?,?,?,?,?,?)').run(id,req.auth!.tenantId,p.data.name,p.data.channel,JSON.stringify({segment:p.data.segment}),p.data.subject??null,p.data.message,p.data.templateName??null);audit(req.auth!.tenantId,req.auth!.userId,'create','campaign',id,{segment:p.data.segment,channel:p.data.channel});res.status(201).json({id,...p.data,status:'draft'});});

growthRoutes.post('/campaigns/:id/queue',requireRole('owner','manager'),(req,res)=>{
  const tenantId=req.auth!.tenantId,id=String(req.params.id);
  const campaign=db.prepare('SELECT id,channel,audience_rule FROM campaigns WHERE id=? AND tenant_id=?').get(id,tenantId) as {id:string;channel:string;audience_rule:string}|undefined;
  if(!campaign)return res.status(404).json({error:'Campanha não encontrada'});
  const segment=(JSON.parse(campaign.audience_rule) as {segment?:string}).segment||'all';
  const customers=db.prepare(`SELECT c.id,c.email,c.phone,COUNT(s.id) frequency,COALESCE(SUM(s.total_cents),0) value_cents,MAX(s.occurred_at) last_purchase FROM customers c LEFT JOIN sales s ON s.customer_id=c.id AND s.tenant_id=c.tenant_id AND s.reversed_at IS NULL WHERE c.tenant_id=? AND COALESCE((SELECT granted FROM customer_consents cc WHERE cc.customer_id=c.id AND cc.tenant_id=c.tenant_id AND cc.purpose='marketing' ORDER BY cc.created_at DESC LIMIT 1),0)=1 GROUP BY c.id`).all(tenantId) as {id:string;email:string|null;phone:string|null;frequency:number;value_cents:number;last_purchase:string|null}[];
  const cutoff=Date.now()-45*86_400_000;
  const eligible=customers.filter(customer=>{const group=!customer.last_purchase||new Date(customer.last_purchase).getTime()<cutoff?'inactive':customer.frequency>=3||customer.value_cents>=50000?'vip':'active';return (segment==='all'||segment===group)&&(campaign.channel==='email'?Boolean(customer.email):Boolean(customer.phone));});
  const insert=db.prepare('INSERT OR IGNORE INTO campaign_deliveries (id,tenant_id,campaign_id,customer_id,channel,recipient,provider) VALUES (?,?,?,?,?,?,?)');
  let queued=0;db.transaction(()=>eligible.forEach(customer=>{const result=insert.run(randomUUID(),tenantId,id,customer.id,campaign.channel,campaign.channel==='email'?customer.email:customer.phone,campaign.channel==='email'?'resend':'meta');queued+=result.changes;}))();
  db.prepare("UPDATE campaigns SET status='queued' WHERE id=? AND tenant_id=?").run(id,tenantId);audit(tenantId,req.auth!.userId,'queue','campaign',id,{queued,eligible:eligible.length});res.json({queued,eligible:eligible.length});
});

growthRoutes.post('/campaigns/process',requireRole('owner','manager'),async(req,res)=>{const result=await processCampaignBatch(req.auth!.tenantId);audit(req.auth!.tenantId,req.auth!.userId,'process_deliveries','campaign',undefined,result);res.json(result);});
growthRoutes.get('/campaigns/:id/deliveries',(req,res)=>{const id=String(req.params.id);if(!db.prepare('SELECT id FROM campaigns WHERE id=? AND tenant_id=?').get(id,req.auth!.tenantId))return res.status(404).json({error:'Campanha não encontrada'});res.json(db.prepare('SELECT id,customer_id,channel,provider,status,error,attempts,created_at,sent_at FROM campaign_deliveries WHERE campaign_id=? AND tenant_id=? ORDER BY created_at').all(id,req.auth!.tenantId));});
