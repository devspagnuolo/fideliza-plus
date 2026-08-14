import { db } from './database/db.js';

type Delivery={id:string;channel:string;recipient:string;provider:string;campaign_id:string;subject:string|null;message:string|null;template_name:string|null};

async function sendEmail(delivery:Delivery) {
  if(!process.env.RESEND_API_KEY)return {status:'simulated',externalId:null};
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json','user-agent':'fideliza-plus/0.1','idempotency-key':delivery.id},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[delivery.recipient],subject:delivery.subject||'Novidades Fideliza+',text:delivery.message||''})});
  const body=await response.json() as {id?:string;message?:string};
  if(!response.ok)throw new Error(body.message||`Resend HTTP ${response.status}`);
  return {status:'sent',externalId:body.id??null};
}

async function sendWhatsApp(delivery:Delivery) {
  if(!process.env.WHATSAPP_ACCESS_TOKEN||!process.env.WHATSAPP_PHONE_NUMBER_ID)return {status:'simulated',externalId:null};
  if(!delivery.template_name)throw new Error('Template do WhatsApp não configurado');
  const version=process.env.META_GRAPH_VERSION||'v25.0';
  const response=await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:delivery.recipient.replace(/\D/g,''),type:'template',template:{name:delivery.template_name,language:{code:'pt_BR'}}})});
  const body=await response.json() as {messages?:{id:string}[];error?:{message:string}};
  if(!response.ok)throw new Error(body.error?.message||`Meta HTTP ${response.status}`);
  return {status:'sent',externalId:body.messages?.[0]?.id??null};
}

export async function processCampaignBatch(tenantId:string,limit=25) {
  const deliveries=db.prepare(`SELECT d.id,d.channel,d.recipient,d.provider,d.campaign_id,c.subject,c.message,c.template_name FROM campaign_deliveries d JOIN campaigns c ON c.id=d.campaign_id AND c.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.status='queued' ORDER BY d.created_at LIMIT ?`).all(tenantId,limit) as Delivery[];
  let sent=0,simulated=0,failed=0;
  for(const delivery of deliveries){
    db.prepare("UPDATE campaign_deliveries SET status='processing',attempts=attempts+1 WHERE id=? AND tenant_id=? AND status='queued'").run(delivery.id,tenantId);
    try{const result=delivery.channel==='email'?await sendEmail(delivery):await sendWhatsApp(delivery);db.prepare('UPDATE campaign_deliveries SET status=?,external_id=?,sent_at=CURRENT_TIMESTAMP,error=NULL WHERE id=? AND tenant_id=?').run(result.status,result.externalId,delivery.id,tenantId);result.status==='sent'?sent++:simulated++;}
    catch(error){db.prepare("UPDATE campaign_deliveries SET status='failed',error=? WHERE id=? AND tenant_id=?").run((error as Error).message.slice(0,500),delivery.id,tenantId);failed++;}
  }
  return {processed:deliveries.length,sent,simulated,failed};
}
