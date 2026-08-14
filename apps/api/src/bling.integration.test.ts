import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/test-bling-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='bling-integration-secret-with-32-characters';
delete process.env.BLING_CLIENT_ID;delete process.env.BLING_CLIENT_SECRET;
const { db }=await import('./database/db.js');
await import('./database/migrate.js');
const { hashPassword }=await import('./security.js');
const { app }=await import('./app.js');

describe('integração Bling',()=>{
  beforeAll(()=>{db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('tenant-bling','Vivi Moda','vivi-moda');db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('owner-bling','tenant-bling','Viviane','bling@example.com',hashPassword('Senha@123'),'owner');db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('operator-bling','tenant-bling','Operador','operator-bling@example.com',hashPassword('Senha@123'),'operator');});
  afterAll(()=>{db.close();for(const suffix of ['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true});});
  it('não bloqueia o piloto sem credenciais e restringe a conexão ao proprietário',async()=>{const owner=request.agent(app),operator=request.agent(app);await owner.post('/auth/login').send({email:'bling@example.com',password:'Senha@123'}).expect(200);await operator.post('/auth/login').send({email:'operator-bling@example.com',password:'Senha@123'}).expect(200);expect((await owner.get('/integrations/bling').expect(200)).body).toMatchObject({configured:false,connected:false});await owner.post('/integrations/bling/authorize').set('x-fideliza-request','web').send({}).expect(503);await operator.get('/integrations/bling').expect(403);});
});
