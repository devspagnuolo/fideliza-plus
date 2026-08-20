import { randomUUID } from 'node:crypto';
import { db } from './database/db.js';
import { decryptSecret,encryptSecret,exchangeBlingToken } from './bling.js';
import { calculateSalePoints,reconcileSalePoints } from './loyalty.js';
import { normalizeCpf,validCpf } from './cpf.js';

type Connection={access_token_encrypted:string;refresh_token_encrypted:string;expires_at:string;last_sync_at:string|null};
type Contact={id:number|string;nome?:string;email?:string;telefone?:string;celular?:string;numeroDocumento?:string};
type Order={id:number|string;numero?:number|string;numeroLoja?:string;data?:string;dataSaida?:string;total?:number;contato?:{id?:number|string};situacao?:{id?:number|string;valor?:number|string}};
type SituationModule={id:number|string;nome?:string;descricao?:string};
type Situation={id:number|string;nome?:string;idHerdado?:number|string};
type WebhookRow={id:string;event_type:string;occurred_at:string;payload:string};
type StoredSale={id:string;customer_id:string|null;order_number:string|null;total_cents:number;occurred_at:string;reversed_at:string|null;reversal_source:string|null;external_updated_at:string|null};
type SyncStats={contacts:number;ignoredContacts:number;sales:number;updatedSales:number;reversedSales:number;reinstatedSales:number;adjustedPoints:number;webhookEvents:number;failedWebhookEvents:number};

let lastRequestAt=0;
const runningSyncs=new Map<string,Promise<SyncResult>>();
type SyncResult=SyncStats&{since:string;completedAt:string;situationMappingAvailable:boolean};
async function respectRateLimit(){const wait=Math.max(0,350-(Date.now()-lastRequestAt));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastRequestAt=Date.now();}
async function refresh(tenantId:string,connection:Connection){const tokens=await exchangeBlingToken('refresh_token',decryptSecret(connection.refresh_token_encrypted));const expiresAt=new Date(Date.now()+tokens.expiresIn*1000).toISOString();db.prepare("UPDATE integration_connections SET access_token_encrypted=?,refresh_token_encrypted=?,expires_at=?,status='connected',updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='bling'").run(encryptSecret(tokens.accessToken),encryptSecret(tokens.refreshToken),expiresAt,tenantId);return tokens.accessToken;}
async function tokenFor(tenantId:string,force=false){const connection=db.prepare("SELECT access_token_encrypted,refresh_token_encrypted,expires_at,last_sync_at FROM integration_connections WHERE tenant_id=? AND provider='bling' AND status='connected'").get(tenantId) as Connection|undefined;if(!connection)throw new Error('Bling não conectado');const token=force||new Date(connection.expires_at).getTime()<Date.now()+60_000?await refresh(tenantId,connection):decryptSecret(connection.access_token_encrypted);return {token,connection};}
async function getPage<T>(tenantId:string,path:string,params=new URLSearchParams()){let auth=await tokenFor(tenantId);const execute=async(token:string)=>{await respectRateLimit();return fetch(`https://api.bling.com.br/Api/v3/${path}?${params}`,{headers:{authorization:`Bearer ${token}`,'enable-jwt':'1',accept:'application/json'}});};let response=await execute(auth.token);if(response.status===401){auth=await tokenFor(tenantId,true);response=await execute(auth.token);}const body=await response.json().catch(()=>({})) as {data?:T[];message?:string;error?:{message?:string;description?:string}};if(!response.ok){const detail=body.error?.message||body.error?.description||body.message;throw new Error(detail?`Bling ${path}: ${detail} (HTTP ${response.status})`:`Bling ${path}: acesso recusado (HTTP ${response.status})`);}return body.data??[];}
const occurredAt=(value?:string)=>{if(!value)return new Date().toISOString();const date=new Date(value.length===10?`${value}T12:00:00-03:00`:value);return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();};
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const isReversedStatus=(value:string)=>/(cancel|exclu|estorn|devolv|anulad)/.test(normalized(value));

function upsertContact(tenantId:string,item:Contact){
  const externalId=`bling:${item.id}`,email=item.email?.trim()||null,phone=(item.celular?.trim()||item.telefone?.trim()||'').replace(/\D/g,''),name=item.nome?.trim()||'',cpf=normalizeCpf(item.numeroDocumento||'');
  if(name.length<2||phone.length<10||!validCpf(cpf))return false;
  const existing=db.prepare('SELECT id FROM customers WHERE tenant_id=? AND (external_id=? OR cpf=?) ORDER BY CASE WHEN external_id=? THEN 0 ELSE 1 END LIMIT 1').get(tenantId,externalId,cpf,externalId) as {id:string}|undefined;
  if(existing)db.prepare('UPDATE customers SET external_id=?,name=?,email=COALESCE(?,email),phone=?,cpf=?,deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?').run(externalId,name,email,phone,cpf,existing.id,tenantId);
  else db.prepare('INSERT INTO customers (id,tenant_id,external_id,name,email,phone,cpf) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),tenantId,externalId,name,email,phone,cpf);
  return true;
}

async function loadSituationMap(tenantId:string){
  const modules=await getPage<SituationModule>(tenantId,'situacoes/modulos');
  const salesModule=modules.find(item=>{const value=normalized(`${item.nome??''} ${item.descricao??''}`);return value.includes('venda')&&value.includes('pedido');})??modules.find(item=>normalized(item.descricao??'').includes('venda'));
  if(!salesModule)throw new Error('Bling não retornou o módulo de situações de pedidos de venda');
  const situations=await getPage<Situation>(tenantId,`situacoes/modulos/${salesModule.id}`);
  if(!situations.length)throw new Error('Bling não retornou as situações de pedidos de venda');
  return new Map(situations.map(item=>[String(item.id),item]));
}

function orderState(item:Order,situations:Map<string,Situation>,deleted=false){
  if(deleted)return {status:'Excluído no Bling',reversed:true,known:true};
  const rawId=item.situacao?.id===undefined?'':String(item.situacao.id),situation=situations.get(rawId),officialValue=item.situacao?.valor===undefined?undefined:Number(item.situacao.valor),fallback=String(item.situacao?.valor??(rawId||'não informada')),canceled=Number(situation?.idHerdado)===2||officialValue===2,status=situation?.nome?.trim()||(canceled?'Cancelado':`Situação ${fallback}`);
  return {status,reversed:isReversedStatus(status)||canceled,known:Boolean(situation)||officialValue!==undefined};
}

function customerForOrder(tenantId:string,item:Order){
  if(item.contato?.id===undefined)return undefined;
  return db.prepare('SELECT id,enrolled_at FROM customers WHERE tenant_id=? AND external_id=? AND deleted_at IS NULL').get(tenantId,`bling:${item.contato.id}`) as {id:string;enrolled_at:string|null}|undefined;
}

function notifyAdjustment(tenantId:string,customerId:string,orderNumber:string,delta:number){
  if(!delta)return;
  const reversed=delta<0,title=reversed?'Pontos ajustados por estorno':'Pontos creditados',points=Math.abs(delta),message=reversed?`${points} ponto(s) foram estornados após a atualização do pedido ${orderNumber}.`:`${points} ponto(s) foram creditados pelo pedido ${orderNumber}.`;
  db.prepare("INSERT INTO customer_notifications (id,tenant_id,customer_id,title,message,type) VALUES (?,?,?,?,?,'loyalty')").run(randomUUID(),tenantId,customerId,title,message);
}

function reconcileOrder(tenantId:string,item:Order,situations:Map<string,Situation>,stats:SyncStats,externalUpdatedAt:string,deleted=false){
  const externalId=`bling:${item.id}`,existing=db.prepare('SELECT id,customer_id,order_number,total_cents,occurred_at,reversed_at,reversal_source,external_updated_at FROM sales WHERE tenant_id=? AND external_id=?').get(tenantId,externalId) as StoredSale|undefined;
  if(existing?.external_updated_at&&new Date(existing.external_updated_at)>new Date(externalUpdatedAt))return;

  const customer=customerForOrder(tenantId,item),hasContact=item.contato?.id!==undefined,customerId=hasContact?customer?.id??null:existing?.customer_id??null;
  const totalCents=deleted&&existing?existing.total_cents:Math.max(0,Math.round(Number(item.total??0)*100)),date=deleted&&existing?existing.occurred_at:occurredAt(item.dataSaida??item.data),orderNumber=deleted&&existing?existing.order_number??String(item.id):String(item.numeroLoja||item.numero||item.id),state=orderState(item,situations,deleted);
  const manualReversal=existing?.reversal_source==='manual',reversed=manualReversal?true:state.known||deleted?state.reversed:Boolean(existing?.reversed_at),saleId=existing?.id??randomUUID(),reversedAt=reversed?existing?.reversed_at??externalUpdatedAt:null,reversalSource=reversed?(manualReversal?'manual':'bling'):null;

  if(!existing){
    db.prepare("INSERT INTO sales (id,tenant_id,customer_id,external_id,order_number,total_cents,occurred_at,source,reversed_at,reversal_source,external_status,external_updated_at) VALUES (?,?,?,?,?,?,?,'bling',?,?,?,?)").run(saleId,tenantId,customerId,externalId,orderNumber,totalCents,date,reversedAt,reversalSource,state.status,externalUpdatedAt);
    stats.sales++;
  }else{
    if(existing.customer_id&&existing.customer_id!==customerId){const old=reconcileSalePoints(tenantId,existing.customer_id,saleId,0,'Estorno por alteração do cliente no pedido Bling');stats.adjustedPoints+=Math.abs(old.delta);notifyAdjustment(tenantId,existing.customer_id,orderNumber,old.delta);}
    db.prepare('UPDATE sales SET customer_id=?,order_number=?,total_cents=?,occurred_at=?,reversed_at=?,reversal_source=?,external_status=?,external_updated_at=? WHERE id=? AND tenant_id=?').run(customerId,orderNumber,totalCents,date,reversedAt,reversalSource,state.status,externalUpdatedAt,saleId,tenantId);
    stats.updatedSales++;
  }

  let desiredPoints=0;
  if(!reversed&&customerId&&customer?.enrolled_at&&new Date(date)>=new Date(customer.enrolled_at))desiredPoints=calculateSalePoints(tenantId,totalCents,date).points;
  if(customerId){
    const reason=reversed?'Estorno automático por cancelamento ou exclusão no Bling':existing?.reversed_at?'Reativação automática do pedido no Bling':'Conciliação automática de pontos do pedido Bling',adjustment=reconcileSalePoints(tenantId,customerId,saleId,desiredPoints,reason);
    stats.adjustedPoints+=Math.abs(adjustment.delta);
    notifyAdjustment(tenantId,customerId,orderNumber,adjustment.delta);
    if(adjustment.delta<0)stats.reversedSales++;
    if(adjustment.delta>0&&Boolean(existing?.reversed_at))stats.reinstatedSales++;
  }
}

function webhookOrder(row:WebhookRow){
  const body=JSON.parse(row.payload) as {data?:unknown};
  if(!body.data||typeof body.data!=='object')throw new Error('Payload do pedido não contém dados');
  const data=body.data as Partial<Order>;
  if(data.id===undefined)throw new Error('Payload do pedido não contém ID');
  return data as Order;
}

async function fetchMissingContacts(tenantId:string,orders:Order[],stats:SyncStats){
  const missing=[...new Set(orders.map(item=>item.contato?.id).filter((id):id is string|number=>id!==undefined).filter(id=>!db.prepare('SELECT 1 FROM customers WHERE tenant_id=? AND external_id=?').get(tenantId,`bling:${id}`)))];
  for(let offset=0;offset<missing.length;offset+=100){
    const params=new URLSearchParams({pagina:'1',limite:'100'});missing.slice(offset,offset+100).forEach(id=>params.append('idsContatos[]',String(id)));
    const fetched=await getPage<Contact>(tenantId,'contatos',params);
    db.transaction(()=>fetched.forEach(item=>upsertContact(tenantId,item)?stats.contacts++:stats.ignoredContacts++))();
  }
}

async function processWebhookEvents(tenantId:string,situations:Map<string,Situation>,stats:SyncStats){
  for(let batch=0;batch<20;batch++){
    const events=db.prepare("SELECT id,event_type,occurred_at,payload FROM integration_webhook_events WHERE tenant_id=? AND provider='bling' AND event_type LIKE 'order.%' AND (status='accepted' OR (status='failed' AND attempts<10 AND processed_at<=datetime('now','-5 minutes'))) ORDER BY occurred_at,created_at LIMIT 500").all(tenantId) as WebhookRow[];
    if(!events.length)break;
    const orders:Order[]=[];
    for(const event of events){try{orders.push(webhookOrder(event));}catch{/* O evento será marcado individualmente abaixo. */}}
    await fetchMissingContacts(tenantId,orders,stats);
    for(const event of events){
      try{
        const order=webhookOrder(event),deleted=event.event_type.endsWith('.deleted');
        db.transaction(()=>{reconcileOrder(tenantId,order,situations,stats,event.occurred_at,deleted);db.prepare("UPDATE integration_webhook_events SET status='processed',processed_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=? AND tenant_id=?").run(event.id,tenantId);})();
        stats.webhookEvents++;
      }catch(error){db.prepare("UPDATE integration_webhook_events SET status='failed',attempts=attempts+1,last_error=?,processed_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?").run((error as Error).message.slice(0,500),event.id,tenantId);stats.failedWebhookEvents++;}
    }
    if(events.length<500)break;
  }
}

async function performSync(tenantId:string):Promise<SyncResult>{
  const connection=db.prepare("SELECT last_sync_at FROM integration_connections WHERE tenant_id=? AND provider='bling'").get(tenantId) as {last_sync_at:string|null}|undefined;
  if(!connection)throw new Error('Bling não conectado');
  const since=connection.last_sync_at??new Date(Date.now()-365*86_400_000).toISOString(),startedAt=new Date().toISOString(),stats:SyncStats={contacts:0,ignoredContacts:0,sales:0,updatedSales:0,reversedSales:0,reinstatedSales:0,adjustedPoints:0,webhookEvents:0,failedWebhookEvents:0};
  const situations=await loadSituationMap(tenantId).catch(error=>{console.warn(`Mapa de situações do Bling indisponível; usando os códigos do pedido: ${(error as Error).message}`);return new Map<string,Situation>();});
  for(let page=1;page<=1000;page++){
    const params=new URLSearchParams({pagina:String(page),limite:'100',dataAlteracaoInicial:since.slice(0,10)}),items=await getPage<Contact>(tenantId,'contatos',params);
    db.transaction(()=>items.forEach(item=>upsertContact(tenantId,item)?stats.contacts++:stats.ignoredContacts++))();
    if(items.length<100)break;
  }
  await processWebhookEvents(tenantId,situations,stats);
  for(let page=1;page<=1000;page++){
    const params=new URLSearchParams({pagina:String(page),limite:'100',dataAlteracaoInicial:since.slice(0,10)}),items=await getPage<Order>(tenantId,'pedidos/vendas',params);
    await fetchMissingContacts(tenantId,items,stats);
    db.transaction(()=>items.forEach(item=>reconcileOrder(tenantId,item,situations,stats,startedAt)))();
    if(items.length<100)break;
  }
  db.prepare("UPDATE integration_connections SET last_sync_at=?,sync_cursor=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='bling'").run(startedAt,tenantId);
  return {...stats,since,completedAt:startedAt,situationMappingAvailable:situations.size>0};
}

export function syncBling(tenantId:string){
  const running=runningSyncs.get(tenantId);
  if(running)return running;
  const operation=performSync(tenantId).finally(()=>runningSyncs.delete(tenantId));
  runningSyncs.set(tenantId,operation);
  return operation;
}
