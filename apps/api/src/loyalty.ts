import { randomUUID } from 'node:crypto';
import { db } from './database/db.js';

const saoPauloDayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});

function storedDate(value:string){
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return `${value}T12:00:00-03:00`;
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value))return `${value.replace(' ','T')}Z`;
  return value;
}

export function saoPauloBusinessDate(value:string){
  const date=new Date(storedDate(value));
  return Number.isNaN(date.getTime())?null:saoPauloDayFormatter.format(date);
}

/**
 * A adesão vale para todo o dia comercial em São Paulo. Assim, um pedido aberto
 * no caixa antes do cadastro, mas identificado no mesmo dia, continua elegível.
 */
export function isSaleEligibleFromEnrollmentDay(saleAt:string,enrolledAt:string){
  const saleDay=saoPauloBusinessDate(saleAt),enrollmentDay=saoPauloBusinessDate(enrolledAt);
  return Boolean(saleDay&&enrollmentDay&&saleDay>=enrollmentDay);
}

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
  const sale = db.prepare('SELECT id,order_number,external_id,reversed_at FROM sales WHERE id=? AND tenant_id=?').get(saleId, tenantId) as {id:string;order_number:string|null;external_id:string|null;reversed_at:string|null}|undefined;
  const links = db.prepare('SELECT external_customer_id FROM storeos_customer_links WHERE tenant_id=? AND customer_id=?').all(tenantId, customerId) as {external_customer_id:string}[];
  if (sale && links.length) {
    const balance = Number((db.prepare('SELECT points_balance FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId) as {points_balance:number}).points_balance);
    const eventType = sale.reversed_at || entryType === 'reversal' ? 'points.reversed' : 'points.reconciled';
    const payload = JSON.stringify({ delta, balance, orderNumber: sale.order_number, source: sale.external_id?.startsWith('bling:') ? 'bling' : 'other' });
    const insert = db.prepare('INSERT INTO storeos_events(tenant_id,external_customer_id,event_type,entity_id,payload) VALUES(?,?,?,?,?)');
    for (const link of links) insert.run(tenantId, link.external_customer_id, eventType, sale.id, payload);
  }
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

export type PointBalanceDivergence = {
  tenantId: string;
  customerId: string;
  storedBalance: number;
  ledgerBalance: number;
  difference: number;
};

export type VipTier={id:string;name:string;rank:number;minLifetimePoints:number;color:string|null;benefits:string|null};
export function customerVipTier(tenantId:string,customerId:string){
  const tiers=db.prepare(`SELECT id,name,rank,min_lifetime_points minLifetimePoints,color,benefits FROM loyalty_tiers WHERE tenant_id=? ORDER BY rank`).all(tenantId)as VipTier[];
  if(!tiers.length)return null;
  const earned=db.prepare(`SELECT COALESCE(SUM(CASE WHEN entry_type IN ('earn','reinstatement','reversal','adjustment') THEN points ELSE 0 END),0) total FROM loyalty_ledger WHERE tenant_id=? AND customer_id=?`).get(tenantId,customerId)as{total:number};
  const lifetimePoints=Math.max(0,Number(earned.total||0));
  const current=[...tiers].reverse().find(tier=>tier.minLifetimePoints<=lifetimePoints)??null;
  const next=tiers.find(tier=>tier.minLifetimePoints>lifetimePoints)??null;
  const base=current?.minLifetimePoints??0,span=next?Math.max(1,next.minLifetimePoints-base):1;
  return{lifetimePoints,current,next,pointsToNext:next?Math.max(0,next.minLifetimePoints-lifetimePoints):0,progressPercent:next?Math.min(100,Math.max(0,Math.round((lifetimePoints-base)/span*100))):100};
}

/**
 * O ledger e a fonte contabil da pontuacao. points_balance permanece como cache
 * para consultas rapidas, mas nunca deve divergir silenciosamente do historico.
 */
export function pointBalanceDivergences(tenantId?: string) {
  const tenantFilter = tenantId ? 'WHERE c.tenant_id=?' : '';
  const rows = db.prepare(`SELECT c.tenant_id tenantId,c.id customerId,c.points_balance storedBalance,
    COALESCE(SUM(l.points),0) ledgerBalance
    FROM customers c LEFT JOIN loyalty_ledger l
      ON l.tenant_id=c.tenant_id AND l.customer_id=c.id
    ${tenantFilter}
    GROUP BY c.tenant_id,c.id,c.points_balance
    HAVING c.points_balance<>COALESCE(SUM(l.points),0)
    ORDER BY c.tenant_id,c.id`).all(...(tenantId ? [tenantId] : [])) as Array<Omit<PointBalanceDivergence, 'difference'>>;
  return rows.map(row => ({ ...row, difference: row.ledgerBalance - row.storedBalance }));
}

export function reconcilePointBalances(tenantId?: string) {
  const divergences = pointBalanceDivergences(tenantId);
  if (!divergences.length) return { checkedAt: new Date().toISOString(), corrected: 0, divergences: [] as PointBalanceDivergence[] };
  const update = db.prepare('UPDATE customers SET points_balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?');
  db.transaction(() => {
    for (const row of divergences) update.run(row.ledgerBalance, row.customerId, row.tenantId);
  })();
  return { checkedAt: new Date().toISOString(), corrected: divergences.length, divergences };
}

export function runScheduledPointReconciliation() {
  const today = new Date().toISOString().slice(0, 10);
  const previous = db.prepare("SELECT value FROM global_settings WHERE key='loyalty.last_reconciliation_date'").get() as { value: string } | undefined;
  if (previous?.value === today) return { skipped: true, corrected: 0 };
  const result = reconcilePointBalances();
  db.prepare(`INSERT INTO global_settings(key,value) VALUES('loyalty.last_reconciliation_date',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(today);
  db.prepare(`INSERT INTO global_settings(key,value) VALUES('loyalty.last_reconciliation_result',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify({ checkedAt: result.checkedAt, corrected: result.corrected }));
  if (result.corrected) {
    db.prepare(`INSERT INTO platform_incidents(id,title,description,severity,status,service,impact)
      VALUES(?,?,?,?, 'resolved','loyalty','Saldo em cache reconciliado automaticamente')`).run(
      randomUUID(),
      'Divergencia de saldo de pontos corrigida',
      `${result.corrected} saldo(s) foram recalculados a partir do ledger imutavel.`,
      result.corrected >= 10 ? 'high' : 'medium'
    );
  }
  return { skipped: false, ...result };
}

export function redemptionLimit(tenantId: string, customerId: string) {
  const configured = db.prepare("SELECT value FROM global_settings WHERE key='security.daily_redemption_limit'").get() as { value: string } | undefined;
  const limit = Math.min(50, Math.max(1, Number(configured?.value || 10)));
  const used = (db.prepare(`SELECT COUNT(*) count FROM reward_redemptions
    WHERE tenant_id=? AND customer_id=? AND created_at>=datetime('now','start of day')`).get(tenantId, customerId) as { count: number }).count;
  return { allowed: used < limit, used, limit };
}
