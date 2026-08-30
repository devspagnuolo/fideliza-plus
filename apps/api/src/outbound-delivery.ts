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
  const channels: string[] = [];
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) channels.push('email');
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) channels.push('whatsapp');
  if (!channels.length) {
    return { processed: 0, sent: 0, failed: 0, skipped: true };
  }
  const placeholders = channels.map(() => '?').join(',');
  const messages = db.prepare(`SELECT id,tenant_id,recipient,channel,subject,message,attempts
    FROM outbound_messages
    WHERE status='queued' AND channel IN (${placeholders}) AND attempts<5
      AND COALESCE(scheduled_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP
    ORDER BY created_at LIMIT ?`).all(...channels, limit) as OutboundMessage[];
  let sent = 0, failed = 0;
  for (const item of messages) {
    const locked = db.prepare("UPDATE outbound_messages SET status='processing',attempts=attempts+1,error=NULL WHERE id=? AND status='queued'").run(item.id);
    if (!locked.changes) continue;
    try {
      const response = item.channel === 'whatsapp' ? await sendWhatsApp(item) : await sendEmail(item);
      const body = await response.json() as { id?: string; message_id?: string; messages?: Array<{ id: string }>; message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || body.message || `${item.channel} HTTP ${response.status}`);
      const externalId = body.id || body.message_id || body.messages?.[0]?.id || null;
      db.prepare("UPDATE outbound_messages SET status='sent',external_id=?,sent_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?").run(externalId, item.id);
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

function sendEmail(item: OutboundMessage) {
  return fetch('https://api.resend.com/emails', {
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
      subject: item.subject || 'Fidelizei',
      text: item.message,
    }),
  });
}

function sendWhatsApp(item: OutboundMessage) {
  const version = process.env.META_GRAPH_VERSION || 'v25.0';
  const phone = item.recipient.replace(/\D/g, '');
  const to = phone.startsWith('55') ? phone : `55${phone}`;
  const components: Array<Record<string, unknown>> = [{
    type: 'body', parameters: [{ type: 'text', text: item.message }],
  }];
  const buttonSubtype = process.env.WHATSAPP_OTP_BUTTON_SUBTYPE;
  if (buttonSubtype) components.push({
    type: 'button', sub_type: buttonSubtype, index: '0', parameters: [{ type: 'text', text: item.message }],
  });
  return fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'fideliza-plus/0.1',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: process.env.WHATSAPP_PASSWORD_RESET_TEMPLATE || 'fideliza_password_reset',
        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR' },
        components,
      },
    }),
  });
}
