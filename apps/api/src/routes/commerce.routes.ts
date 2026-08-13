import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth, requireRole } from '../auth.js';
import { parseCsv } from '../csv.js';
import { db } from '../database/db.js';
import { creditSalePoints, expirePoints } from '../loyalty.js';

export const commerceRoutes = Router();
commerceRoutes.use(requireAuth);

commerceRoutes.get('/sales', (req, res) => res.json(db.prepare(`SELECT s.*,c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.tenant_id=? ORDER BY occurred_at DESC LIMIT 100`).all(req.auth!.tenantId)));

commerceRoutes.post('/sales', (req, res) => {
  const parsed = z.object({ customerId: z.string().optional(), totalCents: z.number().int().positive(), occurredAt: z.string().datetime().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Venda inválida' });
  const tenantId = req.auth!.tenantId;
  const id = randomUUID();
  const rate = (db.prepare('SELECT points_per_real FROM tenants WHERE id=?').get(tenantId) as { points_per_real: number }).points_per_real;
  const points = Math.floor(parsed.data.totalCents / 100 * rate);
  db.transaction(() => {
    if (parsed.data.customerId && !db.prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?').get(parsed.data.customerId, tenantId)) throw new Error('Cliente não pertence à empresa');
    db.prepare('INSERT INTO sales (id,tenant_id,customer_id,total_cents,occurred_at) VALUES (?,?,?,?,?)').run(id, tenantId, parsed.data.customerId || null, parsed.data.totalCents, parsed.data.occurredAt || new Date().toISOString());
    if (parsed.data.customerId) creditSalePoints(tenantId, parsed.data.customerId, id, points, 'Pontos por compra');
  })();
  res.status(201).json({ id, points });
});

commerceRoutes.post('/imports/sales', (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = parseCsv(String(req.body));
  const errors: { row: number; message: string }[] = [];
  let imported = 0;
  const rate = (db.prepare('SELECT points_per_real FROM tenants WHERE id=?').get(tenantId) as { points_per_real: number }).points_per_real;
  db.transaction(() => rows.forEach((row, index) => {
    const parsed = z.object({ external_id: z.string().min(1), customer_email: z.string().email().optional().or(z.literal('')), total: z.coerce.number().positive(), occurred_at: z.string().datetime() }).safeParse(row);
    if (!parsed.success) { errors.push({ row: index + 2, message: 'Venda inválida' }); return; }
    const customer = parsed.data.customer_email ? db.prepare('SELECT id FROM customers WHERE tenant_id=? AND lower(email)=lower(?)').get(tenantId, parsed.data.customer_email) as { id: string } | undefined : undefined;
    const id = randomUUID();
    const result = db.prepare('INSERT OR IGNORE INTO sales (id,tenant_id,customer_id,external_id,total_cents,occurred_at,source) VALUES (?,?,?,?,?,?,?)').run(id, tenantId, customer?.id ?? null, parsed.data.external_id, Math.round(parsed.data.total * 100), parsed.data.occurred_at, 'csv');
    if (!result.changes) return;
    imported++;
    if (customer) creditSalePoints(tenantId, customer.id, id, Math.floor(parsed.data.total * rate), 'Pontos por importação');
  }))();
  res.json({ imported, errors });
});

commerceRoutes.post('/sales/:id/reverse', requireRole('owner', 'manager'), (req, res) => {
  const tenantId = req.auth!.tenantId;
  const id = String(req.params.id);
  try {
    const result = db.transaction(() => {
      const sale = db.prepare('SELECT customer_id,reversed_at FROM sales WHERE id=? AND tenant_id=?').get(id, tenantId) as { customer_id: string | null; reversed_at: string | null } | undefined;
      if (!sale) throw new Error('NOT_FOUND');
      if (sale.reversed_at) throw new Error('ALREADY_REVERSED');
      const earned = sale.customer_id ? (db.prepare("SELECT COALESCE(SUM(points),0) points FROM loyalty_ledger WHERE sale_id=? AND tenant_id=? AND entry_type='earn'").get(id, tenantId) as { points: number }).points : 0;
      if (sale.customer_id && earned) {
        const customer = db.prepare('SELECT points_balance FROM customers WHERE id=? AND tenant_id=?').get(sale.customer_id, tenantId) as { points_balance: number };
        if (customer.points_balance < earned) throw new Error('INSUFFICIENT');
        db.prepare('UPDATE customers SET points_balance=points_balance-? WHERE id=? AND tenant_id=?').run(earned, sale.customer_id, tenantId);
        db.prepare(`INSERT INTO loyalty_ledger (id,tenant_id,customer_id,sale_id,points,reason,entry_type) VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), tenantId, sale.customer_id, id, -earned, 'Estorno de venda', 'reversal');
      }
      db.prepare('UPDATE sales SET reversed_at=? WHERE id=? AND tenant_id=?').run(new Date().toISOString(), id, tenantId);
      audit(tenantId, req.auth!.userId, 'reverse_sale', 'sale', id, { points: earned });
      return { pointsReversed: earned };
    })();
    res.json(result);
  } catch (error) {
    if ((error as Error).message === 'NOT_FOUND') return res.status(404).json({ error: 'Venda não encontrada' });
    if ((error as Error).message === 'ALREADY_REVERSED') return res.status(409).json({ error: 'Venda já estornada' });
    if ((error as Error).message === 'INSUFFICIENT') return res.status(409).json({ error: 'Saldo insuficiente para estornar os pontos da venda' });
    throw error;
  }
});

commerceRoutes.post('/loyalty/expire', requireRole('owner', 'manager'), (req, res) => {
  const result = expirePoints(req.auth!.tenantId);
  audit(req.auth!.tenantId, req.auth!.userId, 'expire_points', 'loyalty', undefined, result);
  res.json(result);
});
