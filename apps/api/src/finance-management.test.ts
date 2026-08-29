import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';

const databasePath=path.resolve(process.cwd(),`data/finance-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='finance-management-secret-32-characters';
process.env.PLATFORM_ADMIN_NAME='Admin Financeiro';
process.env.PLATFORM_ADMIN_EMAIL='admin-finance@fideliza.test';
process.env.PLATFORM_ADMIN_PASSWORD='Financeiro@123';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {app}=await import('./app.js');

describe('gestão financeira administrativa',()=>{
 const admin=request.agent(app);
 beforeAll(async()=>{db.prepare("INSERT INTO tenants(id,name,slug)VALUES('finance-tenant','Empresa Financeira','empresa-financeira')").run();db.prepare("INSERT INTO subscriptions(id,tenant_id,plan_code,status,monthly_price_cents,current_period_end,payment_method)VALUES('finance-sub','finance-tenant','essential','active',19900,date('now','+10 days'),'boleto')").run();db.prepare("INSERT INTO invoices(id,tenant_id,subscription_id,amount_cents,status,due_at,payment_method)VALUES('invoice-paid','finance-tenant','finance-sub',19900,'paid',date('now','-20 days'),'boleto'),('invoice-overdue','finance-tenant','finance-sub',19900,'overdue',date('now','-10 days'),'boleto'),('invoice-pending','finance-tenant','finance-sub',19900,'pending',date('now','+10 days'),'boleto')").run();db.prepare("UPDATE invoices SET paid_at=date('now','-19 days') WHERE id='invoice-paid'").run();await admin.post('/platform/auth/login').set('x-fideliza-request','web').send({email:process.env.PLATFORM_ADMIN_EMAIL,password:process.env.PLATFORM_ADMIN_PASSWORD}).expect(200)});
 afterAll(()=>{db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true})});

 it('calcula receita, recorrência, inadimplência e aging a partir das transações',async()=>{const response=await admin.get('/platform/finance/overview?days=365').expect(200);expect(response.body.summary).toMatchObject({mrrCents:19900,arrCents:238800,billedCents:59700,receivedCents:19900,pendingCents:19900,overdueCents:19900,activeSubscriptions:1});expect(response.body.summary.collectionRate).toBeCloseTo(33.3,1);expect(response.body.aging.find((x:any)=>x.label==='1–15 dias')).toMatchObject({count:1,valueCents:19900});expect(response.body.byPlan[0]).toMatchObject({planCode:'essential',active:1,mrrCents:19900});});

 it('mantém cupons financeiros persistentes, exclusivos e auditáveis',async()=>{const created=await admin.post('/platform/finance/coupons').set('x-fideliza-request','web').send({code:'PILOTO20',description:'Condição comercial do piloto',discountType:'percent',discountValue:20,maxUses:10,planCode:'essential'}).expect(201);await admin.post('/platform/finance/coupons').set('x-fideliza-request','web').send({code:'PILOTO20',discountType:'percent',discountValue:20}).expect(409);expect((await admin.get('/platform/finance/coupons').expect(200)).body[0]).toMatchObject({code:'PILOTO20',discountValue:20,active:1,maxUses:10});await admin.patch(`/platform/finance/coupons/${created.body.id}`).set('x-fideliza-request','web').send({active:false}).expect(204);expect((await admin.get('/platform/finance/coupons').expect(200)).body[0].active).toBe(0);expect(db.prepare("SELECT COUNT(*) total FROM platform_audit_logs WHERE entity_type='platform_coupon'").get()).toEqual({total:2});});
});
