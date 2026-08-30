import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databasePath=path.resolve(process.cwd(),`data/plan-reality-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='plan-reality-secret-with-32-characters';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {hashPassword}=await import('./security.js');
const {app}=await import('./app.js');

function seed(code:string){
  const tenantId=`tenant-${code}`,email=`owner-${code}@plan.test`;
  db.prepare('INSERT INTO tenants(id,name,slug,customer_portal_enabled)VALUES(?,?,?,1)').run(tenantId,`Empresa ${code}`,tenantId);
  db.prepare("INSERT INTO subscriptions(id,tenant_id,plan_code,status,monthly_price_cents,current_period_end)VALUES(?,?,?,'active',(SELECT monthly_price_cents FROM platform_plans WHERE code=?),date('now','+30 days'))").run(`sub-${code}`,tenantId,code,code);
  db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role)VALUES(?,?,?,?,?,'owner')").run(`user-${code}`,tenantId,`Owner ${code}`,email,hashPassword('Plano@12345'));
  return{tenantId,email};
}

describe('planos comerciais aplicados de verdade',()=>{
  const tenants:Record<string,{tenantId:string;email:string}>={};
  beforeAll(()=>{for(const code of['pilot','essential','growth','professional'])tenants[code]=seed(code)});
  afterAll(()=>{db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true})});

  it('publica uma matriz progressiva com ERP e relatórios básicos em todos os planos',async()=>{
    const response=await request(app).get('/public/plans').expect(200);
    expect(response.body.trialDays).toBe(7);
    expect(response.body.plans).toHaveLength(4);
    for(const plan of response.body.plans)expect(plan.features).toEqual(expect.arrayContaining(['erp_integrations','basic_reports','core_crm','loyalty']));
    expect(response.body.plans.find((plan:any)=>plan.code==='pilot').features).not.toContain('manager_dashboard');
    expect(response.body.plans.find((plan:any)=>plan.code==='growth').features).toEqual(expect.arrayContaining(['manager_dashboard','advanced_reports','public_api']));
  });

  it('cria teste público por exatamente sete dias sem cobrança imediata',async()=>{
    const before=Date.now();
    const response=await request(app).post('/public/trials').set('x-fideliza-request','web').send({planCode:'essential',companyName:'Loja Trial',cnpj:'11222333000181',responsibleName:'Responsável Trial',email:'trial@plan.test',phone:'11999999999',password:'Trial@12345',acceptTerms:true}).expect(201);
    const subscription=db.prepare('SELECT status,current_period_end FROM subscriptions WHERE tenant_id=?').get(response.body.tenantId)as any;
    expect(subscription.status).toBe('trialing');
    const days=(new Date(`${subscription.current_period_end}T00:00:00Z`).getTime()-before)/86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThanOrEqual(7.1);
  });

  it('restringe o Piloto e libera dashboard e ofertas a partir do Essencial',async()=>{
    const pilot=request.agent(app),essential=request.agent(app);
    await pilot.post('/auth/login').send({email:tenants.pilot!.email,password:'Plano@12345'}).expect(200);
    await essential.post('/auth/login').send({email:tenants.essential!.email,password:'Plano@12345'}).expect(200);
    await pilot.get('/dashboard').expect(403);
    await pilot.get('/campaigns').expect(403);
    await pilot.get('/offers').expect(403);
    await essential.get('/dashboard').expect(200);
    await essential.get('/offers').expect(200);
    await essential.get('/api-keys').expect(403);
    await essential.get('/campaigns/analytics').expect(403);
  });

  it('libera gestão avançada no Crescimento e aplica o limite de usuários do Piloto',async()=>{
    const growth=request.agent(app),pilot=request.agent(app);
    await growth.post('/auth/login').send({email:tenants.growth!.email,password:'Plano@12345'}).expect(200);
    await pilot.post('/auth/login').send({email:tenants.pilot!.email,password:'Plano@12345'}).expect(200);
    await growth.get('/dashboard').expect(200);
    await growth.get('/campaigns/analytics').expect(200);
    await growth.get('/api-keys').expect(200);
    const first={name:'Operadora',email:'operadora@pilot.test',cpf:'52998224725',password:'Operadora@123',role:'operator'};
    await pilot.post('/team/users').set('x-fideliza-request','web').send(first).expect(201);
    await pilot.post('/team/users').set('x-fideliza-request','web').send({...first,name:'Outra pessoa',email:'outra@pilot.test',cpf:'11144477735'}).expect(409).expect(({body})=>expect(body.code).toBe('PLAN_LIMIT_REACHED'));
  });

  it('aplica a franquia de armazenamento aos anexos do ambiente',async()=>{
    const pilot=request.agent(app);
    await pilot.post('/auth/login').send({email:tenants.pilot!.email,password:'Plano@12345'}).expect(200);
    db.prepare("UPDATE platform_plans SET storage_mb=0 WHERE code='pilot'").run();
    await pilot.put('/me/avatar').set('x-fideliza-request','web').send({image:'data:image/png;base64,iVBORw0KGgo='}).expect(409).expect(({body})=>expect(body.code).toBe('PLAN_STORAGE_LIMIT_REACHED'));
    db.prepare("UPDATE platform_plans SET storage_mb=250 WHERE code='pilot'").run();
  });
});
