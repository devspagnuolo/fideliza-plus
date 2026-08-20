import { randomUUID } from 'node:crypto';
import { db } from './database/db.js';

export function calculateSalePoints(tenantId: string, totalCents: number, occurredAt: string) {
  const tenant = db.prepare('SELECT points_per_real FROM tenants WHERE id=?').get(tenantId) as { points_per_real: number };
  const promotion = db.prepare(`SELECT multiplier,name FROM loyalty_promotions
    WHERE tenant_id=? AND active=1 AND starts_at<=? AND ends_at>=? ORDER BY multiplier DESC LIMIT 1`).get(tenantId, occurredAt, occurredAt) as { multiplier: number; name: string } | undefined;
  const multiplier = promotion?.multiplier ?? 1;
  return { points: Math.floor(totalCents / 100 * tenant.points_per_real * multiplier), multiplier, promotionName: promotion?.name };
}

export function creditSalePoints(tenantId: string, customerId: string, saleId: string, points: number, reason: string) {
  if (points <= 0) return;
  const tenant = db.prepare('SELECT points_validity_days FROM tenants WHERE id=?').get(tenantId) as { points_validity_days: number };
  const expiresAt = new Date(Date.now() + tenant.points_validity_days * 86_400_000).toISOString();
  db.prepare(`INSERT INTO loyalty_ledger (id,tenant_id,customer_id,sale_id,points,reason,entry_type,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), tenantId, customerId, saleId, points, reason, 'earn', expiresAt);
  db.prepare('UPDATE customers SET points_balance=points_balance+? WHERE id=? AND tenant_id=?').run(points, customerId, tenantId);
}

export function reconcileSalePoints(tenantId: string, customerId: string, saleId: string, desiredPoints: number, reason: string) {
  const desired = Math.max(0, Math.floor(desiredPoints));
  const current = db.prepare(`SELECT COALESCE(SUM(points),0) points,
    SUM(CASE WHEN entry_type<>'expiration' THEN 1 ELSE 0 END) entries,
    COALESCE(-SUM(CASE WHEN entry_type='expiration' THEN points ELSE 0 END),0) expired_points
    FROM loyalty_ledger WHERE tenant_id=? AND customer_id=? AND sale_id=?`).get(tenantId, customerId, saleId) as { points: number; entries: number; expired_points: number };
  const effectiveDesired = Math.max(0, desired - current.expired_points);
  const delta = effectiveDesired - current.points;
  if (!delta) return { delta: 0, previousPoints: current.points, desiredPoints: desired, effectiveDesiredPoints: effectiveDesired, entryType: null as string | null };

  const entryType = delta < 0 ? 'reversal' : current.entries ? 'reinstatement' : 'earn';
  let expiresAt: string | null = null;
  if (delta > 0) {
    const tenant = db.prepare('SELECT points_validity_days FROM tenants WHERE id=?').get(tenantId) as { points_validity_days: number };
    expiresAt = new Date(Date.now() + tenant.points_validity_days * 86_400_000).toISOString();
  }
  db.prepare(`INSERT INTO loyalty_ledger (id,tenant_id,customer_id,sale_id,points,reason,entry_type,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), tenantId, customerId, saleId, delta, reason, entryType, expiresAt);
  db.prepare('UPDATE customers SET points_balance=points_balance+? WHERE id=? AND tenant_id=?').run(delta, customerId, tenantId);
  return { delta, previousPoints: current.points, desiredPoints: desired, effectiveDesiredPoints: effectiveDesired, entryType };
}

export function expirePoints(tenantId: string, now = new Date().toISOString()) {
  const customers = db.prepare(`SELECT DISTINCT customer_id FROM loyalty_ledger
    WHERE tenant_id=? AND points>0 AND expires_at IS NOT NULL AND expired_at IS NULL AND expires_at<=?`).all(tenantId, now) as { customer_id: string }[];
  let totalExpired = 0;
  let affectedCustomers = 0;

  db.transaction(() => {
    for (const { customer_id: customerId } of customers) {
      const entries = db.prepare(`SELECT id,sale_id,points,expires_at,expired_at FROM loyalty_ledger
        WHERE tenant_id=? AND customer_id=? ORDER BY created_at,id`).all(tenantId, customerId) as { id: string; sale_id: string | null; points: number; expires_at: string | null; expired_at: string | null }[];
      let consumed = Math.abs(entries.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
      let expiredForCustomer = 0;
      for (const entry of entries.filter((item) => item.points > 0)) {
        const available = Math.max(0, entry.points - consumed);
        consumed = Math.max(0, consumed - entry.points);
        if (!available || !entry.expires_at || entry.expires_at > now || entry.expired_at) continue;
        db.prepare('UPDATE loyalty_ledger SET expired_at=? WHERE id=? AND tenant_id=?').run(now, entry.id, tenantId);
        db.prepare(`INSERT INTO loyalty_ledger (id,tenant_id,customer_id,sale_id,points,reason,entry_type)
          VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), tenantId, customerId, entry.sale_id, -available, 'Expiração de pontos', 'expiration');
        expiredForCustomer += available;
      }
      if (expiredForCustomer) {
        db.prepare('UPDATE customers SET points_balance=MAX(0,points_balance-?) WHERE id=? AND tenant_id=?').run(expiredForCustomer, customerId, tenantId);
        totalExpired += expiredForCustomer;
        affectedCustomers++;
      }
    }
  })();
  return { totalExpired, affectedCustomers };
}
