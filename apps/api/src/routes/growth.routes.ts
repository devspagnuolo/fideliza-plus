import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { db } from '../database/db.js';

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
  const inactive=db.prepare(`SELECT COUNT(*) total FROM customers c WHERE c.tenant_id=? AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.customer_id=c.id AND s.reversed_at IS NULL AND s.occurred_at>=datetime('now','-45 days'))`).get(tenantId) as {total:number};
  const recommendations=[] as any[];
  if(inactive.total)recommendations.push({title:'Reative clientes inativos',description:`${inactive.total} clientes estão sem comprar há 45 dias. Crie uma campanha de retorno.`,impact:'Alto'});
  if(stats.customers<20)recommendations.push({title:'Amplie sua base identificada',description:'Cadastre o cliente no caixa para transformar vendas anônimas em relacionamento.',impact:'Médio'});
  res.json({...stats,averageTicketCents:stats.sales?Math.round(stats.revenueCents/stats.sales):0,identificationRate:stats.customers?Math.round(stats.activeCustomers/stats.customers*100):0,activation:activationFor(tenantId),recommendations});
});

growthRoutes.get('/campaigns',(req,res)=>res.json(db.prepare('SELECT * FROM campaigns WHERE tenant_id=? ORDER BY created_at DESC').all(req.auth!.tenantId)));
growthRoutes.post('/campaigns',(req,res)=>{const p=z.object({name:z.string().min(3),channel:z.enum(['whatsapp','email','sms']).default('whatsapp'),segment:z.enum(['all','active','inactive','vip']).default('all')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Campanha inválida'});const id=randomUUID();db.prepare('INSERT INTO campaigns (id,tenant_id,name,channel,audience_rule) VALUES (?,?,?,?,?)').run(id,req.auth!.tenantId,p.data.name,p.data.channel,JSON.stringify({segment:p.data.segment}));audit(req.auth!.tenantId,req.auth!.userId,'create','campaign',id,{segment:p.data.segment});res.status(201).json({id,...p.data,status:'draft'});});
