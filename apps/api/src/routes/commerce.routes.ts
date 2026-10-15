import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAuth, requireRole } from '../auth.js';
import { parseCsv } from '../csv.js';
import { db } from '../database/db.js';
import { calculateSalePoints, creditSalePoints, expirePoints, isSaleEligibleFromEnrollmentDay, reconcileSalePoints } from '../loyalty.js';

export const commerceRoutes = Router();
commerceRoutes.use(requireAuth);

commerceRoutes.get('/sales', (req, res) => {const source=String(req.query.source||'').trim();res.json(db.prepare(`SELECT s.*,c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.tenant_id=? AND (?='' OR s.source=?) ORDER BY occurred_at DESC LIMIT 250`).all(req.auth!.tenantId,source,source));});
commerceRoutes.get('/sales/sources', (req, res) => res.json(db.prepare(`SELECT source,COUNT(*) total FROM sales WHERE tenant_id=? GROUP BY source ORDER BY source`).all(req.auth!.tenantId)));

commerceRoutes.post('/sales', (req, res) => {
  const parsed = z.object({ customerId: z.string().optional(), totalCents: z.number().int().positive(), occurredAt: z.string().datetime().optional(),source:z.string().min(2).max(40).optional(),orderNumber:z.string().max(60).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Venda inválida' });
  const tenantId = req.auth!.tenantId;
  const id = randomUUID();
  const occurredAt = parsed.data.occurredAt || new Date().toISOString();
  const calculated = calculateSalePoints(tenantId, parsed.data.totalCents, occurredAt);
  let points = 0;
  db.transaction(() => {
    const customer = parsed.data.customerId
      ? db.prepare('SELECT id,enrolled_at FROM customers WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(parsed.data.customerId, tenantId) as {id:string;enrolled_at:string|null}|undefined
      : undefined;
    if (parsed.data.customerId && !customer) throw new Error('Cliente não pertence à empresa');
    db.prepare('INSERT INTO sales (id,tenant_id,customer_id,order_number,total_cents,occurred_at,source) VALUES (?,?,?,?,?,?,?)').run(id, tenantId, parsed.data.customerId || null,parsed.data.orderNumber||null, parsed.data.totalCents, occurredAt,parsed.data.source||'manual');
    if (customer?.enrolled_at && isSaleEligibleFromEnrollmentDay(occurredAt,customer.enrolled_at)) {
      points = calculated.points;
      creditSalePoints(tenantId, customer.id, id, points, calculated.promotionName ? `Pontos por compra · ${calculated.promotionName}` : 'Pontos por compra');
    }
    audit(tenantId,req.auth!.userId,'create','sale',id,{source:parsed.data.source||'manual',customerId:customer?.id??null,totalCents:parsed.data.totalCents,points});
  })();
  res.status(201).json({ id, points, multiplier:calculated.multiplier, promotionName:calculated.promotionName });
});

commerceRoutes.post('/imports/sales', (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = parseCsv(String(req.body));
  const errors: { row: number; message: string }[] = [];
  let imported = 0;
  db.transaction(() => rows.forEach((row, index) => {
    const parsed = z.object({ external_id: z.string().min(1), customer_email: z.string().email().optional().or(z.literal('')), total: z.coerce.number().positive(), occurred_at: z.string().datetime() }).safeParse(row);
    if (!parsed.success) { errors.push({ row: index + 2, message: 'Venda inválida' }); return; }
    const customer = parsed.data.customer_email ? db.prepare('SELECT id,enrolled_at FROM customers WHERE tenant_id=? AND lower(email)=lower(?) AND deleted_at IS NULL').get(tenantId, parsed.data.customer_email) as { id: string; enrolled_at:string|null } | undefined : undefined;
    const id = randomUUID();
    const result = db.prepare('INSERT OR IGNORE INTO sales (id,tenant_id,customer_id,external_id,total_cents,occurred_at,source) VALUES (?,?,?,?,?,?,?)').run(id, tenantId, customer?.id ?? null, parsed.data.external_id, Math.round(parsed.data.total * 100), parsed.data.occurred_at, 'csv');
    if (!result.changes) return;
    imported++;
    if (customer?.enrolled_at && isSaleEligibleFromEnrollmentDay(parsed.data.occurred_at,customer.enrolled_at)) { const bonus=calculateSalePoints(tenantId,Math.round(parsed.data.total*100),parsed.data.occurred_at); creditSalePoints(tenantId,customer.id,id,bonus.points,bonus.promotionName?`Pontos por importação · ${bonus.promotionName}`:'Pontos por importação'); }
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
      const adjustment=sale.customer_id?reconcileSalePoints(tenantId,sale.customer_id,id,0,'Estorno manual de venda'):{delta:0};
      const earned=Math.max(0,-adjustment.delta);
      db.prepare("UPDATE sales SET reversed_at=?,reversal_source='manual',external_status=CASE WHEN source='bling' THEN 'Estornado manualmente no Fidelizei' ELSE external_status END WHERE id=? AND tenant_id=?").run(new Date().toISOString(), id, tenantId);
      audit(tenantId, req.auth!.userId, 'reverse_sale', 'sale', id, { points: earned });
      return { pointsReversed: earned };
    })();
    res.json(result);
  } catch (error) {
    if ((error as Error).message === 'NOT_FOUND') return res.status(404).json({ error: 'Venda não encontrada' });
    if ((error as Error).message === 'ALREADY_REVERSED') return res.status(409).json({ error: 'Venda já estornada' });
    throw error;
  }
});

commerceRoutes.post('/loyalty/expire', requireRole('owner', 'manager'), (req, res) => {
  const result = expirePoints(req.auth!.tenantId);
  audit(req.auth!.tenantId, req.auth!.userId, 'expire_points', 'loyalty', undefined, result);
  res.json(result);
});
