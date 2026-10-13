import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth, requireRole } from '../auth.js';
import { db } from '../database/db.js';

export const loyaltyRoutes = Router();
loyaltyRoutes.use(requireAuth);

loyaltyRoutes.get('/loyalty/promotions', (req, res) => res.json(db.prepare('SELECT id,name,multiplier,starts_at,ends_at,active,created_at FROM loyalty_promotions WHERE tenant_id=? ORDER BY starts_at DESC').all(req.auth!.tenantId)));

loyaltyRoutes.post('/loyalty/promotions', requireRole('owner', 'manager'), (req, res) => {
  const parsed = z.object({ name: z.string().min(3).max(100), multiplier: z.number().min(1.1).max(10), startsAt: z.string().datetime(), endsAt: z.string().datetime() }).refine((data) => data.endsAt > data.startsAt, { message: 'Período inválido' }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Campanha de pontos inválida' });
  const id = randomUUID();
  db.prepare('INSERT INTO loyalty_promotions (id,tenant_id,name,multiplier,starts_at,ends_at) VALUES (?,?,?,?,?,?)').run(id, req.auth!.tenantId, parsed.data.name, parsed.data.multiplier, parsed.data.startsAt, parsed.data.endsAt);
  audit(req.auth!.tenantId, req.auth!.userId, 'create_promotion', 'loyalty_promotion', id, { multiplier: parsed.data.multiplier });
  res.status(201).json({ id, ...parsed.data, active: 1 });
});

loyaltyRoutes.patch('/loyalty/promotions/:id/status', requireRole('owner', 'manager'), (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Status inválido' });
  const id = String(req.params.id);
  const result = db.prepare('UPDATE loyalty_promotions SET active=? WHERE id=? AND tenant_id=?').run(parsed.data.active ? 1 : 0, id, req.auth!.tenantId);
  if (!result.changes) return res.status(404).json({ error: 'Campanha de pontos não encontrada' });
  audit(req.auth!.tenantId, req.auth!.userId, 'promotion_status', 'loyalty_promotion', id, parsed.data);
  res.json({ ok: true });
});

loyaltyRoutes.get('/loyalty/tiers',(req,res)=>res.json({items:db.prepare('SELECT id,name,rank,min_lifetime_points minLifetimePoints,color,benefits FROM loyalty_tiers WHERE tenant_id=? ORDER BY rank').all(req.auth!.tenantId)}));
loyaltyRoutes.put('/loyalty/tiers',requireRole('owner','manager'),(req,res)=>{
  const parsed=z.object({tiers:z.array(z.object({name:z.string().trim().min(2).max(60),rank:z.number().int().min(1).max(20),minLifetimePoints:z.number().int().min(0),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal('')),benefits:z.string().trim().max(500).optional()})).max(10)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Revise os níveis informados'});
  const tiers=[...parsed.data.tiers].sort((a,b)=>a.rank-b.rank),ranks=new Set(tiers.map(x=>x.rank));
  if(ranks.size!==tiers.length)return res.status(400).json({error:'Cada nível deve ter uma posição única'});
  if(tiers.some((tier,index)=>index>0&&tier.minLifetimePoints<=tiers[index-1]!.minLifetimePoints))return res.status(400).json({error:'A pontuação mínima deve crescer conforme a posição do nível'});
  const insert=db.prepare('INSERT INTO loyalty_tiers(id,tenant_id,name,rank,min_lifetime_points,color,benefits)VALUES(?,?,?,?,?,?,?)');
  db.transaction(()=>{db.prepare('DELETE FROM loyalty_tiers WHERE tenant_id=?').run(req.auth!.tenantId);for(const tier of tiers)insert.run(randomUUID(),req.auth!.tenantId,tier.name,tier.rank,tier.minLifetimePoints,tier.color||null,tier.benefits||null)})();
  audit(req.auth!.tenantId,req.auth!.userId,'replace_tiers','loyalty_tier',undefined,{count:tiers.length});
  res.json({items:db.prepare('SELECT id,name,rank,min_lifetime_points minLifetimePoints,color,benefits FROM loyalty_tiers WHERE tenant_id=? ORDER BY rank').all(req.auth!.tenantId)});
});

loyaltyRoutes.post('/customers/:id/loyalty/adjust', requireRole('owner', 'manager'), (req, res) => {
  const customerId = String(req.params.id);
  const tenantId = req.auth!.tenantId;
  const parsed = z.object({ points: z.number().int().refine((value) => value !== 0), reason: z.string().trim().min(5).max(240) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Ajuste inválido' });
  try {
    db.transaction(() => {
      const customer = db.prepare('SELECT points_balance,name FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId) as { points_balance: number;name:string } | undefined;
      if (!customer) throw new Error('NOT_FOUND');
      if (customer.points_balance + parsed.data.points < 0) throw new Error('INSUFFICIENT');
      const newBalance=customer.points_balance+parsed.data.points;
      db.prepare('UPDATE customers SET points_balance=? WHERE id=? AND tenant_id=?').run(newBalance, customerId, tenantId);
      db.prepare("INSERT INTO loyalty_ledger (id,tenant_id,customer_id,points,reason,entry_type) VALUES (?,?,?,?,?,'adjustment')").run(randomUUID(), tenantId, customerId, parsed.data.points, parsed.data.reason);
      db.prepare("INSERT INTO customer_notifications(id,tenant_id,customer_id,title,message,type) VALUES(?,?,?,?,?,'points')").run(randomUUID(),tenantId,customerId,'Ajuste no saldo de pontos',`${parsed.data.points>0?'+':''}${parsed.data.points} ponto(s): ${parsed.data.reason}. Saldo atual: ${newBalance} ponto(s).`);
      audit(tenantId, req.auth!.userId, 'adjust_points', 'customer', customerId, {...parsed.data,previousBalance:customer.points_balance,newBalance});
    })();
    res.json({ ok: true });
  } catch (error) {
    if ((error as Error).message === 'NOT_FOUND') return res.status(404).json({ error: 'Cliente não encontrado' });
    if ((error as Error).message === 'INSUFFICIENT') return res.status(409).json({ error: 'O ajuste deixaria o saldo negativo' });
    throw error;
  }
});
