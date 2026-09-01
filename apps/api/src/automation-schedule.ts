import{randomUUID}from'node:crypto';
import{db}from'./database/db.js';
import{syncBling}from'./bling-sync.js';

let running=false;
function billingCycle(){
 if(process.env.ASAAS_BILLING_ENABLED!=='true')return;
 const subscriptions=db.prepare(`SELECT s.*,t.email,
  COALESCE((SELECT SUM(a.monthly_price_cents*a.quantity) FROM plan_addon_assignments a WHERE a.tenant_id=s.tenant_id AND a.status='active'),0) addonTotalCents,
  s.monthly_price_cents+COALESCE((SELECT SUM(a.monthly_price_cents*a.quantity) FROM plan_addon_assignments a WHERE a.tenant_id=s.tenant_id AND a.status='active'),0) billingTotalCents
  FROM subscriptions s JOIN tenants t ON t.id=s.tenant_id WHERE s.status='active'
  AND (s.monthly_price_cents+COALESCE((SELECT SUM(a.monthly_price_cents*a.quantity) FROM plan_addon_assignments a WHERE a.tenant_id=s.tenant_id AND a.status='active'),0))>0
  AND date(s.current_period_end)<=date('now','+10 days')`).all()as any[];
 db.transaction(()=>subscriptions.forEach(s=>{
  let invoice=db.prepare("SELECT id FROM invoices WHERE subscription_id=? AND due_at=? AND status IN ('pending','paid','overdue')").get(s.id,s.current_period_end)as any;
  if(!invoice){
   invoice={id:randomUUID()};
   const description=Number(s.addonTotalCents)>0?'Assinatura Fidelizei + add-ons':'Assinatura Fidelizei';
   db.prepare("INSERT INTO invoices(id,tenant_id,subscription_id,amount_cents,status,due_at,description,payment_method)VALUES(?,?,?,?,'pending',?,?,?)").run(invoice.id,s.tenant_id,s.id,s.billingTotalCents,s.current_period_end,description,s.payment_method);
   db.prepare("INSERT INTO billing_events(id,tenant_id,invoice_id,event_type,description)VALUES(?,?,?,'invoice.created','Conta a receber gerada 10 dias antes do vencimento')").run(randomUUID(),s.tenant_id,invoice.id);
  }
  const sent=db.prepare("SELECT 1 FROM outbound_messages WHERE tenant_id=? AND template='billing.reminder' AND message LIKE ?").get(s.tenant_id,`%${invoice.id}%`);
  if(!sent){
   const text=s.payment_method==='boleto'?`Fatura ${invoice.id}. O boleto e a nota fiscal serão enviados para pagamento até ${s.current_period_end}.`:`Fatura ${invoice.id}. A nota fiscal será enviada e o cartão cadastrado será debitado em ${s.current_period_end}.`;
   db.prepare("INSERT INTO outbound_messages(id,tenant_id,recipient,channel,template,subject,message,scheduled_at)VALUES(?,?,?,'email','billing.reminder','Cobrança Fidelizei',?,CURRENT_TIMESTAMP)").run(randomUUID(),s.tenant_id,s.email,text);
   db.prepare('UPDATE invoices SET notified_at=CURRENT_TIMESTAMP WHERE id=?').run(invoice.id);
  }
 }))();
}
async function cycle(){if(running)return;running=true;try{billingCycle();const tenants=db.prepare("SELECT tenant_id tenantId FROM integration_connections WHERE provider='bling' AND status='connected'").all()as{tenantId:string}[];for(const tenant of tenants)try{await syncBling(tenant.tenantId)}catch(error){try{db.prepare("UPDATE integration_connections SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='bling'").run((error as Error).message.slice(0,500),tenant.tenantId)}catch(logError){console.error('Falha ao registrar erro da automação',(logError as Error).message)}}}catch(error){console.error('Ciclo automático interrompido sem derrubar a API',(error as Error).message)}finally{running=false}}
export function startAutomationSchedule(){if(process.env.AUTOMATION_ENABLED==='false')return;void cycle();const timer=setInterval(()=>void cycle(),Math.max(60_000,Number(process.env.AUTOMATION_INTERVAL_MS??300_000)));timer.unref();return timer}
