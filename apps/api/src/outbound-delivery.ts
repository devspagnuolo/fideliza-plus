import { db } from './database/db.js';

type OutboundMessage = {
  id: string;
  tenant_id: string | null;
  recipient: string;
  channel: string;
  subject: string | null;
  message: string;
  attempts: number;
};

export async function processOutboundMessages(limit = 25) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return { processed: 0, sent: 0, failed: 0, skipped: true };
  }
  const messages = db.prepare(`SELECT id,tenant_id,recipient,channel,subject,message,attempts
    FROM outbound_messages
    WHERE status='queued' AND channel='email' AND attempts<5
      AND COALESCE(scheduled_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP
    ORDER BY created_at LIMIT ?`).all(limit) as OutboundMessage[];
  let sent = 0, failed = 0;
  for (const item of messages) {
    const locked = db.prepare("UPDATE outbound_messages SET status='processing',attempts=attempts+1,error=NULL WHERE id=? AND status='queued'").run(item.id);
    if (!locked.changes) continue;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'content-type': 'application/json',
          'user-agent': 'fideliza-plus/0.1',
          'idempotency-key': item.id,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [item.recipient],
          subject: item.subject || 'Fideliza Plus',
          text: item.message,
        }),
      });
      const body = await response.json() as { id?: string; message?: string };
      if (!response.ok) throw new Error(body.message || `Resend HTTP ${response.status}`);
      db.prepare("UPDATE outbound_messages SET status='sent',external_id=?,sent_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?").run(body.id || null, item.id);
      sent++;
    } catch (error) {
      const attempts = item.attempts + 1;
      db.prepare("UPDATE outbound_messages SET status=?,error=?,scheduled_at=datetime('now','+5 minutes') WHERE id=?").run(
        attempts >= 5 ? 'failed' : 'queued', (error as Error).message.slice(0, 500), item.id,
      );
      failed++;
    }
  }
  return { processed: messages.length, sent, failed, skipped: false };
}
