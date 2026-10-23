import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth, requireRole } from '../auth.js';
import { db } from '../database/db.js';
import { customerVipTier,redemptionLimit } from '../loyalty.js';
import { PLAN_FEATURES,requirePlanFeature,requirePlanStorage } from '../plan-catalog.js';
import { APP_CHANNEL_SQL,REWARD_CHANNELS,hasSiteIntegration } from '../reward-channels.js';

export const rewardRoutes = Router();
const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
rewardRoutes.use(requireAuth);
rewardRoutes.use(['/rewards','/reward-redemptions'],requirePlanFeature(PLAN_FEATURES.REWARDS));

rewardRoutes.get('/rewards/channels', (req, res) => res.json({ siteIntegration: hasSiteIntegration(req.auth!.tenantId) }));

rewardRoutes.get('/rewards', (req, res) => res.json(db.prepare(`
  SELECT r.id,r.name,r.description,r.points_cost,r.active,r.created_at,r.reward_type,r.image_data,r.product_sku,r.discount_type,r.discount_value,r.minimum_order_cents,r.valid_from,r.valid_until,r.minimum_tier_rank,r.channel,lt.name minimum_tier_name,
    (SELECT COUNT(*) FROM reward_redemptions rr WHERE rr.reward_id=r.id AND rr.tenant_id=r.tenant_id) redemptions
  FROM rewards r LEFT JOIN loyalty_tiers lt ON lt.tenant_id=r.tenant_id AND lt.rank=r.minimum_tier_rank
  WHERE r.tenant_id=? AND r.reward_type='coupon' ORDER BY r.active DESC,r.points_cost,r.name
`).all(req.auth!.tenantId)));

const dateField=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Data inválida');
const rewardFields = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  pointsCost: z.number().int().positive(),
  rewardType: z.literal('coupon').default('coupon'),
  imageData: z.string().max(1_600_000).refine(value=>!value||/^data:image\/(png|jpe?g|webp);base64,/i.test(value)).optional(),
  productSku: z.string().trim().max(80).optional(),
  discountType: z.enum(['percent','fixed']).optional(),
  discountValue: z.number().int().positive().optional(),
  minimumOrderCents: z.number().int().nonnegative().default(0),
  validFrom: dateField.optional(),
  validUntil: dateField,
  minimumTierRank: z.number().int().positive().nullable().optional(),
  channel: z.enum(REWARD_CHANNELS).optional(),
}).superRefine((value,ctx)=>{
  if(!value.discountType||!value.discountValue)ctx.addIssue({code:'custom',path:['discountValue'],message:'Toda recompensa em cupom precisa de tipo e valor de desconto'});
  if(value.discountType==='percent'&&value.discountValue&&value.discountValue>100)ctx.addIssue({code:'custom',path:['discountValue'],message:'O desconto percentual não pode exceder 100%'});
  if(value.validFrom&&value.validFrom>value.validUntil)ctx.addIssue({code:'custom',path:['validUntil'],message:'A validade final deve ser posterior ao início'});
});

rewardRoutes.post('/rewards', requireRole('owner', 'manager'), requirePlanStorage, (req, res) => {
  const parsed = rewardFields.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Recompensa inválida' });
  if(parsed.data.validUntil<businessDate())return res.status(400).json({error:'A validade não pode estar no passado'});
  if(parsed.data.minimumTierRank&&!db.prepare('SELECT 1 FROM loyalty_tiers WHERE tenant_id=? AND rank=?').get(req.auth!.tenantId,parsed.data.minimumTierRank))return res.status(400).json({error:'Nível de cliente inválido'});
  const siteIntegration=hasSiteIntegration(req.auth!.tenantId);
  const channel=parsed.data.channel??(siteIntegration?'both':'app');
  if(channel!=='app'&&!siteIntegration)return res.status(400).json({error:'Recompensas para o site exigem uma integração de site ativa'});
  const id = randomUUID();
  db.prepare('INSERT INTO rewards (id,tenant_id,name,description,points_cost,stock,reward_type,image_data,product_sku,discount_type,discount_value,minimum_order_cents,valid_from,valid_until,minimum_tier_rank,channel) VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.auth!.tenantId, parsed.data.name, parsed.data.description || null, parsed.data.pointsCost,parsed.data.rewardType,parsed.data.imageData||null,parsed.data.productSku||null,parsed.data.discountType||null,parsed.data.discountValue||null,parsed.data.minimumOrderCents,parsed.data.validFrom||null,parsed.data.validUntil,parsed.data.minimumTierRank??null,channel);
  audit(req.auth!.tenantId, req.auth!.userId, 'create', 'reward', id, { pointsCost: parsed.data.pointsCost, channel });
  res.status(201).json({ id });
});

const rewardUpdate = z.object({name:z.string().trim().min(2).max(100).optional(),description:z.string().trim().max(500).optional(),pointsCost:z.number().int().positive().optional(),rewardType:z.literal('coupon').optional(),imageData:z.string().max(1_600_000).optional(),productSku:z.string().trim().max(80).optional(),discountType:z.enum(['percent','fixed']).nullable().optional(),discountValue:z.number().int().positive().nullable().optional(),minimumOrderCents:z.number().int().nonnegative().optional(),validFrom:dateField.nullable().optional(),validUntil:dateField.optional(),minimumTierRank:z.number().int().positive().nullable().optional(),channel:z.enum(REWARD_CHANNELS).optional(),active:z.boolean().optional()}).refine(
  value => Object.keys(value).length > 0,
  'Informe ao menos uma alteração',
);

rewardRoutes.patch('/rewards/:id', requireRole('owner', 'manager'), requirePlanStorage, (req, res) => {
  const parsed = rewardUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Alteração inválida' });
  const id = String(req.params.id);
  const current = db.prepare('SELECT * FROM rewards WHERE id=? AND tenant_id=?').get(id, req.auth!.tenantId) as any;
  if (!current) return res.status(404).json({ error: 'Recompensa não encontrada' });
  const changes = parsed.data;
  const nextDiscountType=changes.discountType===undefined?current.discount_type:changes.discountType;
  const nextDiscountValue=changes.discountValue===undefined?current.discount_value:changes.discountValue;
  if(!nextDiscountType||!Number.isInteger(Number(nextDiscountValue))||Number(nextDiscountValue)<=0)return res.status(400).json({error:'Toda recompensa em cupom precisa de tipo e valor de desconto'});
  if(nextDiscountType==='percent'&&Number(nextDiscountValue)>100)return res.status(400).json({error:'O desconto percentual não pode exceder 100%'});
  if(changes.validUntil&&changes.validUntil<businessDate())return res.status(400).json({error:'A validade não pode estar no passado'});
  const nextFrom=changes.validFrom===undefined?current.valid_from:changes.validFrom,nextUntil=changes.validUntil??current.valid_until;
  if(nextFrom&&nextUntil&&nextFrom>nextUntil)return res.status(400).json({error:'A validade final deve ser posterior ao início'});
  if(changes.minimumTierRank&&!db.prepare('SELECT 1 FROM loyalty_tiers WHERE tenant_id=? AND rank=?').get(req.auth!.tenantId,changes.minimumTierRank))return res.status(400).json({error:'Nível de cliente inválido'});
  if(changes.channel&&changes.channel!=='app'&&changes.channel!==current.channel&&!hasSiteIntegration(req.auth!.tenantId))return res.status(400).json({error:'Recompensas para o site exigem uma integração de site ativa'});
  db.prepare(`UPDATE rewards SET
    name=COALESCE(?,name),
    description=CASE WHEN ? THEN ? ELSE description END,
    points_cost=COALESCE(?,points_cost),
    stock=NULL,
    active=COALESCE(?,active),reward_type=?,image_data=?,product_sku=?,discount_type=?,discount_value=?,minimum_order_cents=?,valid_from=?,valid_until=?,minimum_tier_rank=?,channel=?
    WHERE id=? AND tenant_id=?`).run(
      changes.name ?? null,
      changes.description !== undefined ? 1 : 0,
      changes.description || null,
      changes.pointsCost ?? null,
      changes.active === undefined ? null : changes.active ? 1 : 0,
      changes.rewardType??current.reward_type,
      changes.imageData===undefined?current.image_data:changes.imageData||null,
      changes.productSku===undefined?current.product_sku:changes.productSku||null,
      changes.discountType===undefined?current.discount_type:changes.discountType,
      changes.discountValue===undefined?current.discount_value:changes.discountValue,
      changes.minimumOrderCents??current.minimum_order_cents,
      nextFrom||null,
      nextUntil,
      changes.minimumTierRank===undefined?current.minimum_tier_rank:changes.minimumTierRank,
      changes.channel??current.channel,
      id,
      req.auth!.tenantId,
    );
  audit(req.auth!.tenantId, req.auth!.userId, 'update', 'reward', id, changes);
  res.status(204).end();
});

rewardRoutes.delete('/rewards/:id', requireRole('owner', 'manager'), (req, res) => {
  const id = String(req.params.id);
  const reward = db.prepare(`SELECT id,name,
    (SELECT COUNT(*) FROM reward_redemptions rr WHERE rr.reward_id=rewards.id AND rr.tenant_id=rewards.tenant_id) redemptions
    FROM rewards WHERE id=? AND tenant_id=?`).get(id, req.auth!.tenantId) as { id: string; name: string; redemptions: number } | undefined;
  if (!reward) return res.status(404).json({ error: 'Recompensa não encontrada' });
  const archived = reward.redemptions > 0;
  if (archived) db.prepare('UPDATE rewards SET active=0 WHERE id=? AND tenant_id=?').run(id, req.auth!.tenantId);
  else db.prepare('DELETE FROM rewards WHERE id=? AND tenant_id=?').run(id, req.auth!.tenantId);
  audit(req.auth!.tenantId, req.auth!.userId, archived ? 'archive' : 'delete', 'reward', id, { name: reward.name, redemptions: reward.redemptions });
  res.json({ deleted: !archived, archived });
});

rewardRoutes.post('/rewards/:id/redeem', (req, res) => {
  const parsed = z.object({ customerId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Cliente inválido' });
  try {
    const result = db.transaction(() => {
      const reward = db.prepare(`SELECT id,name,points_cost,active,valid_from,valid_until,minimum_tier_rank,discount_type,discount_value FROM rewards WHERE id=? AND tenant_id=? AND ${APP_CHANNEL_SQL}`).get(String(req.params.id), req.auth!.tenantId) as any;
      const customer = db.prepare('SELECT id,points_balance FROM customers WHERE id=? AND tenant_id=?').get(parsed.data.customerId, req.auth!.tenantId) as { id: string; points_balance: number } | undefined;
      if (!reward || !reward.active) throw new Error('REWARD');
      if(!['percent','fixed'].includes(reward.discount_type)||!Number.isInteger(Number(reward.discount_value))||Number(reward.discount_value)<=0||reward.discount_type==='percent'&&Number(reward.discount_value)>100)throw new Error('INVALID_DISCOUNT');
      if (!customer) throw new Error('CUSTOMER');
      const today=businessDate(),tierRank=customerVipTier(req.auth!.tenantId,customer.id)?.current?.rank??0;
      if(reward.valid_from&&today<reward.valid_from||reward.valid_until&&today>reward.valid_until)throw new Error('VALIDITY');
      if(reward.minimum_tier_rank&&tierRank<reward.minimum_tier_rank)throw new Error('TIER');
      if (customer.points_balance < reward.points_cost) throw new Error('BALANCE');
      if (!redemptionLimit(req.auth!.tenantId, customer.id).allowed) throw new Error('LIMIT');
      const id = randomUUID();
      db.prepare('UPDATE customers SET points_balance=points_balance-? WHERE id=? AND tenant_id=?').run(reward.points_cost, customer.id, req.auth!.tenantId);
      db.prepare("INSERT INTO loyalty_ledger (id,tenant_id,customer_id,points,reason,entry_type) VALUES (?,?,?,?,?,'redemption')").run(randomUUID(), req.auth!.tenantId, customer.id, -reward.points_cost, `Resgate · ${reward.name}`);
      db.prepare('INSERT INTO reward_redemptions (id,tenant_id,reward_id,customer_id,points_spent,redeemed_by,expires_at) VALUES (?,?,?,?,?,?,?)').run(id, req.auth!.tenantId, reward.id, customer.id, reward.points_cost, req.auth!.userId,reward.valid_until||null);
      return { id, reward: reward.name, pointsSpent: reward.points_cost, balance: customer.points_balance - reward.points_cost };
    })();
    audit(req.auth!.tenantId, req.auth!.userId, 'redeem', 'reward', result.id, { customerId: parsed.data.customerId, points: result.pointsSpent });
    res.status(201).json(result);
  } catch (error) {
    const code = (error as Error).message;
    const map: Record<string, [number, string]> = { INVALID_DISCOUNT:[409,'Esta recompensa está sem uma regra válida de desconto. Corrija o tipo e o valor antes de resgatar.'], REWARD: [404, 'Recompensa não encontrada'], CUSTOMER: [404, 'Cliente não encontrado'], BALANCE: [409, 'Saldo de pontos insuficiente'], VALIDITY:[409,'Este benefício está fora do período de validade'],TIER:[403,'Este benefício é exclusivo para outro nível de cliente'], LIMIT: [429, 'Limite diário de resgates atingido. Tente novamente amanhã ou solicite análise da loja.'] };
    const response = map[code];
    if (response) return res.status(response[0]).json({ error: response[1] });
    throw error;
  }
});

rewardRoutes.get('/reward-redemptions', (req, res) => res.json(db.prepare(`SELECT rr.id,rr.points_spent,rr.status,rr.redemption_code,rr.code_generated_at,rr.used_at,rr.order_number,rr.expires_at,rr.created_at,r.name reward_name,c.name customer_name,c.cpf customer_cpf,u.name used_by_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN customers c ON c.id=rr.customer_id LEFT JOIN users u ON u.id=rr.used_by WHERE rr.tenant_id=? ORDER BY rr.created_at DESC LIMIT 200`).all(req.auth!.tenantId)));

rewardRoutes.post('/reward-redemptions/validate', requireRole('owner', 'manager', 'operator'), (req, res) => {
  const parsed = z.object({ code: z.string().trim().min(8).max(20), orderNumber: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe o código e o número do pedido' });
  const code = parsed.data.code.replace(/\s/g, '').toUpperCase();
  try {
    const result = db.transaction(() => {
      const redemption = db.prepare(`SELECT rr.id,rr.status,rr.used_at,rr.expires_at,r.name reward_name,c.name customer_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN customers c ON c.id=rr.customer_id WHERE rr.tenant_id=? AND upper(rr.redemption_code)=?`).get(req.auth!.tenantId, code) as any;
      if (!redemption) throw new Error('NOT_FOUND');
      if (redemption.status === 'used') throw new Error('USED');
      if(redemption.expires_at&&businessDate()>redemption.expires_at)throw new Error('EXPIRED');
      if (redemption.status !== 'ready_for_use') throw new Error('STATUS');
      const update = db.prepare("UPDATE reward_redemptions SET status='used',used_at=CURRENT_TIMESTAMP,used_by=?,order_number=? WHERE id=? AND tenant_id=? AND status='ready_for_use'").run(req.auth!.userId, parsed.data.orderNumber, redemption.id, req.auth!.tenantId);
      if (!update.changes) throw new Error('RACE');
      return { id: redemption.id, reward: redemption.reward_name, customer: redemption.customer_name, orderNumber: parsed.data.orderNumber, status: 'used' };
    })();
    audit(req.auth!.tenantId, req.auth!.userId, 'use', 'reward_redemption', result.id, { code, orderNumber: result.orderNumber });
    res.json(result);
  } catch (error) {
    const code = (error as Error).message;
    if (code === 'NOT_FOUND') return res.status(404).json({ error: 'Código não encontrado para esta loja' });
    if (code === 'USED') return res.status(409).json({ error: 'Este código já foi utilizado' });
    if (code === 'EXPIRED') return res.status(409).json({ error: 'Este cupom está vencido' });
    return res.status(409).json({ error: 'Código ainda não liberado ou em processamento' });
  }
});
