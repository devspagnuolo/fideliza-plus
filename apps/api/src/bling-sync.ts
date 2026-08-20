import { randomUUID } from 'node:crypto';
import { db } from './database/db.js';
import { decryptSecret,encryptSecret,exchangeBlingToken } from './bling.js';
import { calculateSalePoints,creditSalePoints } from './loyalty.js';
import { normalizeCpf,validCpf } from './cpf.js';

type Connection={access_token_encrypted:string;refresh_token_encrypted:string;expires_at:string;last_sync_at:string|null};
type Contact={id:number|string;nome?:string;email?:string;telefone?:string;celular?:string;numeroDocumento?:string};
type Order={id:number|string;numero?:number|string;numeroLoja?:string;data?:string;dataSaida?:string;total?:number;contato?:{id?:number|string}};
let lastRequestAt=0;
async function respectRateLimit(){const wait=Math.max(0,350-(Date.now()-lastRequestAt));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastRequestAt=Date.now();}
async function refresh(tenantId:string,connection:Connection){const tokens=await exchangeBlingToken('refresh_token',decryptSecret(connection.refresh_token_encrypted));const expiresAt=new Date(Date.now()+tokens.expiresIn*1000).toISOString();db.prepare("UPDATE integration_connections SET access_token_encrypted=?,refresh_token_encrypted=?,expires_at=?,status='connected',updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='bling'").run(encryptSecret(tokens.accessToken),encryptSecret(tokens.refreshToken),expiresAt,tenantId);return tokens.accessToken;}
async function tokenFor(tenantId:string,force=false){const connection=db.prepare("SELECT access_token_encrypted,refresh_token_encrypted,expires_at,last_sync_at FROM integration_connections WHERE tenant_id=? AND provider='bling' AND status='connected'").get(tenantId) as Connection|undefined;if(!connection)throw new Error('Bling não conectado');const token=force||new Date(connection.expires_at).getTime()<Date.now()+60_000?await refresh(tenantId,connection):decryptSecret(connection.access_token_encrypted);return {token,connection};}
async function getPage<T>(tenantId:string,path:string,params:URLSearchParams){let auth=await tokenFor(tenantId);const execute=async(token:string)=>{await respectRateLimit();return fetch(`https://api.bling.com.br/Api/v3/${path}?${params}`,{headers:{authorization:`Bearer ${token}`,'enable-jwt':'1',accept:'application/json'}});};let response=await execute(auth.token);if(response.status===401){auth=await tokenFor(tenantId,true);response=await execute(auth.token);}const body=await response.json() as {data?:T[];error?:{message?:string}};if(!response.ok)throw new Error(body.error?.message||`Bling HTTP ${response.status}`);return body.data??[];}
const occurredAt=(value?:string)=>{if(!value)return new Date().toISOString();const date=new Date(value.length===10?`${value}T12:00:00-03:00`:value);return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();};

export async function syncBling(tenantId:string){
  const connection=db.prepare("SELECT last_sync_at FROM integration_connections WHERE tenant_id=? AND provider='bling'").get(tenantId) as {last_sync_at:string|null}|undefined;
  if(!connection)throw new Error('Bling não conectado');
  const since=connection.last_sync_at??new Date(Date.now()-365*86_400_000).toISOString(),startedAt=new Date().toISOString();
  let contacts=0,ignoredContacts=0,sales=0;
  for(let page=1;page<=10;page++){
    const params=new URLSearchParams({pagina:String(page),limite:'100',dataAlteracaoInicial:since.slice(0,10)}),items=await getPage<Contact>(tenantId,'contatos',params);
    db.transaction(()=>items.forEach(item=>{
      const externalId=`bling:${item.id}`,email=item.email?.trim()||null,phone=(item.celular?.trim()||item.telefone?.trim()||'').replace(/\D/g,''),name=item.nome?.trim()||'',cpf=normalizeCpf(item.numeroDocumento||'');
      if(name.length<2||phone.length<10||!validCpf(cpf)){ignoredContacts++;return;}
      const existing=db.prepare('SELECT id FROM customers WHERE tenant_id=? AND (external_id=? OR cpf=?) ORDER BY CASE WHEN external_id=? THEN 0 ELSE 1 END LIMIT 1').get(tenantId,externalId,cpf,externalId) as {id:string}|undefined;
      if(existing)db.prepare('UPDATE customers SET external_id=?,name=?,email=COALESCE(?,email),phone=?,cpf=?,deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?').run(externalId,name,email,phone,cpf,existing.id,tenantId);
      else db.prepare('INSERT INTO customers (id,tenant_id,external_id,name,email,phone,cpf) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),tenantId,externalId,name,email,phone,cpf);
      contacts++;
    }))();
    if(items.length<100)break;
  }
  for(let page=1;page<=10;page++){
    const params=new URLSearchParams({pagina:String(page),limite:'100',dataAlteracaoInicial:since.slice(0,10)}),items=await getPage<Order>(tenantId,'pedidos/vendas',params);
    db.transaction(()=>items.forEach(item=>{
      const customer=item.contato?.id!==undefined?db.prepare('SELECT id,enrolled_at FROM customers WHERE tenant_id=? AND external_id=? AND deleted_at IS NULL').get(tenantId,`bling:${item.contato.id}`) as {id:string;enrolled_at:string|null}|undefined:undefined;
      const totalCents=Math.max(0,Math.round(Number(item.total??0)*100)),date=occurredAt(item.dataSaida??item.data),saleId=randomUUID();
      const externalId=`bling:${item.id}`,orderNumber=String(item.numeroLoja||item.numero||item.id),result=db.prepare("INSERT OR IGNORE INTO sales (id,tenant_id,customer_id,external_id,order_number,total_cents,occurred_at,source) VALUES (?,?,?,?,?,?,?,'bling')").run(saleId,tenantId,customer?.id??null,externalId,orderNumber,totalCents,date);
      db.prepare('UPDATE sales SET order_number=COALESCE(order_number,?) WHERE tenant_id=? AND external_id=?').run(orderNumber,tenantId,externalId);
      if(!result.changes)return;sales++;
      if(customer?.enrolled_at&&new Date(date)>=new Date(customer.enrolled_at)){const bonus=calculateSalePoints(tenantId,totalCents,date);creditSalePoints(tenantId,customer.id,saleId,bonus.points,'Pontos por venda importada do Bling');}
    }))();
    if(items.length<100)break;
  }
  db.prepare("UPDATE integration_connections SET last_sync_at=?,sync_cursor=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='bling'").run(startedAt,tenantId);
  return {contacts,ignoredContacts,sales,since,completedAt:startedAt};
}
