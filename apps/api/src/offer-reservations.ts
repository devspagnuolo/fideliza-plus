import { db } from './database/db.js';

/** Libera reservas vencidas e devolve o estoque sem risco de baixa duplicada. */
export function releaseExpiredOfferReservations(tenantId: string) {
  const expired = db.prepare(`SELECT i.id,i.offer_id offerId,o.stock
    FROM offer_interests i
    JOIN store_offers o ON o.id=i.offer_id AND o.tenant_id=i.tenant_id
    WHERE i.tenant_id=? AND i.status='reserved' AND i.expires_at IS NOT NULL
      AND datetime(i.expires_at)<=datetime('now')`).all(tenantId) as Array<{id:string;offerId:string;stock:number|null}>;
  if (!expired.length) return 0;

  db.transaction(() => {
    for (const reservation of expired) {
      const released = db.prepare(`UPDATE offer_interests
        SET status='canceled',internal_notes=CASE
          WHEN internal_notes IS NULL OR internal_notes='' THEN 'Reserva expirada automaticamente.'
          ELSE internal_notes || char(10) || 'Reserva expirada automaticamente.' END,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND status='reserved'`).run(reservation.id,tenantId);
      if (released.changes && reservation.stock !== null) {
        db.prepare('UPDATE store_offers SET stock=stock+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?')
          .run(reservation.offerId,tenantId);
      }
    }
  })();
  return expired.length;
}
