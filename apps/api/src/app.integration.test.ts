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
});
