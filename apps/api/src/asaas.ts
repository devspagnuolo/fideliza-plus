import { randomUUID } from 'node:crypto';
import { db } from './database/db.js';
import { resilientFetch } from './circuit-breaker.js';

type Json = Record<string, any>;

const environment = () => String(process.env.ASAAS_ENVIRONMENT||'').trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
const baseUrl = () => environment() === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
const billingEnabled = () => ['true','1','yes','on'].includes(String(process.env.ASAAS_BILLING_ENABLED||'').trim().toLowerCase());

function assertBillingEnabled() {
  if (!billingEnabled()) throw new Error('ASAAS_BILLING_DISABLED: habilite a cobrança somente após validar a conta e o webhook do ambiente atual');
}

export function asaasStatus() {
  return {
    configured: Boolean(process.env.ASAAS_API_KEY),
    webhookConfigured: Boolean(process.env.ASAAS_WEBHOOK_TOKEN),
    billingEnabled: billingEnabled(),
    environment: environment(),
    webhookUrl: process.env.ASAAS_WEBHOOK_URL ?? 'https://api.fidelizaplus.com.br/webhooks/asaas'
  };
}

async function request(path: string, init: RequestInit = {}) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error('ASAAS_NOT_CONFIGURED');
  const response = await resilientFetch('asaas', `${baseUrl()}${path}`, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', access_token: apiKey, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({})) as Json;
  if (!response.ok) {
    const details = Array.isArray(body.errors) ? body.errors.map((item: Json) => item.description).filter(Boolean).join('; ') : body.message;
    throw new Error(`ASAAS_HTTP_${response.status}${details ? `: ${details}` : ''}`);
  }
  return body;
}

function onlyDigits(value: unknown) { return String(value ?? '').replace(/\D/g, ''); }
function asaasPhones(value: unknown) {
  let digits = onlyDigits(value);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.length === 11 && digits[2] === '9') return { mobilePhone: digits };
  if (digits.length === 10) return { phone: digits };
  return {};
}
function dueDate(value: string) { return String(value).slice(0, 10); }
function money(cents: number) { return Number((cents / 100).toFixed(2)); }

function billingType(method: string) {
  if (method === 'pix') return 'PIX';
  if (method === 'card') return 'CREDIT_CARD';
  return 'BOLETO';
}

function localStatus(externalStatus: string) {
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(externalStatus)) return 'paid';
  if (['OVERDUE'].includes(externalStatus)) return 'overdue';
  if (['REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'].includes(externalStatus)) return 'refunded';
  if (['DELETED'].includes(externalStatus)) return 'canceled';
  return 'pending';
}

export async function ensureAsaasCustomer(tenantId: string) {
  const row = db.prepare(`SELECT t.id,t.name,t.legal_name legalName,t.cnpj,t.email,t.phone,t.responsible_name responsibleName,
    t.address,t.address_number addressNumber,t.address_complement complement,t.district,t.postal_code postalCode,
    s.id subscriptionId,s.external_customer_id externalCustomerId,s.asaas_environment asaasEnvironment
    FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id WHERE t.id=?`).get(tenantId) as Json | undefined;
  if (!row) throw new Error('Empresa ou assinatura não encontrada');
  if (row.externalCustomerId && row.asaasEnvironment === environment()) return row.externalCustomerId as string;
  if (onlyDigits(row.cnpj).length !== 14 || !row.email) throw new Error('Complete CNPJ e e-mail da empresa antes de gerar cobranças');
  const phones = asaasPhones(row.phone);
  const payload = { name: row.legalName || row.name, cpfCnpj: onlyDigits(row.cnpj), email: row.email,
    externalReference: row.id, notificationDisabled: false,
    ...(row.postalCode ? { postalCode: onlyDigits(row.postalCode) } : {}),
    ...(row.address ? { address: row.address } : {}),
    ...(row.addressNumber ? { addressNumber: row.addressNumber } : {}),
    ...(row.complement ? { complement: row.complement } : {}),
    ...(row.district ? { province: row.district } : {}) };
  let customer: Json | undefined;
  if (row.externalCustomerId && row.asaasEnvironment !== environment()) {
    const existing = await request(`/customers?externalReference=${encodeURIComponent(row.id)}&limit=1`);
    customer = existing.data?.[0];
  }
  try {
    customer ??= await request('/customers', { method: 'POST', body: JSON.stringify({ ...payload, ...phones }) });
  } catch (error) {
    const invalidPhone = Object.keys(phones).length > 0 && /ASAAS_HTTP_400.*(telefone|celular|phone)/i.test((error as Error).message);
    if (!invalidPhone) throw error;
    customer = await request('/customers', { method: 'POST', body: JSON.stringify(payload) });
  }
  if (!customer?.id) throw new Error('ASAAS_INVALID_CUSTOMER_RESPONSE');
  db.prepare('UPDATE subscriptions SET external_customer_id=?,asaas_environment=?,gateway=\'asaas\',updated_at=CURRENT_TIMESTAMP WHERE id=?').run(customer.id, environment(), row.subscriptionId);
  return customer.id as string;
}

export async function createAsaasTrialCheckout(subscriptionId: string, returnToken: string) {
  assertBillingEnabled();
  const row = db.prepare(`SELECT s.*,t.name companyName,t.email,p.name planName
    FROM subscriptions s JOIN tenants t ON t.id=s.tenant_id
    LEFT JOIN platform_plans p ON p.code=s.plan_code WHERE s.id=?`).get(subscriptionId) as Json | undefined;
  if (!row) throw new Error('Assinatura não encontrada');
  if (row.payment_method !== 'card') throw new Error('Checkout disponível apenas para cartão');
  const customer = row.external_customer_id && row.asaas_environment === environment() ? row.external_customer_id : await ensureAsaasCustomer(row.tenant_id);
  const origin = (process.env.WEB_ORIGIN || 'https://fidelizaplus.com.br').split(',')[0]!.trim().replace(/\/$/, '');
  const callback = (status: string) => `${origin}/planos?checkout=${status}&token=${encodeURIComponent(returnToken)}`;
  const checkout = await request('/checkouts', { method: 'POST', body: JSON.stringify({
    billingTypes: ['CREDIT_CARD'], chargeTypes: ['RECURRENT'], minutesToExpire: 1440,
    externalReference: row.id, customer,
    callback: { successUrl: callback('success'), cancelUrl: callback('cancel'), expiredUrl: callback('expired') },
    items: [{ name: `Plano ${row.planName || row.plan_code} - Fidelizei`, quantity: 1,
      value: money(row.monthly_price_cents), externalReference: row.id,
      description: 'Assinatura mensal com primeira cobrança após 7 dias grátis' }],
    subscription: { cycle: 'MONTHLY', nextDueDate: dueDate(row.current_period_end) }
  }) });
  const link = checkout.link || checkout.url || `${environment() === 'production' ? 'https://asaas.com' : 'https://sandbox.asaas.com'}/checkoutSession/show/${encodeURIComponent(checkout.id)}`;
  db.prepare(`UPDATE subscriptions SET external_checkout_id=?,checkout_url=?,asaas_environment=?,billing_setup_status='checkout_pending',
    billing_setup_error=NULL,gateway='asaas',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(checkout.id, link, environment(), row.id);
  return { id: checkout.id as string, link: link as string };
}

function savePayment(invoiceId: string, payment: Json) {
  const previous = db.prepare('SELECT status FROM invoices WHERE id=?').get(invoiceId) as {status:string}|undefined;
  const status = localStatus(String(payment.status ?? 'PENDING'));
  db.prepare(`UPDATE invoices SET gateway='asaas',asaas_environment=?,external_payment_id=?,external_id=?,external_status=?,status=?,
    invoice_url=?,boleto_url=COALESCE(?,boleto_url),bank_slip_url=COALESCE(?,bank_slip_url),
    payment_reference=COALESCE(?,payment_reference),paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE paid_at END,
    last_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
      environment(), payment.id, payment.id, payment.status ?? null, status, payment.invoiceUrl ?? null,
      payment.bankSlipUrl ?? null, payment.bankSlipUrl ?? null,
      payment.nossoNumero ?? payment.identificationField ?? null, status, invoiceId
    );
  return { status, previousStatus: previous?.status };
}

export async function createAsaasPayment(invoiceId: string) {
  assertBillingEnabled();
  const invoice = db.prepare(`SELECT i.*,s.external_customer_id externalCustomerId,s.asaas_environment customerEnvironment,t.name companyName
    FROM invoices i JOIN subscriptions s ON s.id=i.subscription_id JOIN tenants t ON t.id=i.tenant_id WHERE i.id=?`).get(invoiceId) as Json | undefined;
  if (!invoice) throw new Error('Fatura não encontrada');
  if (invoice.external_payment_id && invoice.asaas_environment === environment()) return syncAsaasPayment(invoiceId);
  const customer = invoice.externalCustomerId && invoice.customerEnvironment === environment() ? invoice.externalCustomerId : await ensureAsaasCustomer(invoice.tenant_id);
  const payment = await request('/payments', {
    method: 'POST', body: JSON.stringify({
      customer,
      billingType: billingType(invoice.payment_method),
      value: money(invoice.amount_cents),
      dueDate: dueDate(invoice.due_at),
      description: invoice.description || `Assinatura Fidelizei - ${invoice.companyName}`,
      externalReference: invoice.id
    })
  });
  const transition = savePayment(invoiceId, payment);
  db.prepare(`INSERT INTO billing_events(id,tenant_id,invoice_id,event_type,description,metadata)
    VALUES(?,?,?,'asaas.payment.created','Cobrança criada no Asaas',?)`).run(randomUUID(), invoice.tenant_id, invoice.id, JSON.stringify({ paymentId: payment.id, status:transition.status }));
  return { ...payment, localStatus: transition.status };
}

export async function syncAsaasPayment(invoiceId: string) {
  const invoice = db.prepare('SELECT id,tenant_id,external_payment_id externalPaymentId,asaas_environment asaasEnvironment FROM invoices WHERE id=?').get(invoiceId) as Json | undefined;
  if (!invoice) throw new Error('Fatura não encontrada');
  if (!invoice.externalPaymentId) throw new Error('A fatura ainda não possui cobrança no Asaas');
  if (invoice.asaasEnvironment !== environment()) throw new Error(`A cobrança pertence ao ambiente ${invoice.asaasEnvironment || 'não identificado'}; gere uma nova cobrança no ambiente ${environment()}`);
  const payment = await request(`/payments/${encodeURIComponent(invoice.externalPaymentId)}`);
  const transition = savePayment(invoiceId, payment);
  return { ...payment, localStatus: transition.status };
}

export async function setupAsaasWebhook() {
  const authToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!authToken || authToken.length < 32) throw new Error('ASAAS_WEBHOOK_TOKEN deve ter pelo menos 32 caracteres');
  const body = {
      name: 'Fidelizei',
      url: process.env.ASAAS_WEBHOOK_URL ?? 'https://api.fidelizaplus.com.br/webhooks/asaas',
      email: process.env.ASAAS_NOTIFICATION_EMAIL ?? 'contato@fidelizaplus.com.br',
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken,
      sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE']
  };
  const existing = await request('/webhooks');
  const current = (existing.data ?? existing).find?.((item:Json)=>item.url===body.url||item.name===body.name);
  return request(current?.id?`/webhooks/${encodeURIComponent(current.id)}`:'/webhooks', {method:current?.id?'PUT':'POST',body:JSON.stringify(body)});
}

export async function verifyAsaasConnection() {
  await request('/customers?limit=1');
  return { ok: true, environment: environment(), billingEnabled: billingEnabled() };
}

export async function runAsaasBillingCycle() {
  assertBillingEnabled();
  const subscriptions = db.prepare(`SELECT s.*,t.email,t.name,
    COALESCE((SELECT SUM(aa.monthly_price_cents*aa.quantity) FROM plan_addon_assignments aa WHERE aa.tenant_id=s.tenant_id AND aa.status='active'),0) addonTotalCents,
    s.monthly_price_cents+COALESCE((SELECT SUM(aa.monthly_price_cents*aa.quantity) FROM plan_addon_assignments aa WHERE aa.tenant_id=s.tenant_id AND aa.status='active'),0) billingTotalCents
    FROM subscriptions s JOIN tenants t ON t.id=s.tenant_id
    WHERE s.status IN ('active','trialing') AND s.current_period_end IS NOT NULL
    AND ((s.status='active' AND date(s.current_period_end)<=date('now','+10 days'))
      OR (s.status='trialing' AND date(s.current_period_end)<=date('now')))
    AND NOT (s.payment_method='card' AND s.external_checkout_id IS NOT NULL)
    AND (s.monthly_price_cents+COALESCE((SELECT SUM(aa.monthly_price_cents*aa.quantity) FROM plan_addon_assignments aa WHERE aa.tenant_id=s.tenant_id AND aa.status='active'),0))>0`).all() as Json[];
  let created = 0, gatewayCreated = 0, notifications = 0;
  const failures: Array<{ tenantId: string; error: string }> = [];
  for (const subscription of subscriptions) {
    try {
      let invoice = db.prepare(`SELECT id,external_payment_id externalPaymentId,asaas_environment asaasEnvironment FROM invoices
        WHERE subscription_id=? AND due_at=? AND status IN ('pending','paid','overdue')`).get(subscription.id, subscription.current_period_end) as Json | undefined;
      if (!invoice) {
        invoice = { id: randomUUID(), externalPaymentId: null };
        const description=Number(subscription.addonTotalCents)>0?'Assinatura Fidelizei + add-ons':'Assinatura Fidelizei';
        db.prepare(`INSERT INTO invoices(id,tenant_id,subscription_id,amount_cents,status,due_at,description,payment_method,gateway)
          VALUES(?,?,?,?,'pending',?,?,?,'asaas')`).run(invoice.id, subscription.tenant_id, subscription.id, subscription.billingTotalCents, subscription.current_period_end, description, subscription.payment_method);
        db.prepare(`INSERT INTO billing_events(id,tenant_id,invoice_id,event_type,description)
          VALUES(?,?,?,'invoice.created','Conta a receber gerada automaticamente')`).run(randomUUID(), subscription.tenant_id, invoice.id);
        created++;
      }
      if (process.env.ASAAS_API_KEY && (!invoice.externalPaymentId || invoice.asaasEnvironment !== environment())) { await createAsaasPayment(invoice.id); gatewayCreated++; }
      const current = db.prepare('SELECT invoice_url invoiceUrl,boleto_url boletoUrl FROM invoices WHERE id=?').get(invoice.id) as Json;
      const exists = db.prepare("SELECT 1 FROM outbound_messages WHERE tenant_id=? AND template='billing.reminder' AND message LIKE ?").get(subscription.tenant_id, `%${invoice.id}%`);
      if (!exists) {
        const link = current.invoiceUrl || current.boletoUrl;
        const method = subscription.payment_method === 'boleto' ? 'boleto' : subscription.payment_method === 'pix' ? 'Pix' : 'cartão';
        const message = `Fatura ${invoice.id}: cobrança por ${method}, vencimento ${dueDate(subscription.current_period_end)}.${link ? ` Acesse: ${link}` : ''}`;
        db.prepare(`INSERT INTO outbound_messages(id,tenant_id,recipient,channel,template,subject,message,scheduled_at)
          VALUES(?,?,?,'email','billing.reminder','Sua assinatura Fidelizei',?,CURRENT_TIMESTAMP)`).run(randomUUID(), subscription.tenant_id, subscription.email, message);
        db.prepare('UPDATE invoices SET notified_at=CURRENT_TIMESTAMP WHERE id=?').run(invoice.id);
        notifications++;
      }
    } catch (error) {
      failures.push({ tenantId: subscription.tenant_id, error: (error as Error).message });
    }
  }
  return { processed: subscriptions.length, created, gatewayCreated, notifications, failures };
}

export function processAsaasWebhook(payload: Json) {
  const eventType = String(payload.event ?? 'UNKNOWN');
  const payment = payload.payment as Json | undefined;
  const eventId = String(payload.id ?? `${eventType}:${payment?.id ?? 'none'}:${payment?.dateCreated ?? payload.dateCreated ?? 'unknown'}`);
  const inserted = db.prepare(`INSERT OR IGNORE INTO payment_webhook_events
    (id,provider,external_event_id,event_type,payload,status,processed_at) VALUES(?, 'asaas', ?, ?, ?, 'processing', CURRENT_TIMESTAMP)`).run(randomUUID(), eventId, eventType, JSON.stringify(payload));
  if (!inserted.changes) return { duplicate: true };
  try {
    if (!payment?.id) throw new Error('Evento sem pagamento');
    let invoice = db.prepare('SELECT id,tenant_id,subscription_id FROM invoices WHERE (asaas_environment=? AND external_payment_id=?) OR id=?').get(environment(), payment.id, payment.externalReference ?? '') as Json | undefined;
    if (!invoice) {
      const subscription = db.prepare(`SELECT id,tenant_id,monthly_price_cents,payment_method,current_period_end
        FROM subscriptions WHERE id=? OR external_subscription_id=?`).get(payment.externalReference ?? '', payment.subscription ?? '') as Json | undefined;
      if (!subscription) throw new Error('Fatura correspondente não encontrada');
      const invoiceId = randomUUID();
      db.prepare(`INSERT INTO invoices(id,tenant_id,subscription_id,amount_cents,status,due_at,description,payment_method,gateway,asaas_environment,external_payment_id,external_id)
        VALUES(?,?,?,?,'pending',?,'Assinatura Fidelizei',?,'asaas',?,?,?)`).run(invoiceId, subscription.tenant_id, subscription.id,
          Math.round(Number(payment.value ?? money(subscription.monthly_price_cents)) * 100), payment.dueDate ?? subscription.current_period_end,
          subscription.payment_method || 'card', environment(), payment.id, payment.id);
      db.prepare(`UPDATE subscriptions SET external_subscription_id=COALESCE(?,external_subscription_id),billing_setup_status='ready',
        billing_setup_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(payment.subscription ?? null, subscription.id);
      invoice = { id: invoiceId, tenant_id: subscription.tenant_id, subscription_id: subscription.id };
    }
    const transition = savePayment(invoice.id, payment),status=transition.status;
    db.prepare(`INSERT INTO billing_events(id,tenant_id,invoice_id,event_type,description,metadata)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(), invoice.tenant_id, invoice.id, `asaas.${eventType.toLowerCase()}`, `Evento ${eventType} recebido do Asaas`, JSON.stringify({ paymentId: payment.id, externalStatus: payment.status }));
    if (status === 'paid'&&transition.previousStatus!=='paid') db.prepare(`UPDATE subscriptions SET status='active',current_period_start=COALESCE(current_period_end,CURRENT_TIMESTAMP),
      current_period_end=date(COALESCE(current_period_end,CURRENT_TIMESTAMP),'+1 month'),updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(invoice.subscription_id);
    if (status === 'overdue') db.prepare("UPDATE subscriptions SET status='past_due',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(invoice.subscription_id);
    if (status === 'refunded') db.prepare("UPDATE subscriptions SET status='past_due',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(invoice.subscription_id);
    db.prepare("UPDATE payment_webhook_events SET status='processed',processed_at=CURRENT_TIMESTAMP WHERE provider='asaas' AND external_event_id=?").run(eventId);
    return { duplicate: false, invoiceId: invoice.id, status };
  } catch (error) {
    db.prepare("UPDATE payment_webhook_events SET status='failed',error=?,processed_at=CURRENT_TIMESTAMP WHERE provider='asaas' AND external_event_id=?").run((error as Error).message, eventId);
    throw error;
  }
}

let lastAutomaticRun = '';
export async function runScheduledAsaasBillingCycle() {
  if (!billingEnabled()) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (lastAutomaticRun === today) return null;
  lastAutomaticRun = today;
  return runAsaasBillingCycle();
}
