import { afterAll,describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/test-bling-sync-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='bling-sync-test-secret-with-32-characters';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {encryptSecret}=await import('./bling.js');
const {syncBling}=await import('./bling-sync.js');

function createTenant(id:string){
  db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run(id,'Vivi Moda',id);
  db.prepare('INSERT INTO integration_connections (id,tenant_id,provider,access_token_encrypted,refresh_token_encrypted,expires_at) VALUES (?,?,?,?,?,?)').run(`connection-${id}`,id,'bling',encryptSecret('access'),encryptSecret('refresh'),new Date(Date.now()+3_600_000).toISOString());
}

createTenant('sync-tenant');
db.prepare('INSERT INTO customers (id,tenant_id,name,email,phone,cpf,enrolled_at) VALUES (?,?,?,?,?,?,?)').run('enrolled-customer','sync-tenant','Cliente já cadastrada','cliente@example.com','11988887777','11144477735','2026-08-01T12:00:00.000Z');
db.prepare("INSERT INTO sales (id,tenant_id,external_id,total_cents,occurred_at,source) VALUES (?,?,?,?,?,'bling')").run('unidentified-sale','sync-tenant','bling:21',20000,'2026-08-10T15:00:00.000Z');

createTenant('lifecycle-tenant');
db.prepare('INSERT INTO customers (id,tenant_id,name,email,phone,cpf,enrolled_at) VALUES (?,?,?,?,?,?,?)').run('lifecycle-customer','lifecycle-tenant','Cliente Ciclo','ciclo@example.com','11999998888','52998224725','2026-08-01T12:00:00.000Z');
createTenant('limited-scope-tenant');
db.prepare('INSERT INTO customers (id,tenant_id,name,email,phone,cpf,enrolled_at) VALUES (?,?,?,?,?,?,?)').run('limited-scope-customer','limited-scope-tenant','Cliente Escopo','escopo@example.com','11999998888','52998224725','2026-08-01T12:00:00.000Z');
createTenant('same-day-tenant');
db.prepare('INSERT INTO customers (id,tenant_id,name,email,phone,cpf,enrolled_at) VALUES (?,?,?,?,?,?,?)').run('same-day-customer','same-day-tenant','Cliente do mesmo dia','mesmodia@example.com','11977776666','93541134780','2026-08-10T20:00:00.000Z');

let scenario:'reconciliation'|'lifecycle'|'same-day'='reconciliation';
let lifecycleStatus:'active'|'canceled'='active';
let lifecycleTotal=200;
let situationAccess=true;
vi.stubGlobal('fetch',vi.fn(async(urlValue:string)=>{
  const url=new URL(urlValue),pathname=url.pathname;
  let data:unknown[]=[];
  if(pathname.includes('/situacoes/modulos')&&!situationAccess)return new Response(JSON.stringify({error:{message:'Forbidden'}}),{status:403,headers:{'content-type':'application/json'}});
  if(pathname.endsWith('/situacoes/modulos'))data=[{id:500,nome:'Vendas',descricao:'Pedidos de Venda'}];
  else if(pathname.endsWith('/situacoes/modulos/500'))data=[{id:1,nome:'Em aberto',idHerdado:0},{id:2,nome:'Cancelado',idHerdado:2}];
  else if(pathname.endsWith('/contatos')){
    if(scenario==='lifecycle')data=[{id:30,nome:'Cliente Ciclo',email:'ciclo@example.com',celular:'11999998888',numeroDocumento:'52998224725'}];
    else if(scenario==='same-day')data=[{id:40,nome:'Cliente do mesmo dia',email:'mesmodia@example.com',celular:'11977776666',numeroDocumento:'93541134780'}];
    else data=url.searchParams.getAll('idsContatos[]').includes('11')?[{id:11,nome:'Cliente já cadastrada',email:'cliente@example.com',celular:'11988887777',numeroDocumento:'11144477735'}]:[{id:10,nome:'Cliente Bling',email:'bling@example.com',celular:'11999990000',numeroDocumento:'52998224725'}];
  }else if(pathname.endsWith('/pedidos/vendas')){
    data=scenario==='lifecycle'?[{id:30,numero:300,data:'2026-08-10',total:lifecycleTotal,contato:{id:30},situacao:{id:lifecycleStatus==='active'?1:2,valor:lifecycleStatus==='active'?0:2}}]:scenario==='same-day'?[{id:40,numero:400,data:'2026-08-10',total:125,contato:{id:40},situacao:{id:1,valor:0}}]:[{id:20,data:'2026-08-10',total:150,contato:{id:10},situacao:{id:1,valor:0}},{id:21,numero:987,data:'2026-08-10',total:200,contato:{id:11},situacao:{id:1,valor:0}}];
  }
  return new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}});
}));

describe('sincronização Bling',()=>{
  afterAll(()=>{vi.unstubAllGlobals();db.close();for(const suffix of ['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true});});

  it('reconcilia pedido já importado buscando o contato ausente e pontua uma única vez',async()=>{
    scenario='reconciliation';situationAccess=true;
    expect(await syncBling('sync-tenant')).toMatchObject({contacts:2,ignoredContacts:0,sales:1,situationMappingAvailable:true});
    expect(await syncBling('sync-tenant')).toMatchObject({contacts:1,sales:0});
    expect((db.prepare("SELECT external_id,points_balance FROM customers WHERE id='enrolled-customer'").get() as {external_id:string;points_balance:number})).toEqual({external_id:'bling:11',points_balance:200});
    expect((db.prepare("SELECT customer_id,order_number FROM sales WHERE external_id='bling:21'").get() as {customer_id:string;order_number:string})).toEqual({customer_id:'enrolled-customer',order_number:'987'});
    expect((db.prepare("SELECT points_balance FROM customers WHERE external_id='bling:10'").get() as {points_balance:number}).points_balance).toBe(0);
    expect((db.prepare("SELECT COUNT(*) count FROM loyalty_ledger WHERE customer_id='enrolled-customer' AND entry_type='earn'").get() as {count:number}).count).toBe(1);
  });

  it('pontua compra do mesmo dia quando o Bling não fornece o horário do pedido',async()=>{
    scenario='same-day';situationAccess=true;
    expect(await syncBling('same-day-tenant')).toMatchObject({sales:1,adjustedPoints:125});
    expect((db.prepare("SELECT external_id,points_balance FROM customers WHERE id='same-day-customer'").get() as {external_id:string;points_balance:number})).toEqual({external_id:'bling:40',points_balance:125});
    expect((db.prepare("SELECT customer_id FROM sales WHERE tenant_id='same-day-tenant' AND external_id='bling:40'").get() as {customer_id:string}).customer_id).toBe('same-day-customer');
  });

  it('estorna, não duplica, permite saldo devedor e reativa apenas a diferença correta',async()=>{
    scenario='lifecycle';situationAccess=true;lifecycleStatus='active';lifecycleTotal=200;
    expect(await syncBling('lifecycle-tenant')).toMatchObject({sales:1,adjustedPoints:200});
    db.prepare("INSERT INTO loyalty_ledger (id,tenant_id,customer_id,points,reason,entry_type) VALUES (?,'lifecycle-tenant','lifecycle-customer',-150,'Resgate teste','redemption')").run(randomUUID());
    db.prepare("UPDATE customers SET points_balance=points_balance-150 WHERE id='lifecycle-customer'").run();

    lifecycleStatus='canceled';
    expect(await syncBling('lifecycle-tenant')).toMatchObject({reversedSales:1,adjustedPoints:200});
    expect((db.prepare("SELECT points_balance FROM customers WHERE id='lifecycle-customer'").get() as {points_balance:number}).points_balance).toBe(-150);
    expect((db.prepare("SELECT external_status,reversed_at FROM sales WHERE external_id='bling:30'").get() as {external_status:string;reversed_at:string|null})).toMatchObject({external_status:'Cancelado'});
    expect((db.prepare("SELECT COUNT(*) count FROM loyalty_ledger WHERE sale_id=(SELECT id FROM sales WHERE external_id='bling:30') AND entry_type='reversal'").get() as {count:number}).count).toBe(1);
    expect(await syncBling('lifecycle-tenant')).toMatchObject({reversedSales:0,adjustedPoints:0});

    lifecycleStatus='active';lifecycleTotal=250;
    expect(await syncBling('lifecycle-tenant')).toMatchObject({reinstatedSales:1,adjustedPoints:250});
    expect((db.prepare("SELECT points_balance FROM customers WHERE id='lifecycle-customer'").get() as {points_balance:number}).points_balance).toBe(100);
    expect((db.prepare("SELECT total_cents,reversed_at FROM sales WHERE external_id='bling:30'").get() as {total_cents:number;reversed_at:string|null})).toEqual({total_cents:25000,reversed_at:null});
    expect(await syncBling('lifecycle-tenant')).toMatchObject({reinstatedSales:0,adjustedPoints:0});
  },20_000);

  it('processa exclusão e ignora evento antigo recebido fora de ordem',async()=>{
    scenario='lifecycle';situationAccess=true;lifecycleStatus='active';lifecycleTotal=250;
    const payload=(eventId:string,event:string,date:string,data:object)=>JSON.stringify({eventId,date,version:'v1',event,companyId:'company',data});
    const oldEventAt=new Date(Date.now()-86_400_000).toISOString(),deleteEventAt=new Date(Date.now()+86_400_000).toISOString(),manualOverrideAt=new Date(Date.now()+172_800_000).toISOString();
    db.prepare("INSERT INTO integration_webhook_events (id,provider,external_event_id,tenant_id,event_type,occurred_at,payload) VALUES (?,'bling',?,'lifecycle-tenant','order.deleted',?,?)").run('delete-event','delete-event',deleteEventAt,payload('delete-event','order.deleted',deleteEventAt,{id:30}));
    expect(await syncBling('lifecycle-tenant')).toMatchObject({webhookEvents:1,reversedSales:1,adjustedPoints:250});
    expect((db.prepare("SELECT points_balance FROM customers WHERE id='lifecycle-customer'").get() as {points_balance:number}).points_balance).toBe(-150);
    expect((db.prepare("SELECT status FROM integration_webhook_events WHERE id='delete-event'").get() as {status:string}).status).toBe('processed');
    expect((db.prepare("SELECT order_number,total_cents FROM sales WHERE external_id='bling:30'").get() as {order_number:string;total_cents:number})).toEqual({order_number:'300',total_cents:25000});

    db.prepare("INSERT INTO integration_webhook_events (id,provider,external_event_id,tenant_id,event_type,occurred_at,payload) VALUES (?,'bling',?,'lifecycle-tenant','order.updated',?,?)").run('old-event','old-event',oldEventAt,payload('old-event','order.updated',oldEventAt,{id:30,numero:300,data:'2026-08-10',total:250,contato:{id:30},situacao:{id:1,valor:0}}));
    expect(await syncBling('lifecycle-tenant')).toMatchObject({webhookEvents:1,reinstatedSales:0,adjustedPoints:0});
    expect((db.prepare("SELECT points_balance FROM customers WHERE id='lifecycle-customer'").get() as {points_balance:number}).points_balance).toBe(-150);
    expect((db.prepare("SELECT reversed_at FROM sales WHERE external_id='bling:30'").get() as {reversed_at:string|null}).reversed_at).toBeTruthy();

    db.prepare("UPDATE sales SET reversal_source='manual' WHERE external_id='bling:30'").run();
    db.prepare("INSERT INTO integration_webhook_events (id,provider,external_event_id,tenant_id,event_type,occurred_at,payload) VALUES (?,'bling',?,'lifecycle-tenant','order.updated',?,?)").run('manual-override-event','manual-override-event',manualOverrideAt,payload('manual-override-event','order.updated',manualOverrideAt,{id:30,numero:300,data:'2026-08-10',total:250,contato:{id:30},situacao:{id:1,valor:0}}));
    expect(await syncBling('lifecycle-tenant')).toMatchObject({webhookEvents:1,reinstatedSales:0,adjustedPoints:0});
    expect((db.prepare("SELECT reversed_at,reversal_source FROM sales WHERE external_id='bling:30'").get() as {reversed_at:string|null;reversal_source:string|null})).toMatchObject({reversal_source:'manual'});
  },20_000);

  it('continua sincronizando e reconhece cancelamento quando o mapa de situações retorna 403',async()=>{
    scenario='lifecycle';situationAccess=false;lifecycleStatus='canceled';lifecycleTotal=200;
    expect(await syncBling('limited-scope-tenant')).toMatchObject({sales:1,adjustedPoints:0,situationMappingAvailable:false});
    expect((db.prepare("SELECT customer_id,external_status,reversed_at FROM sales WHERE tenant_id='limited-scope-tenant' AND external_id='bling:30'").get() as {customer_id:string;external_status:string;reversed_at:string|null})).toMatchObject({customer_id:'limited-scope-customer',external_status:'Cancelado'});
    expect((db.prepare("SELECT reversed_at FROM sales WHERE tenant_id='limited-scope-tenant' AND external_id='bling:30'").get() as {reversed_at:string|null}).reversed_at).toBeTruthy();
    situationAccess=true;
  });
});
