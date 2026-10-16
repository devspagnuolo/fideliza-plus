import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireApiKey } from '../api-key-auth.js';
import { normalizeCpf, validCpf } from '../cpf.js';
import { db } from '../database/db.js';
import { customerVipTier } from '../loyalty.js';
import { PLAN_FEATURES, tenantPlan } from '../plan-catalog.js';

export const storeOsApiRoutes = Router();
const cpfSchema = z.string().transform(normalizeCpf).refine(validCpf, 'CPF inválido');
const businessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const externalIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const requireErpPlan = (req: Request, res: Response, next: (error?: unknown) => void) => {
  const plan = tenantPlan(req.apiKey!.tenantId);
  if (!plan) return res.status(503).json({ error: 'Plano da empresa não configurado.', code: 'PLAN_CONFIGURATION_REQUIRED' });
  if (!['active', 'trialing'].includes(String(plan.status))) return res.status(403).json({ error: 'Assinatura sem acesso ativo.', code: 'SUBSCRIPTION_INACTIVE' });
  if (!plan.features.includes(PLAN_FEATURES.ERP_INTEGRATIONS)) return res.status(403).json({ error: 'Integrações ERP não estão incluídas no plano.', code: 'PLAN_UPGRADE_REQUIRED', requiredFeature: PLAN_FEATURES.ERP_INTEGRATIONS });
  next();
};
type Reply = { status: number; body: Record<string, unknown> };
function idempotent(req: Request, res: Response, operation: string, action: () => Reply) {
  const key = String(req.header('Idempotency-Key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return res.status(400).json({ error: 'Envie Idempotency-Key único (8 a 128 caracteres) para esta operação.' });
  const apiKeyId = req.apiKey!.id, tenantId = req.apiKey!.tenantId;
  const requestHash = createHash('sha256').update(JSON.stringify({ operation, body: req.body })).digest('hex');
  try {
    const result = db.transaction(() => {
      db.prepare("DELETE FROM storeos_idempotency WHERE api_key_id=? AND expires_at<=CURRENT_TIMESTAMP").run(apiKeyId);
      const cached = db.prepare('SELECT request_hash,response_json,status_code FROM storeos_idempotency WHERE api_key_id=? AND idempotency_key=?').get(apiKeyId, key) as { request_hash: string; response_json: string; status_code: number } | undefined;
      if (cached) {
        if (cached.request_hash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT');
        return { status: cached.status_code, body: JSON.parse(cached.response_json) as Record<string, unknown> };
      }
      const reply = action();
      db.prepare('INSERT INTO storeos_idempotency(api_key_id,idempotency_key,request_hash,response_json,status_code,expires_at) VALUES(?,?,?,?,?,datetime(\'now\',\'+24 hours\'))')
        .run(apiKeyId, key, requestHash, JSON.stringify(reply.body), reply.status);
      return reply;
    })();
    return res.status(result.status).json(result.body);
  } catch (error) {
    if ((error as Error).message === 'IDEMPOTENCY_CONFLICT') return res.status(409).json({ error: 'Esta chave de idempotência já foi usada com outro conteúdo.', code: 'IDEMPOTENCY_KEY_REUSED' });
    throw error;
  }
}
function addEvent(tenantId: string, externalCustomerId: string, eventType: string, entityId: string, payload: Record<string, unknown>) {
  db.prepare('INSERT INTO storeos_events(tenant_id,external_customer_id,event_type,entity_id,payload) VALUES(?,?,?,?,?)')
    .run(tenantId, externalCustomerId, eventType, entityId, JSON.stringify(payload));
}
function findLink(tenantId: string, externalCustomerId: string) {
  return db.prepare(`SELECT c.id,c.name,c.cpf,c.points_balance,c.enrolled_at,c.deleted_at,l.external_customer_id
    FROM storeos_customer_links l JOIN customers c ON c.id=l.customer_id
    WHERE l.tenant_id=? AND l.external_customer_id=?`).get(tenantId, externalCustomerId) as any;
}
function linkCustomer(tenantId: string, externalCustomerId: string, customerId: string) {
  const existing = db.prepare('SELECT customer_id FROM storeos_customer_links WHERE tenant_id=? AND external_customer_id=?').get(tenantId, externalCustomerId) as { customer_id: string } | undefined;
  if (existing && existing.customer_id !== customerId) throw new Error('LINK_CONFLICT');
  db.prepare(`INSERT INTO storeos_customer_links(tenant_id,external_customer_id,customer_id)
    VALUES(?,?,?) ON CONFLICT(tenant_id,external_customer_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`).run(tenantId, externalCustomerId, customerId);
}
function releaseExpiredReservations(tenantId: string) {
  const rows = db.prepare(`SELECT rr.id,rr.reward_id,rr.customer_id,rr.points_spent,rr.expires_at,rr.reservation_expires_at,l.external_customer_id,r.name
    FROM reward_redemptions rr JOIN storeos_customer_links l ON l.customer_id=rr.customer_id AND l.tenant_id=rr.tenant_id
    JOIN rewards r ON r.id=rr.reward_id
    WHERE rr.tenant_id=? AND rr.external_source='storeos' AND rr.status='ready_for_use'`).all(tenantId) as any[];
  const today = businessDate();
  db.transaction(() => {
    for (const row of rows) {
      const expired = row.reservation_expires_at && new Date(row.reservation_expires_at).getTime() <= Date.now() ||
        row.expires_at && String(row.expires_at).slice(0, 10) < today;
      if (!expired) continue;
      const changed = db.prepare("UPDATE reward_redemptions SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status='ready_for_use'").run(row.id, tenantId);
      if (!changed.changes) continue;
      db.prepare('UPDATE customers SET points_balance=points_balance+? WHERE id=? AND tenant_id=?').run(row.points_spent, row.customer_id, tenantId);
      db.prepare("INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type) VALUES(?,?,?,?,?,'reinstatement')").run(randomUUID(), tenantId, row.customer_id, row.points_spent, `Liberação automática de resgate StoreOS expirado: ${row.name}`);
      db.prepare('UPDATE rewards SET stock=stock+1 WHERE id=? AND tenant_id=? AND stock IS NOT NULL').run(row.reward_id, tenantId);
      addEvent(tenantId, row.external_customer_id, 'redemption.expired', row.id, { pointsRestored: row.points_spent });
    }
  })();
}
const enrollmentBody = z.object({
  externalCustomerId: externalIdSchema,
  name: z.string().trim().min(2).max(120).optional(),
  cpf: cpfSchema,
  email: z.string().email().max(254).optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
  programConsent: z.boolean().default(false),
  termsVersion: z.string().trim().max(40).optional(),
  privacyVersion: z.string().trim().max(40).optional()
});
storeOsApiRoutes.post('/storeos/customers/enroll', requireApiKey('customers:write'), requireErpPlan, (req, res) => {
  const parsed = enrollmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados de cadastro inválidos.' });
  const p = parsed.data, tenantId = req.apiKey!.tenantId;
  return idempotent(req, res, 'customer.enroll', () => {
    const result = db.transaction(() => {
      const mapped = findLink(tenantId, p.externalCustomerId);
      const customer = db.prepare('SELECT id,name,cpf,email,phone,points_balance,enrolled_at,deleted_at FROM customers WHERE tenant_id=? AND cpf=?').get(tenantId, p.cpf) as any;
      if (mapped && mapped.cpf !== p.cpf) throw new Error('LINK_CONFLICT');
      if (mapped && mapped.deleted_at) throw new Error('CUSTOMER_INACTIVE');
      if (!customer) {
        if (!p.programConsent || !p.name) throw new Error('CONSENT_REQUIRED');
        const plan = tenantPlan(tenantId);
        const count = Number((db.prepare('SELECT COUNT(*) total FROM customers WHERE tenant_id=? AND deleted_at IS NULL').get(tenantId) as any).total);
        if (plan && count >= plan.consumerLimit) throw new Error('LIMIT');
      } else if (!customer.enrolled_at && !p.programConsent) throw new Error('CONSENT_REQUIRED');
      const id = customer?.id || randomUUID(), newlyEnrolled = !customer?.enrolled_at;
      if (customer) {
        if (customer.deleted_at) throw new Error('CUSTOMER_INACTIVE');
        db.prepare(`UPDATE customers SET name=COALESCE(?,name),email=COALESCE(?,email),phone=COALESCE(?,phone),
          enrolled_at=CASE WHEN ? THEN COALESCE(enrolled_at,CURRENT_TIMESTAMP) ELSE enrolled_at END,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND tenant_id=?`).run(p.name || null, p.email || null, p.phone || null, p.programConsent ? 1 : 0, id, tenantId);
      } else {
        db.prepare("INSERT INTO customers(id,tenant_id,name,cpf,email,phone,enrolled_at,status) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,'active')")
          .run(id, tenantId, p.name, p.cpf, p.email || null, p.phone || null);
      }
      if (newlyEnrolled) db.prepare(`INSERT INTO customer_consents(id,tenant_id,customer_id,purpose,granted,source,document_version,privacy_version,ip_address,user_agent)
        VALUES(?,?,?,'loyalty_program',1,'storeos',?,?,?,?,?)`).run(randomUUID(), tenantId, id, p.termsVersion || null, p.privacyVersion || null, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 500) || null);
      linkCustomer(tenantId, p.externalCustomerId, id);
      const view = db.prepare('SELECT id,name,cpf,points_balance,enrolled_at FROM customers WHERE id=? AND tenant_id=?').get(id, tenantId) as any;
      addEvent(tenantId, p.externalCustomerId, newlyEnrolled ? 'customer.enrolled' : 'customer.linked', id, { customerId: id });
      return { status: customer ? 200 : 201, body: { data: { id: view.id, name: view.name, cpf: view.cpf, pointsBalance: Number(view.points_balance), enrolledAt: view.enrolled_at, externalCustomerId: p.externalCustomerId, eligibleForPoints: Boolean(view.enrolled_at) } } };
    })();
    audit(tenantId, req.apiKey!.createdBy, 'storeos.customer_enroll', 'customer', result.body.data.id as string, { apiKeyId: req.apiKey!.id, externalCustomerId: p.externalCustomerId, programConsent: p.programConsent });
    return result;
  });
});
storeOsApiRoutes.get('/storeos/customers/:externalCustomerId/loyalty', requireApiKey('rewards:read'), requireErpPlan, (req, res) => {
  const tenantId = req.apiKey!.tenantId, externalCustomerId = String(req.params.externalCustomerId);
  if (!externalIdSchema.safeParse(externalCustomerId).success) return res.status(400).json({ error: 'Identificador externo inválido.' });
  releaseExpiredReservations(tenantId);
  const customer = findLink(tenantId, externalCustomerId);
  if (!customer || customer.deleted_at || !customer.enrolled_at) return res.status(404).json({ error: 'Cliente Fidelizei não localizado ou sem adesão ativa.' });
  const tierRank = customerVipTier(tenantId, customer.id)?.current?.rank ?? 0, today = businessDate();
  const rewards = db.prepare(`SELECT id,name,description,points_cost pointsCost,discount_type discountType,discount_value discountValue,
    minimum_order_cents minimumOrderCents,valid_from validFrom,valid_until validUntil,minimum_tier_rank minimumTierRank
    FROM rewards WHERE tenant_id=? AND active=1 AND reward_type='coupon' AND (valid_from IS NULL OR valid_from<=?)
    AND (valid_until IS NULL OR valid_until>=?) AND COALESCE(minimum_tier_rank,0)<=? ORDER BY points_cost`)
    .all(tenantId, today, today, tierRank) as any[];
  return res.json({ data: { customer: { id: customer.id, externalCustomerId, name: customer.name, pointsBalance: Number(customer.points_balance), enrolledAt: customer.enrolled_at }, tierRank,
    rewards: rewards.map(reward => ({ ...reward, canRedeem: Number(customer.points_balance) >= Number(reward.pointsCost), reason: Number(customer.points_balance) >= Number(reward.pointsCost) ? null : 'INSUFFICIENT_POINTS' })) } });
});
const reserveBody = z.object({ externalCustomerId: externalIdSchema, rewardId: z.string().uuid(), checkoutId: externalIdSchema, subtotalCents: z.number().int().nonnegative().optional() });
storeOsApiRoutes.post('/storeos/redemptions', requireApiKey('rewards:redeem'), requireErpPlan, (req, res) => {
  const parsed = reserveBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados do resgate inválidos.' });
  const p = parsed.data, tenantId = req.apiKey!.tenantId;
  releaseExpiredReservations(tenantId);
  return idempotent(req, res, 'redemption.reserve', () => {
    const result = db.transaction(() => {
      const customer = findLink(tenantId, p.externalCustomerId);
      if (!customer || customer.deleted_at || !customer.enrolled_at) throw new Error('CUSTOMER');
      const reward = db.prepare("SELECT * FROM rewards WHERE id=? AND tenant_id=? AND active=1 AND reward_type='coupon'").get(p.rewardId, tenantId) as any;
      if (!reward) throw new Error('REWARD');
      const today = businessDate(), tierRank = customerVipTier(tenantId, customer.id)?.current?.rank ?? 0;
      if (reward.valid_from && today < reward.valid_from || reward.valid_until && today > reward.valid_until) throw new Error('VALIDITY');
      if (Number(reward.minimum_tier_rank || 0) > tierRank) throw new Error('TIER');
      if (Number(customer.points_balance) < Number(reward.points_cost)) throw new Error('BALANCE');
      if (p.subtotalCents !== undefined && p.subtotalCents < Number(reward.minimum_order_cents || 0)) throw new Error('MINIMUM');
      if (reward.stock !== null && Number(reward.stock) <= 0) throw new Error('STOCK');
      const id = randomUUID(); let code = '';
      do { code = `FZ-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`; } while (db.prepare('SELECT 1 FROM reward_redemptions WHERE redemption_code=?').get(code));
      const reservationExpiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
      db.prepare(`INSERT INTO reward_redemptions(id,tenant_id,reward_id,customer_id,points_spent,status,redemption_code,code_generated_at,expires_at,external_source,external_checkout_id,reservation_expires_at)
        VALUES(?,?,?,?,?,'ready_for_use',?,?,?, 'storeos',?,?)`).run(id, tenantId, reward.id, customer.id, reward.points_cost, code, new Date().toISOString(), reward.valid_until || null, p.checkoutId, reservationExpiresAt);
      db.prepare('UPDATE customers SET points_balance=points_balance-? WHERE id=? AND tenant_id=? AND points_balance>=?').run(reward.points_cost, customer.id, tenantId, reward.points_cost);
      if (reward.stock !== null) db.prepare('UPDATE rewards SET stock=stock-1 WHERE id=? AND tenant_id=? AND stock>0').run(reward.id, tenantId);
      db.prepare("INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type) VALUES(?,?,?,?,?,'redemption')").run(randomUUID(), tenantId, customer.id, -reward.points_cost, `Resgate StoreOS: ${reward.name}`);
      addEvent(tenantId, p.externalCustomerId, 'redemption.reserved', id, { rewardId: reward.id, checkoutId: p.checkoutId, code, pointsDebited: reward.points_cost, reservationExpiresAt });
      return { status: 201, body: { data: { id, code, status: 'reserved', checkoutId: p.checkoutId, pointsDebited: reward.points_cost, expiresAt: reward.valid_until || null, reservationExpiresAt, discount: { type: reward.discount_type, value: reward.discount_value, minimumOrderCents: reward.minimum_order_cents || 0 } } } };
    })();
    audit(tenantId, req.apiKey!.createdBy, 'storeos.redemption_reserve', 'reward_redemption', result.body.data.id as string, { apiKeyId: req.apiKey!.id, checkoutId: p.checkoutId });
    return result;
  });
});
const validateBody = z.object({ code: z.string().trim().min(8).max(24), externalCustomerId: externalIdSchema, checkoutId: externalIdSchema, subtotalCents: z.number().int().nonnegative() });
storeOsApiRoutes.post('/storeos/coupons/validate', requireApiKey('rewards:validate'), requireErpPlan, (req, res) => {
  const parsed = validateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe código, cliente, checkout e subtotal.' });
  const p = parsed.data, tenantId = req.apiKey!.tenantId;
  releaseExpiredReservations(tenantId);
  const customer = findLink(tenantId, p.externalCustomerId);
  if (!customer || customer.deleted_at || !customer.enrolled_at) return res.status(404).json({ error: 'Cliente não localizado.' });
  const row = db.prepare(`SELECT rr.id,rr.status,rr.external_checkout_id,rr.reservation_expires_at,rr.expires_at,rr.points_spent,r.name,r.discount_type,r.discount_value,r.minimum_order_cents
    FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
    WHERE rr.tenant_id=? AND rr.customer_id=? AND upper(rr.redemption_code)=upper(?) AND rr.external_source='storeos'`)
    .get(tenantId, customer.id, p.code.replace(/\s/g, '')) as any;
  if (!row) return res.status(404).json({ error: 'Cupom não encontrado para esta cliente.' });
  if (row.status !== 'ready_for_use') return res.status(409).json({ error: row.status === 'used' ? 'Cupom já utilizado.' : 'Cupom não está disponível.', code: 'COUPON_NOT_AVAILABLE' });
  if (row.external_checkout_id !== p.checkoutId) return res.status(409).json({ error: 'Cupom reservado para outro checkout.', code: 'CHECKOUT_MISMATCH' });
  if (row.reservation_expires_at && new Date(row.reservation_expires_at).getTime() <= Date.now()) return res.status(409).json({ error: 'A reserva expirou; os pontos serão liberados na próxima conciliação.', code: 'RESERVATION_EXPIRED' });
  if (row.expires_at && businessDate() > String(row.expires_at).slice(0, 10)) return res.status(409).json({ error: 'Cupom expirado.', code: 'COUPON_EXPIRED' });
  if (p.subtotalCents < Number(row.minimum_order_cents || 0)) return res.status(409).json({ error: 'Subtotal mínimo não atingido.', code: 'MINIMUM_ORDER_NOT_MET' });
  if (!['percent', 'fixed'].includes(row.discount_type) || !Number.isInteger(row.discount_value) || row.discount_value <= 0 || row.discount_type === 'percent' && row.discount_value > 100) return res.status(422).json({ error: 'Regra de desconto inválida.', code: 'INVALID_REWARD_RULE' });
  return res.json({ data: { redemptionId: row.id, code: p.code.toUpperCase(), checkoutId: p.checkoutId, status: 'valid', discount: { type: row.discount_type, value: row.discount_value, minimumOrderCents: row.minimum_order_cents || 0 } } });
});
const confirmBody = z.object({ blingOrderId: externalIdSchema, blingOrderNumber: z.string().trim().min(1).max(80), checkoutId: externalIdSchema });
storeOsApiRoutes.post('/storeos/redemptions/:id/confirm', requireApiKey('rewards:validate'), requireErpPlan, (req, res) => {
  const parsed = confirmBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe o ID e número oficial do pedido Bling e o checkout.' });
  const p = parsed.data, tenantId = req.apiKey!.tenantId, id = String(req.params.id);
  if (!z.string().uuid().safeParse(id).success) return res.status(400).json({ error: 'Identificador de resgate inválido.' });
  return idempotent(req, res, 'redemption.confirm', () => {
    const result = db.transaction(() => {
      const row = db.prepare("SELECT id,status,customer_id,external_checkout_id,order_number FROM reward_redemptions WHERE id=? AND tenant_id=? AND external_source='storeos'").get(id, tenantId) as any;
      if (!row) throw new Error('NOT_FOUND');
      if (row.status === 'used' && row.order_number === p.blingOrderNumber) return { status: 200, body: { data: { id, status: 'used', blingOrderNumber: row.order_number, idempotent: true } } };
      if (row.status !== 'ready_for_use') throw new Error('STATUS');
      if (row.external_checkout_id !== p.checkoutId) throw new Error('CHECKOUT');
      const sale = db.prepare("SELECT id,customer_id,order_number,reversed_at FROM sales WHERE tenant_id=? AND source='bling' AND (external_id=? OR order_number=?) LIMIT 1")
        .get(tenantId, `bling:${p.blingOrderId}`, p.blingOrderNumber) as any;
      if (!sale || sale.reversed_at || sale.customer_id !== row.customer_id || String(sale.order_number) !== p.blingOrderNumber) throw new Error('BLING_ORDER');
      const update = db.prepare("UPDATE reward_redemptions SET status='used',used_at=CURRENT_TIMESTAMP,order_number=?,reservation_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status='ready_for_use'").run(p.blingOrderNumber, id, tenantId);
      if (!update.changes) throw new Error('RACE');
      const link = db.prepare('SELECT external_customer_id FROM storeos_customer_links WHERE tenant_id=? AND customer_id=? LIMIT 1').get(tenantId, row.customer_id) as any;
      if (link) addEvent(tenantId, link.external_customer_id, 'redemption.used', id, { blingOrderId: p.blingOrderId, blingOrderNumber: p.blingOrderNumber });
      return { status: 200, body: { data: { id, status: 'used', blingOrderNumber: p.blingOrderNumber, idempotent: false } } };
    })();
    if (result.body.data) audit(tenantId, req.apiKey!.createdBy, 'storeos.redemption_confirm', 'reward_redemption', id, { apiKeyId: req.apiKey!.id, blingOrderNumber: p.blingOrderNumber });
    return result;
  });
});
const cancelBody = z.object({ checkoutId: externalIdSchema.optional(), blingOrderId: externalIdSchema.optional(), reason: z.enum(['checkout_failed', 'customer_cancelled', 'order_cancelled', 'expired']) });
storeOsApiRoutes.post('/storeos/redemptions/:id/cancel', requireApiKey('rewards:cancel'), requireErpPlan, (req, res) => {
  const parsed = cancelBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe o motivo e a referência de checkout ou cancelamento do pedido.' });
  const p = parsed.data, tenantId = req.apiKey!.tenantId, id = String(req.params.id);
  if (!z.string().uuid().safeParse(id).success) return res.status(400).json({ error: 'Identificador de resgate inválido.' });
  return idempotent(req, res, 'redemption.cancel', () => {
    const result = db.transaction(() => {
      const row = db.prepare("SELECT rr.id,rr.status,rr.customer_id,rr.reward_id,rr.points_spent,rr.external_checkout_id,rr.order_number,r.name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=? AND rr.tenant_id=? AND rr.external_source='storeos'").get(id, tenantId) as any;
      if (!row) throw new Error('NOT_FOUND');
      if (row.status === 'cancelled' || row.status === 'expired') return { status: 200, body: { data: { id, status: row.status, pointsRestored: 0, idempotent: true } } };
      if (row.status === 'used') {
        if (p.reason !== 'order_cancelled' || !p.blingOrderId) throw new Error('BLING_REVERSAL_REQUIRED');
        const sale = db.prepare("SELECT id,customer_id,reversed_at FROM sales WHERE tenant_id=? AND source='bling' AND external_id=? LIMIT 1").get(tenantId, `bling:${p.blingOrderId}`) as any;
        if (!sale || !sale.reversed_at || sale.customer_id !== row.customer_id) throw new Error('BLING_REVERSAL_REQUIRED');
      } else if (row.status !== 'ready_for_use' || !p.checkoutId || p.checkoutId !== row.external_checkout_id) throw new Error('CHECKOUT');
      const update = db.prepare("UPDATE reward_redemptions SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status=?").run(id, tenantId, row.status);
      if (!update.changes) throw new Error('RACE');
      db.prepare('UPDATE customers SET points_balance=points_balance+? WHERE id=? AND tenant_id=?').run(row.points_spent, row.customer_id, tenantId);
      db.prepare("INSERT INTO loyalty_ledger(id,tenant_id,customer_id,points,reason,entry_type) VALUES(?,?,?,?,?,'reinstatement')").run(randomUUID(), tenantId, row.customer_id, row.points_spent, `Estorno de resgate StoreOS: ${row.name}`);
      db.prepare('UPDATE rewards SET stock=stock+1 WHERE id=? AND tenant_id=? AND stock IS NOT NULL').run(row.reward_id, tenantId);
      const link = db.prepare('SELECT external_customer_id FROM storeos_customer_links WHERE tenant_id=? AND customer_id=? LIMIT 1').get(tenantId, row.customer_id) as any;
      if (link) addEvent(tenantId, link.external_customer_id, 'redemption.cancelled', id, { pointsRestored: row.points_spent, reason: p.reason });
      return { status: 200, body: { data: { id, status: 'cancelled', pointsRestored: row.points_spent, idempotent: false } } };
    })();
    audit(tenantId, req.apiKey!.createdBy, 'storeos.redemption_cancel', 'reward_redemption', id, { apiKeyId: req.apiKey!.id, reason: p.reason });
    return result;
  });
});
storeOsApiRoutes.get('/storeos/events', requireApiKey('events:read'), requireErpPlan, (req, res) => {
  const cursor = Math.max(0, Number.parseInt(String(req.query.after || '0'), 10) || 0);
  const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || '100'), 10) || 100));
  const items = db.prepare('SELECT id,event_type eventType,external_customer_id externalCustomerId,entity_id entityId,payload,created_at createdAt FROM storeos_events WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?').all(req.apiKey!.tenantId, cursor, limit) as any[];
  const data = items.map(item => ({ ...item, payload: JSON.parse(item.payload) }));
  return res.json({ data, nextCursor: data.length ? data[data.length - 1].id : cursor, hasMore: data.length === limit });
});
