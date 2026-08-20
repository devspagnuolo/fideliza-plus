import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth, requireRole } from '../auth.js';
import { db } from '../database/db.js';

export const rewardRoutes = Router();
rewardRoutes.use(requireAuth);

rewardRoutes.get('/rewards', (req, res) => res.json(db.prepare(`
  SELECT id,name,description,points_cost,stock,active,created_at,
    (SELECT COUNT(*) FROM reward_redemptions rr WHERE rr.reward_id=rewards.id AND rr.tenant_id=rewards.tenant_id) redemptions
  FROM rewards WHERE tenant_id=? ORDER BY active DESC,points_cost,name
`).all(req.auth!.tenantId)));

const rewardFields = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  pointsCost: z.number().int().positive(),
  stock: z.number().int().nonnegative().nullable().optional(),
});

rewardRoutes.post('/rewards', requireRole('owner', 'manager'), (req, res) => {
  const parsed = rewardFields.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Recompensa inválida' });
  const id = randomUUID();
  db.prepare('INSERT INTO rewards (id,tenant_id,name,description,points_cost,stock) VALUES (?,?,?,?,?,?)')
    .run(id, req.auth!.tenantId, parsed.data.name, parsed.data.description || null, parsed.data.pointsCost, parsed.data.stock ?? null);
  audit(req.auth!.tenantId, req.auth!.userId, 'create', 'reward', id, { pointsCost: parsed.data.pointsCost });
  res.status(201).json({ id });
});

const rewardUpdate = rewardFields.partial().extend({ active: z.boolean().optional() }).refine(
  value => Object.keys(value).length > 0,
  'Informe ao menos uma alteração',
);

rewardRoutes.patch('/rewards/:id', requireRole('owner', 'manager'), (req, res) => {
  const parsed = rewardUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Alteração inválida' });
  const id = String(req.params.id);
  const current = db.prepare('SELECT id FROM rewards WHERE id=? AND tenant_id=?').get(id, req.auth!.tenantId);
  if (!current) return res.status(404).json({ error: 'Recompensa não encontrada' });
  const changes = parsed.data;
  db.prepare(`UPDATE rewards SET
    name=COALESCE(?,name),
    description=CASE WHEN ? THEN ? ELSE description END,
    points_cost=COALESCE(?,points_cost),
    stock=CASE WHEN ? THEN ? ELSE stock END,
    active=COALESCE(?,active)
    WHERE id=? AND tenant_id=?`).run(
      changes.name ?? null,
      changes.description !== undefined ? 1 : 0,
      changes.description || null,
      changes.pointsCost ?? null,
      changes.stock !== undefined ? 1 : 0,
      changes.stock ?? null,
      changes.active === undefined ? null : changes.active ? 1 : 0,
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
      const reward = db.prepare('SELECT id,name,points_cost,stock,active FROM rewards WHERE id=? AND tenant_id=?').get(String(req.params.id), req.auth!.tenantId) as { id: string; name: string; points_cost: number; stock: number | null; active: number } | undefined;
      const customer = db.prepare('SELECT id,points_balance FROM customers WHERE id=? AND tenant_id=?').get(parsed.data.customerId, req.auth!.tenantId) as { id: string; points_balance: number } | undefined;
      if (!reward || !reward.active) throw new Error('REWARD');
      if (!customer) throw new Error('CUSTOMER');
      if (customer.points_balance < reward.points_cost) throw new Error('BALANCE');
      if (reward.stock !== null && reward.stock <= 0) throw new Error('STOCK');
      const id = randomUUID();
      db.prepare('UPDATE customers SET points_balance=points_balance-? WHERE id=? AND tenant_id=?').run(reward.points_cost, customer.id, req.auth!.tenantId);
      if (reward.stock !== null) db.prepare('UPDATE rewards SET stock=stock-1 WHERE id=? AND tenant_id=? AND stock>0').run(reward.id, req.auth!.tenantId);
      db.prepare("INSERT INTO loyalty_ledger (id,tenant_id,customer_id,points,reason,entry_type) VALUES (?,?,?,?,?,'redemption')").run(randomUUID(), req.auth!.tenantId, customer.id, -reward.points_cost, `Resgate · ${reward.name}`);
      db.prepare('INSERT INTO reward_redemptions (id,tenant_id,reward_id,customer_id,points_spent,redeemed_by) VALUES (?,?,?,?,?,?)').run(id, req.auth!.tenantId, reward.id, customer.id, reward.points_cost, req.auth!.userId);
      return { id, reward: reward.name, pointsSpent: reward.points_cost, balance: customer.points_balance - reward.points_cost };
    })();
    audit(req.auth!.tenantId, req.auth!.userId, 'redeem', 'reward', result.id, { customerId: parsed.data.customerId, points: result.pointsSpent });
    res.status(201).json(result);
  } catch (error) {
    const code = (error as Error).message;
    const map: Record<string, [number, string]> = { REWARD: [404, 'Recompensa não encontrada'], CUSTOMER: [404, 'Cliente não encontrado'], BALANCE: [409, 'Saldo de pontos insuficiente'], STOCK: [409, 'Recompensa sem estoque'] };
    const response = map[code];
    if (response) return res.status(response[0]).json({ error: response[1] });
    throw error;
  }
});

rewardRoutes.get('/reward-redemptions', (req, res) => res.json(db.prepare('SELECT rr.id,rr.points_spent,rr.status,rr.created_at,r.name reward_name,c.name customer_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN customers c ON c.id=rr.customer_id WHERE rr.tenant_id=? ORDER BY rr.created_at DESC LIMIT 100').all(req.auth!.tenantId)));
