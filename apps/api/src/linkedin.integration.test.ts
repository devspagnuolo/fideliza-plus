import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/test-linkedin-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='linkedin-integration-secret-with-32-chars';
process.env.LINKEDIN_CLIENT_ID='linkedin-client-test';
process.env.LINKEDIN_CLIENT_SECRET='linkedin-secret-test';
process.env.LINKEDIN_REDIRECT_URI='https://api.fidelizaplus.com.br/integrations/linkedin/callback';
process.env.LINKEDIN_SCOPES='w_member_social';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {hashPassword}=await import('./security.js');
const {app}=await import('./app.js');

describe('integração LinkedIn',()=>{
  beforeAll(()=>{db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('tenant-linkedin','Empresa LinkedIn','empresa-linkedin');db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('owner-linkedin','tenant-linkedin','Responsável','linkedin@example.com',hashPassword('Senha@123'),'owner');db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('operator-linkedin','tenant-linkedin','Operador','operator-linkedin@example.com',hashPassword('Senha@123'),'operator');});
  afterAll(()=>{db.close();for(const suffix of ['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true});});
  it('expõe apenas a conexão gerencial ao proprietário e gera OAuth com state',async()=>{const owner=request.agent(app),operator=request.agent(app);await owner.post('/auth/login').send({email:'linkedin@example.com',password:'Senha@123'}).expect(200);await operator.post('/auth/login').send({email:'operator-linkedin@example.com',password:'Senha@123'}).expect(200);expect((await owner.get('/integrations/linkedin').expect(200)).body).toMatchObject({configured:true,connected:false,requestedScopes:['w_member_social']});const response=await owner.post('/integrations/linkedin/authorize').set('x-fideliza-request','web').send({}).expect(200);const url=new URL(response.body.url);expect(url.origin).toBe('https://www.linkedin.com');expect(url.pathname).toBe('/oauth/v2/authorization');expect(url.searchParams.get('client_id')).toBe('linkedin-client-test');expect(url.searchParams.get('redirect_uri')).toBe('https://api.fidelizaplus.com.br/integrations/linkedin/callback');expect(url.searchParams.get('state')?.length).toBeGreaterThan(20);expect(db.prepare("SELECT provider FROM oauth_states WHERE tenant_id=?").get('tenant-linkedin')).toEqual({provider:'linkedin'});await operator.get('/integrations/linkedin').expect(403);});
});
