import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth, requireRole } from '../auth.js';
import { db } from '../database/db.js';

export const loyaltyRoutes = Router();
loyaltyRoutes.use(requireAuth);

loyaltyRoutes.post('/customers/:id/loyalty/adjust', requireRole('owner', 'manager'), (req, res) => {
  const customerId = String(req.params.id);
  const tenantId = req.auth!.tenantId;
  const parsed = z.object({ points: z.number().int().refine((value) => value !== 0), reason: z.string().min(3).max(120) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Ajuste inválido' });
  try {
    db.transaction(() => {
      const customer = db.prepare('SELECT points_balance FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId) as { points_balance: number } | undefined;
      if (!customer) throw new Error('NOT_FOUND');
      if (customer.points_balance + parsed.data.points < 0) throw new Error('INSUFFICIENT');
      db.prepare('UPDATE customers SET points_balance=points_balance+? WHERE id=? AND tenant_id=?').run(parsed.data.points, customerId, tenantId);
      db.prepare("INSERT INTO loyalty_ledger (id,tenant_id,customer_id,points,reason,entry_type) VALUES (?,?,?,?,?,'adjustment')").run(randomUUID(), tenantId, customerId, parsed.data.points, parsed.data.reason);
      audit(tenantId, req.auth!.userId, 'adjust_points', 'customer', customerId, parsed.data);
    })();
    res.json({ ok: true });
  } catch (error) {
    if ((error as Error).message === 'NOT_FOUND') return res.status(404).json({ error: 'Cliente não encontrado' });
    if ((error as Error).message === 'INSUFFICIENT') return res.status(409).json({ error: 'O ajuste deixaria o saldo negativo' });
    throw error;
  }
});
