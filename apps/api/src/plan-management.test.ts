import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const databasePath=path.resolve(process.cwd(),`data/plans-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='plan-management-secret-32-characters';
process.env.PLATFORM_ADMIN_NAME='Admin Planos';
process.env.PLATFORM_ADMIN_EMAIL='admin-planos@fideliza.test';
process.env.PLATFORM_ADMIN_PASSWORD='Planos@123';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {app}=await import('./app.js');

describe('governança administrativa de planos',()=>{
 const admin=request.agent(app);
 beforeAll(async()=>{db.prepare("INSERT INTO tenants(id,name,slug)VALUES('plan-tenant','Empresa Growth','empresa-growth')").run();db.prepare("INSERT INTO subscriptions(id,tenant_id,plan_code,status,monthly_price_cents,current_period_end)VALUES('plan-sub','plan-tenant','growth','active',19900,date('now','+30 days'))").run();db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role)VALUES('plan-user','plan-tenant','Gestora','gestora@plan.test','hash','owner')").run();await admin.post('/platform/auth/login').set('x-fideliza-request','web').send({email:process.env.PLATFORM_ADMIN_EMAIL,password:process.env.PLATFORM_ADMIN_PASSWORD}).expect(200)});
 afterAll(()=>{db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true})});

 it('consolida catálogo, receita, utilização e fila comercial',async()=>{const response=await admin.get('/platform/plans/overview').expect(200);expect(response.body.summary).toMatchObject({activeSubscriptions:1,mrrCents:19900});expect(response.body.plans.find((x:any)=>x.code==='growth')).toMatchObject({activeSubscriptions:1,mrrCents:19900});expect(response.body.companies[0]).toMatchObject({companyName:'Empresa Growth',users:1,planCode:'growth'});});

 it('persiste add-ons, políticas de trial e regras comerciais com auditoria',async()=>{const addon=await admin.post('/platform/plans/addons').set('x-fideliza-request','web').send({code:'usuarios-10',name:'Pacote de usuários',monthlyPriceCents:4900,additionalUsers:10,additionalConsumers:0,additionalStorageMb:0,compatiblePlans:['growth']}).expect(201);const trial=await admin.post('/platform/plans/trial-policies').set('x-fideliza-request','web').send({name:'Trial Growth',planCode:'growth',durationDays:30,extensionDays:7,autoConvert:false,requiresPaymentMethod:false,conversionPlanCode:'growth',communicationDays:[7,3,1]}).expect(201);const rule=await admin.post('/platform/plans/commercial-rules').set('x-fideliza-request','web').send({name:'Upgrade assistido',ruleType:'upgrade',sourcePlanCode:'essential',targetPlanCode:'growth',discountPercent:10,approvalRequired:true,noticeDays:0}).expect(201);const overview=await admin.get('/platform/plans/overview').expect(200);expect(overview.body.addons[0]).toMatchObject({id:addon.body.id,additionalUsers:10,compatiblePlans:['growth']});expect(overview.body.trialPolicies[0]).toMatchObject({id:trial.body.id,durationDays:30,communicationDays:[7,3,1]});expect(overview.body.commercialRules[0]).toMatchObject({id:rule.body.id,approvalRequired:1});expect(db.prepare("SELECT COUNT(*) total FROM platform_audit_logs WHERE entity_type IN ('plan_addon','trial_policy','commercial_rule')").get()).toEqual({total:3});});

 it('contrata add-on por empresa com histórico, MRR e controle de status',async()=>{
  const addon=(await admin.get('/platform/plans/overview').expect(200)).body.addons.find((x:any)=>x.code==='usuarios-10');
  const created=await admin.post(`/platform/plans/addons/${addon.id}/assignments`).set('x-fideliza-request','web').send({tenantId:'plan-tenant',quantity:2,monthlyPriceCents:4900,notes:'Contrato comercial 2026-09'}).expect(201);
  await admin.post(`/platform/plans/addons/${addon.id}/assignments`).set('x-fideliza-request','web').send({tenantId:'plan-tenant',quantity:1,monthlyPriceCents:4900}).expect(409);
  let overview=(await admin.get('/platform/plans/overview').expect(200)).body;
  expect(overview.summary.addonMrrCents).toBe(9800);
  expect(overview.addonAssignments[0]).toMatchObject({id:created.body.id,companyName:'Empresa Growth',addonName:'Pacote de usuários',quantity:2,monthlyPriceCents:4900,status:'active',createdBy:'Admin Planos',notes:'Contrato comercial 2026-09'});
  expect(db.prepare("SELECT event_type eventType FROM billing_events WHERE tenant_id='plan-tenant' AND event_type='addon.assigned'").get()).toEqual({eventType:'addon.assigned'});
  await admin.patch(`/platform/plans/addon-assignments/${created.body.id}`).set('x-fideliza-request','web').send({status:'paused'}).expect(204);
  overview=(await admin.get('/platform/plans/overview').expect(200)).body;
  expect(overview.summary.addonMrrCents).toBe(0);
  expect(overview.addonAssignments[0].status).toBe('paused');
  await admin.patch(`/platform/plans/addon-assignments/${created.body.id}`).set('x-fideliza-request','web').send({status:'active'}).expect(204);
 });

 it('edita limites e recursos do plano sem perder o catálogo',async()=>{await admin.patch('/platform/plans/growth').set('x-fideliza-request','web').send({name:'Growth Pro',monthlyPriceCents:24900,userLimit:20,consumerLimit:30000,storageMb:6144,active:true,features:['crm','loyalty','api','advanced_reports']}).expect(204);const plan=(await admin.get('/platform/plans/overview').expect(200)).body.plans.find((x:any)=>x.code==='growth');expect(plan).toMatchObject({name:'Growth Pro',monthlyPriceCents:24900,userLimit:20,features:['crm','loyalty','api','advanced_reports']});});
});
