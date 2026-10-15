import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/test-public-api-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='public-api-test-secret-with-32-chars';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {hashPassword}=await import('./security.js');
const {app}=await import('./app.js');

describe('API pública',()=>{
  beforeAll(()=>{
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('public-a','Empresa A','public-a');
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('public-b','Empresa B','public-b');
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('public-bling','Empresa com Bling','public-bling');
    db.prepare("INSERT INTO subscriptions(id,tenant_id,plan_code,status)VALUES('sub-public-a','public-a','professional','active'),('sub-public-b','public-b','professional','active'),('sub-public-bling','public-bling','professional','active')").run();
    db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('public-owner','public-a','Dona A','public@example.com',hashPassword('Senha@123'),'owner');
    db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('public-bling-owner','public-bling','Dona Bling','bling-owner@example.com',hashPassword('Senha@123'),'owner');
    db.prepare('INSERT INTO integration_connections (id,tenant_id,provider,access_token_encrypted,refresh_token_encrypted,expires_at,status) VALUES (?,?,?,?,?,?,?)').run('public-bling-connection','public-bling','bling','encrypted-access','encrypted-refresh','2099-12-31T23:59:59.000Z','connected');
    db.prepare('INSERT INTO customers (id,tenant_id,name,email) VALUES (?,?,?,?)').run('public-customer-a','public-a','Cliente A','a@example.com');
    db.prepare('INSERT INTO customers (id,tenant_id,name,email) VALUES (?,?,?,?)').run('public-customer-b','public-b','Cliente B','b@example.com');
  });
  afterAll(()=>{db.close();for(const suffix of ['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true});});

  it('mostra a chave uma vez, respeita escopo e isola empresas',async()=>{
    const owner=request.agent(app);
    await owner.post('/auth/login').send({email:'public@example.com',password:'Senha@123'}).expect(200);
    const created=await owner.post('/api-keys').set('x-fideliza-request','web').send({name:'Integração teste',scopes:['customers:read']}).expect(201);
    expect(created.body.key).toMatch(/^fz_live_/);
    expect((await owner.get('/api-keys').expect(200)).body[0].key).toBeUndefined();
    const customers=await request(app).get('/public/v1/customers').set('authorization',`Bearer ${created.body.key}`).expect(200);
    expect(customers.body.data.map((item:{id:string})=>item.id)).toEqual(['public-customer-a']);
    await request(app).get('/public/v1/sales').set('authorization',`Bearer ${created.body.key}`).expect(403);
    await owner.delete(`/api-keys/${created.body.id}`).set('x-fideliza-request','web').expect(204);
    await request(app).get('/public/v1/customers').set('authorization',`Bearer ${created.body.key}`).expect(401);
  });

  it('usa exclusivamente o pedido do Bling quando a integração está conectada',async()=>{
    const owner=request.agent(app);
    await owner.post('/auth/login').send({email:'bling-owner@example.com',password:'Senha@123'}).expect(200);
    const created=await owner.post('/api-keys').set('x-fideliza-request','web').send({name:'PDV com Bling',scopes:['sales:write']}).expect(201);
    const auth={authorization:`Bearer ${created.body.key}`};
    const directSale=await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'pedido-pdv-1',orderNumber:'PDV-1',totalCents:12500}).expect(409);
    expect(directSale.body).toMatchObject({code:'BLING_ORDER_SOURCE_REQUIRED',provider:'bling',acceptedExternalIdPrefix:'bling:'});
    const directReverse=await request(app).post('/public/v1/sales/pedido-pdv-1/reverse').set(auth).send({}).expect(409);
    expect(directReverse.body.code).toBe('BLING_ORDER_SOURCE_REQUIRED');
    expect((db.prepare("SELECT COUNT(*) count FROM sales WHERE tenant_id='public-bling'").get()as{count:number}).count).toBe(0);
  });

  it('cria acesso de cliente pelo PDV, registra venda idempotente, estorno e cupom de uso único',async()=>{
    const owner=request.agent(app);
    await owner.post('/auth/login').send({email:'public@example.com',password:'Senha@123'}).expect(200);
    const created=await owner.post('/api-keys').set('x-fideliza-request','web').send({name:'PDV loja',scopes:['customers:read','customers:write','sales:read','sales:write','rewards:validate']}).expect(201);
    const auth={authorization:`Bearer ${created.body.key}`};
    const sameDayOrder=await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'order-before-registration',orderNumber:'099',totalCents:8900,occurredAt:new Date().toISOString()}).expect(201);
    expect(sameDayOrder.body.data).toMatchObject({points:0,customerLinked:false,eligibleForPoints:false});
    const previousDay=new Date(Date.now()-2*86_400_000).toISOString();
    await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'old-order-before-registration',orderNumber:'098',totalCents:5000,occurredAt:previousDay}).expect(201);
    const upsert=await request(app).post('/public/v1/customers/upsert').set(auth).send({name:'Cliente PDV',cpf:'52998224725',phone:'11999998888',email:'cliente.pdv@example.com',programConsent:true}).expect(201);
    expect(upsert.body.customer).toMatchObject({eligibleForPoints:true});
    expect(upsert.body.accessCreated).toBe(true);
    expect((db.prepare("SELECT template FROM outbound_messages WHERE recipient=?").get('cliente.pdv@example.com')as any).template).toBe('customer.pdv_welcome');
    const lookup=await request(app).get('/public/v1/customers/lookup?cpf=52998224725').set(auth).expect(200);
    expect(lookup.body.data.name).toBe('Cliente PDV');
    const linkedSameDay=await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'order-before-registration',orderNumber:'099',customerCpf:'52998224725',totalCents:8900}).expect(200);
    expect(linkedSameDay.body.data).toMatchObject({points:89,pointsAdjusted:89,customerLinked:true,idempotent:true,eligibleForPoints:true});
    const linkedAgain=await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'order-before-registration',orderNumber:'099',customerCpf:'52998224725',totalCents:8900}).expect(200);
    expect(linkedAgain.body.data).toMatchObject({points:89,pointsAdjusted:0,customerLinked:false,idempotent:true});
    const oldOrder=await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'old-order-before-registration',orderNumber:'098',customerCpf:'52998224725',totalCents:5000}).expect(200);
    expect(oldOrder.body.data).toMatchObject({points:0,pointsAdjusted:0,customerLinked:true,eligibleForPoints:false});
    const sale=await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'order-100',orderNumber:'100',customerCpf:'52998224725',totalCents:12500}).expect(201);
    expect(sale.body.data).toMatchObject({points:125,idempotent:false});
    const duplicate=await request(app).post('/public/v1/sales').set(auth).send({externalSaleId:'order-100',orderNumber:'100',customerCpf:'52998224725',totalCents:12500}).expect(200);
    expect(duplicate.body.data).toMatchObject({idempotent:true,points:125});
    await request(app).post('/public/v1/sales/order-100/reverse').set(auth).send({}).expect(200);
    const rewardId='pdv-reward',redemptionId='pdv-redemption';
    db.prepare("INSERT INTO rewards(id,tenant_id,name,points_cost,active,reward_type,valid_until) VALUES(?,?,?,?,1,'coupon',?)").run(rewardId,'public-a','Cupom PDV',100,'2099-12-31');
    db.prepare("INSERT INTO reward_redemptions(id,tenant_id,reward_id,customer_id,points_spent,status,redemption_code,expires_at) VALUES(?,?,?,?,?,'ready_for_use',?,?)").run(redemptionId,'public-a',rewardId,upsert.body.customer.id,100,'FZ-PDV1234','2099-12-31');
    const coupon=await request(app).post('/public/v1/redemptions/consume').set(auth).send({code:'FZ-PDV1234',orderNumber:'100'}).expect(200);
    expect(coupon.body.data).toMatchObject({status:'used',orderNumber:'100'});
    await request(app).post('/public/v1/redemptions/consume').set(auth).send({code:'FZ-PDV1234',orderNumber:'100'}).expect(409);
  });
});
