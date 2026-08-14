import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/test-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='integration-test-secret-with-32-characters';

const { db }=await import('./database/db.js');
await import('./database/migrate.js');
const { hashPassword }=await import('./security.js');
const { app }=await import('./app.js');

function seedTenant(id:string,email:string,customerId:string) {
  db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run(id,`Empresa ${id}`,id);
  db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run(`user-${id}`,id,`Dono ${id}`,email,hashPassword('Senha@123'),'owner');
  db.prepare('INSERT INTO customers (id,tenant_id,name,email,points_balance) VALUES (?,?,?,?,?)').run(customerId,id,`Cliente ${id}`,`cliente-${id}@example.com`,100);
}

describe('API multiempresa',()=>{
  beforeAll(()=>{seedTenant('tenant-a','owner-a@example.com','customer-a');seedTenant('tenant-b','owner-b@example.com','customer-b');});
  afterAll(()=>{db.close();for(const suffix of ['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true});});

  it('impede leitura e resgate de cliente de outra empresa',async()=>{
    const agent=request.agent(app);
    await agent.post('/auth/login').send({email:'owner-a@example.com',password:'Senha@123'}).expect(200);
    const customers=await agent.get('/customers').expect(200);
    expect(customers.body.map((item:{id:string})=>item.id)).toEqual(['customer-a']);
    await agent.get('/customers/customer-b/loyalty').expect(404);
    await agent.post('/customers/customer-b/redeem').set('x-fideliza-request','web').send({points:10,reason:'Benefício teste'}).expect(404);
  });

  it('registra resgate e auditoria dentro da empresa',async()=>{
    const agent=request.agent(app);
    await agent.post('/auth/login').send({email:'owner-a@example.com',password:'Senha@123'}).expect(200);
    await agent.post('/customers/customer-a/redeem').set('x-fideliza-request','web').send({points:25,reason:'Cupom piloto'}).expect(200);
    const loyalty=await agent.get('/customers/customer-a/loyalty').expect(200);
    expect(loyalty.body.customer.points_balance).toBe(75);
    expect(loyalty.body.ledger[0].points).toBe(-25);
    const audit=await agent.get('/audit').expect(200);
    expect(audit.body[0].action).toBe('redeem');
  });

  it('rejeita mutações autenticadas sem cabeçalho de origem',async()=>{
    const agent=request.agent(app);await agent.post('/auth/login').send({email:'owner-b@example.com',password:'Senha@123'}).expect(200);
    await agent.post('/campaigns').send({name:'Campanha teste',channel:'email'}).expect(403);
  });

  it('mantém contrato legado e disponibiliza a API v1',async()=>{
    const legacy=request.agent(app),versioned=request.agent(app);
    await legacy.post('/auth/login').send({email:'owner-a@example.com',password:'Senha@123'}).expect(200);
    await versioned.post('/api/v1/auth/login').send({email:'owner-a@example.com',password:'Senha@123'}).expect(200);
    const [legacyCustomers,v1Customers]=await Promise.all([legacy.get('/customers').expect(200),versioned.get('/api/v1/customers').expect(200)]);
    expect(v1Customers.body).toEqual(legacyCustomers.body);
    const health=await request(app).get('/health').expect(200);
    expect(health.body.version).toBe('v1');
  });
  it('gerencia ajuste, estorno e expiração de pontos com isolamento',async()=>{
    const agent=request.agent(app);
    await agent.post('/auth/login').send({email:'owner-a@example.com',password:'Senha@123'}).expect(200);
    await agent.post('/customers/customer-a/loyalty/adjust').set('x-fideliza-request','web').send({points:20,reason:'Correção de saldo'}).expect(200);
    await agent.post('/customers/customer-b/loyalty/adjust').set('x-fideliza-request','web').send({points:20,reason:'Tentativa externa'}).expect(404);
    const sale=await agent.post('/sales').set('x-fideliza-request','web').send({customerId:'customer-a',totalCents:1000}).expect(201);
    expect(sale.body.points).toBe(10);
    await agent.post(`/sales/${sale.body.id}/reverse`).set('x-fideliza-request','web').send({}).expect(200);
    await agent.post(`/sales/${sale.body.id}/reverse`).set('x-fideliza-request','web').send({}).expect(409);
    db.prepare('INSERT INTO customers (id,tenant_id,name,email,points_balance) VALUES (?,?,?,?,?)').run('customer-expiry','tenant-a','Cliente Expiração','expiry@example.com',15);
    db.prepare("INSERT INTO loyalty_ledger (id,tenant_id,customer_id,points,reason,entry_type,expires_at) VALUES (?,?,?,?,?,'earn',?)").run('expired-entry','tenant-a','customer-expiry',15,'Crédito antigo','2020-01-01T00:00:00.000Z');
    const expiration=await agent.post('/loyalty/expire').set('x-fideliza-request','web').send({}).expect(200);
    expect(expiration.body).toEqual({totalExpired:15,affectedCustomers:1});
    const loyalty=await agent.get('/customers/customer-expiry/loyalty').expect(200);
    expect(loyalty.body.ledger.some((entry:{points:number;reason:string})=>entry.points===-15&&entry.reason==='Expiração de pontos')).toBe(true);
  });
  it('aplica a melhor campanha de pontos somente na empresa e período corretos',async()=>{
    const agent=request.agent(app);
    await agent.post('/auth/login').send({email:'owner-a@example.com',password:'Senha@123'}).expect(200);
    const startsAt=new Date(Date.now()-86_400_000).toISOString(),endsAt=new Date(Date.now()+86_400_000).toISOString();
    await agent.post('/loyalty/promotions').set('x-fideliza-request','web').send({name:'Pontos em dobro',multiplier:2,startsAt,endsAt}).expect(201);
    const sale=await agent.post('/sales').set('x-fideliza-request','web').send({customerId:'customer-a',totalCents:1000}).expect(201);
    expect(sale.body).toMatchObject({points:20,multiplier:2,promotionName:'Pontos em dobro'});
    const tenantB=request.agent(app);
    await tenantB.post('/auth/login').send({email:'owner-b@example.com',password:'Senha@123'}).expect(200);
    expect((await tenantB.get('/loyalty/promotions').expect(200)).body).toEqual([]);
    expect((await tenantB.post('/sales').set('x-fideliza-request','web').send({customerId:'customer-b',totalCents:1000}).expect(201)).body.points).toBe(10);
  });
  it('calcula o onboarding e os indicadores de ativação com dados reais',async()=>{
    db.prepare('INSERT INTO tenants (id,name,slug,segment) VALUES (?,?,?,?)').run('tenant-onboarding','Empresa Onboarding','empresa-onboarding','Moda');
    db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('user-onboarding','tenant-onboarding','Dona Onboarding','onboarding@example.com',hashPassword('Senha@123'),'owner');
    const agent=request.agent(app);
    await agent.post('/auth/login').send({email:'onboarding@example.com',password:'Senha@123'}).expect(200);
    const initial=await agent.get('/onboarding').expect(200);
    expect(initial.body.progress).toBe(20);
    expect(initial.body.steps.find((step:{id:string})=>step.id==='profile').complete).toBe(true);
    const dashboard=await agent.get('/dashboard').expect(200);
    expect(dashboard.body).toMatchObject({activeCustomers:0,identificationRate:0,activation:{progress:20,activated:false}});
  });
  it('prioriza, explica e acompanha recomendações GIE sem cruzar empresas',async()=>{
    const ownerA=request.agent(app),ownerB=request.agent(app);
    await ownerA.post('/auth/login').send({email:'owner-a@example.com',password:'Senha@123'}).expect(200);
    await ownerB.post('/auth/login').send({email:'owner-b@example.com',password:'Senha@123'}).expect(200);
    const dashboard=await ownerA.get('/dashboard').expect(200);
    expect(dashboard.body.recommendations.length).toBeGreaterThan(0);
    const recommendation=dashboard.body.recommendations[0];
    expect(recommendation).toEqual(expect.objectContaining({id:expect.any(String),explanation:expect.any(String),priority:expect.any(Number),metricName:expect.any(String),baselineValue:expect.any(Number),currentValue:expect.any(Number)}));
    await ownerB.patch(`/gie/recommendations/${recommendation.id}`).set('x-fideliza-request','web').send({status:'accepted'}).expect(404);
    await ownerA.patch(`/gie/recommendations/${recommendation.id}`).set('x-fideliza-request','web').send({status:'accepted'}).expect(200);
    const refreshed=await ownerA.get('/dashboard').expect(200);
    expect(refreshed.body.recommendations.find((item:{id:string})=>item.id===recommendation.id).status).toBe('accepted');
  });
});
