import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireApiKey } from '../api-key-auth.js';
import { normalizeCpf,validCpf } from '../cpf.js';
import { db } from '../database/db.js';
import { calculateSalePoints,isSaleEligibleFromEnrollmentDay,reconcileSalePoints } from '../loyalty.js';
import { PLAN_FEATURES,tenantPlan } from '../plan-catalog.js';
import { hashPassword } from '../security.js';

export const posApiRoutes=Router();
const cpf=z.string().transform(normalizeCpf).refine(validCpf,'CPF inválido');
const digits=(value:string)=>value.replace(/\D/g,'');
const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const temporaryPassword=()=>`Fz!${randomUUID().replace(/-/g,'').slice(0,12)}Aa`;
const webOrigin=()=>((process.env.WEB_ORIGIN||'https://fidelizaplus.com.br').split(',')[0]||'https://fidelizaplus.com.br').trim();
const requireErpIntegration=(req:any,res:any,next:any)=>{const plan=tenantPlan(req.apiKey!.tenantId);return !plan||plan.features.includes(PLAN_FEATURES.ERP_INTEGRATIONS)?next():res.status(403).json({error:'A integração de PDV não está incluída no plano atual.',code:'PLAN_UPGRADE_REQUIRED',requiredFeature:PLAN_FEATURES.ERP_INTEGRATIONS})};
const requireAuthoritativeOrderSource=(req:any,res:any,next:any)=>{
  const connection=db.prepare("SELECT provider FROM integration_connections WHERE tenant_id=? AND provider='bling' AND status='connected' LIMIT 1").get(req.apiKey!.tenantId)as{provider:string}|undefined;
  if(!connection)return next();
  return res.status(409).json({
    error:'O Bling é a fonte oficial dos pedidos desta empresa. Registre ou cancele a venda no Bling; o Fidelizei fará a conciliação automática.',
    code:'BLING_ORDER_SOURCE_REQUIRED',
    provider:'bling',
    acceptedExternalIdPrefix:'bling:'
  });
};
const viewCustomer=(customer:any)=>({id:customer.id,name:customer.name,cpf:customer.cpf??null,email:customer.email??null,phone:customer.phone??null,pointsBalance:Number(customer.points_balance??0),enrolledAt:customer.enrolled_at??null,eligibleForPoints:Boolean(customer.enrolled_at&&!customer.deleted_at),createdAt:customer.created_at});

posApiRoutes.get('/customers/lookup',requireApiKey('customers:read'),requireErpIntegration,(req,res)=>{
  const document=normalizeCpf(String(req.query.cpf??''));
  if(!validCpf(document))return res.status(400).json({error:'Informe um CPF válido'});
  const customer=db.prepare('SELECT id,name,cpf,email,phone,points_balance,enrolled_at,deleted_at,created_at FROM customers WHERE tenant_id=? AND cpf=? AND deleted_at IS NULL').get(req.apiKey!.tenantId,document);
  if(!customer)return res.status(404).json({error:'Cliente não encontrado nesta empresa'});
  res.json({data:viewCustomer(customer)});
});

const customerUpsert=z.object({name:z.string().trim().min(2).max(120),cpf,email:z.string().email().optional().or(z.literal('')),phone:z.string().max(30).optional().or(z.literal('')),programConsent:z.boolean().optional()}).superRefine((value,ctx)=>{if(value.programConsent&&digits(value.phone||'').length<10)ctx.addIssue({code:'custom',path:['phone'],message:'Celular é obrigatório para adesão ao programa'});if(value.programConsent&&!value.email)ctx.addIssue({code:'custom',path:['email'],message:'E-mail é obrigatório para enviar o acesso ao aplicativo'})});
posApiRoutes.post('/customers/upsert',requireApiKey('customers:write'),requireErpIntegration,(req,res)=>{
  const parsed=customerUpsert.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Dados do cliente inválidos'});
  const tenantId=req.apiKey!.tenantId,p=parsed.data;
  try{
    const result=db.transaction(()=>{
      const existing=db.prepare('SELECT id,enrolled_at,email FROM customers WHERE tenant_id=? AND cpf=?').get(tenantId,p.cpf)as{id:string;enrolled_at:string|null;email:string|null}|undefined;
      if(!existing){const plan=tenantPlan(tenantId),count=Number((db.prepare('SELECT COUNT(*) total FROM customers WHERE tenant_id=? AND deleted_at IS NULL').get(tenantId)as any).total);if(plan&&count>=plan.consumerLimit)throw new Error('LIMIT');}
      const id=existing?.id??randomUUID(),enrolled=Boolean(p.programConsent&&!existing?.enrolled_at);
      if(existing)db.prepare(`UPDATE customers SET name=?,email=COALESCE(?,email),phone=COALESCE(?,phone),status='active',deleted_at=NULL,enrolled_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE enrolled_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`).run(p.name,p.email||null,p.phone||null,enrolled?1:0,id,tenantId);
      else db.prepare("INSERT INTO customers(id,tenant_id,name,cpf,email,phone,enrolled_at,status) VALUES(?,?,?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,'active')").run(id,tenantId,p.name,p.cpf,p.email||null,p.phone||null,p.programConsent?1:0);
      if(enrolled)db.prepare("INSERT INTO customer_consents(id,tenant_id,customer_id,purpose,granted,source) VALUES(?,?,?,?,1,'pdv')").run(randomUUID(),tenantId,id,'loyalty_program');
      const customer=db.prepare('SELECT id,name,cpf,email,phone,points_balance,enrolled_at,deleted_at,created_at FROM customers WHERE id=? AND tenant_id=?').get(id,tenantId)as any;
      let accessCreated=false;
      if(p.programConsent){
        const account=db.prepare('SELECT id FROM customer_accounts WHERE tenant_id=? AND customer_id=?').get(tenantId,id)as{id:string}|undefined;
        if(!account){
          const recipient=String(customer.email||'').trim().toLowerCase();
          if(!recipient)throw new Error('EMAIL_REQUIRED');
          const tenant=db.prepare('SELECT name,slug FROM tenants WHERE id=?').get(tenantId)as{name:string;slug:string};
          const password=temporaryPassword(),accountId=randomUUID();
          db.prepare("INSERT INTO customer_accounts(id,tenant_id,customer_id,password_hash,must_change_password,temporary_password_expires_at) VALUES(?,?,?,?,1,datetime('now','+48 hours'))").run(accountId,tenantId,id,hashPassword(password));
          db.prepare("INSERT INTO outbound_messages(id,tenant_id,recipient,channel,template,subject,message,scheduled_at) VALUES(?,?,?,'email','customer.pdv_welcome',?,?,CURRENT_TIMESTAMP)").run(randomUUID(),tenantId,recipient,`Bem-vinda ao programa ${tenant.name}`,`Olá, ${customer.name}. Você foi cadastrada no programa de fidelidade da ${tenant.name}.\n\nAcesse ${webOrigin()}/cliente/${encodeURIComponent(tenant.slug)} usando seu CPF e esta senha temporária: ${password}\n\nPor segurança, altere a senha no primeiro acesso. Esta senha temporária expira em 48 horas.\n\nSe você não reconhece este cadastro, entre em contato com a loja.`);
          accessCreated=true;
        }
      }
      return {customer:viewCustomer(customer),created:!existing,enrolled,accessCreated};
    })();
    audit(tenantId,req.apiKey!.createdBy,'pdv.customer_upsert','customer',result.customer.id,{apiKeyId:req.apiKey!.id,created:result.created,enrolled:result.enrolled,accessCreated:result.accessCreated});
    res.status(result.created?201:200).json(result);
  }catch(error){if((error as Error).message==='LIMIT')return res.status(409).json({error:'Limite de consumidores do plano atingido.',code:'PLAN_LIMIT_REACHED'});if((error as Error).message==='EMAIL_REQUIRED')return res.status(409).json({error:'E-mail é obrigatório para criar o acesso da cliente pelo PDV.'});throw error;}
});

const saleBody=z.object({externalSaleId:z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/,'Identificador externo inválido'),orderNumber:z.string().trim().min(1).max(80).optional(),customerCpf:cpf.optional(),totalCents:z.number().int().positive().max(100_000_000),occurredAt:z.string().datetime().optional()});
posApiRoutes.post('/sales',requireApiKey('sales:write'),requireErpIntegration,requireAuthoritativeOrderSource,(req,res)=>{
  const parsed=saleBody.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Venda inválida'});
  const tenantId=req.apiKey!.tenantId,p=parsed.data,externalId=`pdv:${p.externalSaleId}`,occurredAt=p.occurredAt||new Date().toISOString();
  try{
    const result=db.transaction(()=>{
      const customer=p.customerCpf?db.prepare('SELECT id,enrolled_at,deleted_at FROM customers WHERE tenant_id=? AND cpf=?').get(tenantId,p.customerCpf)as{id:string;enrolled_at:string|null;deleted_at:string|null}|undefined:undefined;
      if(p.customerCpf&&!customer)throw new Error('CUSTOMER');
      const existing=db.prepare('SELECT id,total_cents,customer_id,occurred_at,reversed_at FROM sales WHERE tenant_id=? AND external_id=?').get(tenantId,externalId)as{id:string;total_cents:number;customer_id:string|null;occurred_at:string;reversed_at:string|null}|undefined;
      if(existing){
        if(existing.total_cents!==p.totalCents)throw new Error('CONFLICT');
        if(existing.customer_id&&customer&&existing.customer_id!==customer.id)throw new Error('CUSTOMER_CONFLICT');
        const linkedCustomer=customer??(existing.customer_id?db.prepare('SELECT id,enrolled_at,deleted_at FROM customers WHERE id=? AND tenant_id=?').get(existing.customer_id,tenantId)as{id:string;enrolled_at:string|null;deleted_at:string|null}|undefined:undefined);
        const customerId=existing.customer_id??linkedCustomer?.id??null,customerLinked=Boolean(!existing.customer_id&&linkedCustomer),eligible=Boolean(customerId&&linkedCustomer?.enrolled_at&&!linkedCustomer.deleted_at&&isSaleEligibleFromEnrollmentDay(existing.occurred_at,linkedCustomer.enrolled_at)),desiredPoints=!existing.reversed_at&&eligible?calculateSalePoints(tenantId,existing.total_cents,existing.occurred_at).points:0;
        let points=0,pointsAdjusted=0;
        if(customerId){
          const adjustment=reconcileSalePoints(tenantId,customerId,existing.id,desiredPoints,'Conciliação automática de pontos do pedido PDV');
          points=adjustment.desiredPoints;
          pointsAdjusted=adjustment.delta;
        }
        if(customerLinked)db.prepare("UPDATE sales SET customer_id=?,order_number=COALESCE(?,order_number),external_status='Confirmada e identificada no PDV' WHERE id=? AND tenant_id=?").run(customerId,p.orderNumber||null,existing.id,tenantId);
        return{id:existing.id,externalId,points,pointsAdjusted,customerLinked,idempotent:true,reversed:Boolean(existing.reversed_at),eligibleForPoints:eligible};
      }
      const id=randomUUID(),eligible=Boolean(customer?.enrolled_at&&!customer.deleted_at&&isSaleEligibleFromEnrollmentDay(occurredAt,customer.enrolled_at)),points=eligible?calculateSalePoints(tenantId,p.totalCents,occurredAt).points:0;
      db.prepare("INSERT INTO sales(id,tenant_id,customer_id,external_id,order_number,total_cents,occurred_at,source,external_status) VALUES(?,?,?,?,?,?,?,'pdv','Confirmada no PDV')").run(id,tenantId,customer?.id??null,externalId,p.orderNumber||p.externalSaleId,p.totalCents,occurredAt);
      if(customer&&points>0)reconcileSalePoints(tenantId,customer.id,id,points,'Pontos por compra no PDV');
      return{id,externalId,points,pointsAdjusted:points,customerLinked:Boolean(customer),idempotent:false,reversed:false,eligibleForPoints:eligible};
    })();
    audit(tenantId,req.apiKey!.createdBy,'pdv.sale_create','sale',result.id,{apiKeyId:req.apiKey!.id,externalId,points:result.points,idempotent:result.idempotent});
    res.status(result.idempotent?200:201).json({data:result});
  }catch(error){const code=(error as Error).message;if(code==='CUSTOMER')return res.status(404).json({error:'Cliente não encontrado nesta empresa. Cadastre a cliente e reenvie o mesmo pedido para vincular e creditar os pontos elegíveis.'});if(code==='CUSTOMER_CONFLICT')return res.status(409).json({error:'Esta venda já está vinculada a outra cliente. Corrija ou estorne a venda original antes de reenviar.'});if(code==='CONFLICT')return res.status(409).json({error:'Já existe uma venda com esse identificador externo e valor diferente. Estorne a venda original antes de reenviar.'});throw error;}
});

posApiRoutes.post('/sales/:externalSaleId/reverse',requireApiKey('sales:write'),requireErpIntegration,requireAuthoritativeOrderSource,(req,res)=>{
  const externalSaleId=String(req.params.externalSaleId||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,100}$/.test(externalSaleId))return res.status(400).json({error:'Identificador externo inválido'});
  const tenantId=req.apiKey!.tenantId,externalId=`pdv:${externalSaleId}`;
  try{
    const result=db.transaction(()=>{const sale=db.prepare('SELECT id,customer_id,reversed_at FROM sales WHERE tenant_id=? AND external_id=?').get(tenantId,externalId)as{id:string;customer_id:string|null;reversed_at:string|null}|undefined;if(!sale)throw new Error('NOT_FOUND');if(sale.reversed_at)return{id:sale.id,idempotent:true,pointsReversed:0};const adjustment=sale.customer_id?reconcileSalePoints(tenantId,sale.customer_id,sale.id,0,'Estorno informado pelo PDV'):{delta:0};db.prepare("UPDATE sales SET reversed_at=CURRENT_TIMESTAMP,reversal_source='pdv',external_status='Estornada no PDV' WHERE id=? AND tenant_id=?").run(sale.id,tenantId);return{id:sale.id,idempotent:false,pointsReversed:Math.max(0,-adjustment.delta)};})();
    audit(tenantId,req.apiKey!.createdBy,'pdv.sale_reverse','sale',result.id,{apiKeyId:req.apiKey!.id,externalId,idempotent:result.idempotent});
    res.json({data:result});
  }catch(error){if((error as Error).message==='NOT_FOUND')return res.status(404).json({error:'Venda não encontrada para esta empresa'});throw error;}
});

const redemptionRequest=z.object({
  code:z.string().trim().min(8).max(24),
  orderNumber:z.string().trim().min(1).max(80),
  customerCpf:z.string().regex(/^\\d{11}$/).optional(),
  subtotalCents:z.number().int().nonnegative().optional(),
  expectedReward:z.object({
    discountType:z.enum(['percent','fixed']),
    discountValue:z.number().int().positive(),
    minimumOrderCents:z.number().int().nonnegative()
  }).optional()
});
type RedemptionRow={id:string;status:string;order_number:string|null;expires_at:string|null;reward_name:string;discount_type:string|null;discount_value:number|null;minimum_order_cents:number|null;customer_name:string;customer_cpf:string|null};
const redemptionByCode=(tenantId:string,code:string)=>db.prepare(`SELECT rr.id,rr.status,rr.order_number,rr.expires_at,r.name reward_name,r.discount_type,r.discount_value,r.minimum_order_cents,c.name customer_name,c.cpf customer_cpf FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN customers c ON c.id=rr.customer_id WHERE rr.tenant_id=? AND upper(rr.redemption_code)=?`).get(tenantId,code) as RedemptionRow|undefined;
const redemptionData=(row:RedemptionRow,orderNumber:string)=>({
  id:row.id,status:row.status,orderNumber,
  reward:{name:row.reward_name,discountType:row.discount_type,discountValue:row.discount_value,minimumOrderCents:row.minimum_order_cents??0},
  customer:{name:row.customer_name,cpf:row.customer_cpf}
});
const redemptionError=(res:any,error:unknown)=>{
  const value=(error as Error).message;
  if(value==='NOT_FOUND')return res.status(404).json({error:'Código não encontrado para esta loja'});
  if(value==='USED')return res.status(409).json({error:'Este código já foi utilizado em outro pedido'});
  if(value==='EXPIRED')return res.status(409).json({error:'Este cupom está vencido'});
  if(value==='CUSTOMER')return res.status(409).json({error:'Este cupom pertence a outra cliente'});
  if(value==='MINIMUM')return res.status(409).json({error:'O pedido não atingiu o valor mínimo do cupom'});
  if(value==='RULE')return res.status(422).json({error:'A regra deste cupom não possui desconto válido. Corrija a recompensa no Fidelizei antes de utilizar o código'});
  if(value==='CHANGED')return res.status(409).json({error:'A regra do cupom mudou desde a consulta. Atualize o desconto antes de tentar novamente'});
  return res.status(409).json({error:'Este cupom ainda não está liberado para uso'});
};
const checkRedemption=(row:RedemptionRow|undefined,input:z.infer<typeof redemptionRequest>)=>{
  if(!row)throw new Error('NOT_FOUND');
  if(input.customerCpf&&row.customer_cpf!==input.customerCpf)throw new Error('CUSTOMER');
  if(row.status==='used'&&row.order_number!==input.orderNumber)throw new Error('USED');
  if(row.status!=='ready_for_use'&&row.status!=='used')throw new Error('STATUS');
  if(row.status!=='used'&&row.expires_at&&businessDate()>row.expires_at)throw new Error('EXPIRED');
  if(row.discount_type!=='percent'&&row.discount_type!=='fixed'||!Number.isInteger(row.discount_value)||Number(row.discount_value)<=0||row.discount_type==='percent'&&Number(row.discount_value)>100)throw new Error('RULE');
  const minimum=Number(row.minimum_order_cents??0);
  if(input.subtotalCents!==undefined&&input.subtotalCents<minimum)throw new Error('MINIMUM');
  if(input.expectedReward&&(input.expectedReward.discountType!==row.discount_type||input.expectedReward.discountValue!==row.discount_value||input.expectedReward.minimumOrderCents!==minimum))throw new Error('CHANGED');
  return row;
};
posApiRoutes.post('/redemptions/preview',requireApiKey('rewards:validate'),requireErpIntegration,(req,res)=>{
  const parsed=redemptionRequest.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Informe o código do cupom e o número do pedido'});
  const input=parsed.data,code=input.code.replace(/\\s/g,'').toUpperCase();
  try{
    const row=checkRedemption(redemptionByCode(req.apiKey!.tenantId,code),input);
    res.json({data:redemptionData(row,input.orderNumber)});
  }catch(error){return redemptionError(res,error);}
});
posApiRoutes.post('/redemptions/consume',requireApiKey('rewards:validate'),requireErpIntegration,(req,res)=>{
  const parsed=redemptionRequest.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Informe o código do cupom e o número do pedido'});
  const tenantId=req.apiKey!.tenantId,input=parsed.data,code=input.code.replace(/\\s/g,'').toUpperCase();
  try{
    const result=db.transaction(()=>{
      const row=checkRedemption(redemptionByCode(tenantId,code),input);
      if(row.status==='used')return{...redemptionData(row,input.orderNumber),idempotent:true};
      const update=db.prepare("UPDATE reward_redemptions SET status='used',used_at=CURRENT_TIMESTAMP,used_by=NULL,order_number=? WHERE id=? AND tenant_id=? AND status='ready_for_use'").run(input.orderNumber,row.id,tenantId);
      if(!update.changes)throw new Error('RACE');
      return{...redemptionData({...row,status:'used'},input.orderNumber),idempotent:false};
    })();
    if(!result.idempotent)audit(tenantId,req.apiKey!.createdBy,'pdv.redemption_consume','reward_redemption',result.id,{apiKeyId:req.apiKey!.id,orderNumber:result.orderNumber});
    res.json({data:result});
  }catch(error){return redemptionError(res,error);}
});
