import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/asaas-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='asaas-integration-secret-with-32-characters';
process.env.PLATFORM_ADMIN_NAME='Admin Financeiro';
process.env.PLATFORM_ADMIN_EMAIL='financeiro@fideliza.test';
process.env.PLATFORM_ADMIN_PASSWORD='Financeiro@123';
process.env.ASAAS_ENVIRONMENT='sandbox';
process.env.ASAAS_API_KEY='$aact_test_key';
process.env.ASAAS_WEBHOOK_TOKEN='asaas-webhook-token-with-more-than-32-characters';

const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {app}=await import('./app.js');

describe('integração financeira Asaas',()=>{
  beforeAll(()=>{
    db.prepare(`INSERT INTO tenants(id,name,slug,legal_name,cnpj,email,phone,responsible_name)
      VALUES('asaas-tenant','Loja Asaas','loja-asaas','Loja Asaas Ltda','11222333000181','cobranca@loja.test','11999999999','Responsável')`).run();
    db.prepare(`INSERT INTO subscriptions(id,tenant_id,plan_code,status,monthly_price_cents,current_period_end,payment_method,billing_day,gateway)
      VALUES('asaas-sub','asaas-tenant','essential','active',9900,date('now','+5 days'),'boleto',10,'asaas')`).run();
  });
  afterAll(()=>{vi.restoreAllMocks();db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true})});

  it('gera cliente e cobrança uma única vez mesmo reexecutando o ciclo',async()=>{
    let customerAttempts=0;
    const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
      const path=String(url);
      if(path.endsWith('/customers')&&++customerAttempts===1)return new Response(JSON.stringify({errors:[{description:'O celular informado é inválido.'}]}),{status:400,headers:{'content-type':'application/json'}});
      if(path.endsWith('/customers'))return new Response(JSON.stringify({id:'cus_asaas_1'}),{status:200,headers:{'content-type':'application/json'}});
      if(path.endsWith('/payments'))return new Response(JSON.stringify({id:'pay_asaas_1',status:'PENDING',invoiceUrl:'https://sandbox.asaas.com/i/1',bankSlipUrl:'https://sandbox.asaas.com/b/1'}),{status:200,headers:{'content-type':'application/json'}});
      throw new Error(`URL não simulada: ${path} ${init?.method}`);
    });
    const admin=request.agent(app);
    await admin.post('/platform/auth/login').set('x-fideliza-request','web').send({email:process.env.PLATFORM_ADMIN_EMAIL,password:process.env.PLATFORM_ADMIN_PASSWORD}).expect(200);
    const first=await admin.post('/platform/billing/run').set('x-fideliza-request','web').send({}).expect(200);
    expect(first.body).toMatchObject({processed:1,created:1,gatewayCreated:1,failures:[]});
    const second=await admin.post('/platform/billing/run').set('x-fideliza-request','web').send({}).expect(200);
    expect(second.body).toMatchObject({processed:1,created:0,gatewayCreated:0,failures:[]});
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const customerRequests=fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/customers')).map(([,init])=>JSON.parse(String(init?.body)));
    expect(customerRequests[0]).toMatchObject({mobilePhone:'11999999999'});
    expect(customerRequests[0]).not.toHaveProperty('phone');
    expect(customerRequests[1]).not.toHaveProperty('mobilePhone');
    expect(customerRequests[1]).not.toHaveProperty('phone');
    expect(db.prepare("SELECT gateway,external_payment_id,status FROM invoices WHERE subscription_id='asaas-sub'").get()).toEqual({gateway:'asaas',external_payment_id:'pay_asaas_1',status:'pending'});
  });

  it('concilia pagamento por webhook autenticado e ignora repetição',async()=>{
    const payload={id:'evt_asaas_paid_1',event:'PAYMENT_RECEIVED',payment:{id:'pay_asaas_1',externalReference:(db.prepare("SELECT id FROM invoices WHERE external_payment_id='pay_asaas_1'").get()as any).id,status:'RECEIVED',invoiceUrl:'https://sandbox.asaas.com/i/1'}};
    await request(app).post('/webhooks/asaas').set('asaas-access-token',process.env.ASAAS_WEBHOOK_TOKEN!).send(payload).expect(200,{duplicate:false,invoiceId:payload.payment.externalReference,status:'paid'});
    const periodAfterPayment=(db.prepare("SELECT current_period_end currentPeriodEnd FROM subscriptions WHERE id='asaas-sub'").get()as any).currentPeriodEnd;
    await request(app).post('/webhooks/asaas').set('asaas-access-token',process.env.ASAAS_WEBHOOK_TOKEN!).send({...payload,id:'evt_asaas_confirmed_1',event:'PAYMENT_CONFIRMED',payment:{...payload.payment,status:'CONFIRMED'}}).expect(200);
    await request(app).post('/webhooks/asaas').set('asaas-access-token',process.env.ASAAS_WEBHOOK_TOKEN!).send(payload).expect(200,{duplicate:true});
    expect(db.prepare("SELECT status FROM invoices WHERE external_payment_id='pay_asaas_1'").get()).toEqual({status:'paid'});
    expect((db.prepare("SELECT current_period_end currentPeriodEnd FROM subscriptions WHERE id='asaas-sub'").get()as any).currentPeriodEnd).toBe(periodAfterPayment);
    expect(db.prepare("SELECT COUNT(*) count FROM payment_webhook_events WHERE external_event_id='evt_asaas_paid_1'").get()).toEqual({count:1});
  });

  it('recusa webhook sem token válido',async()=>{
    await request(app).post('/webhooks/asaas').set('asaas-access-token','token-invalido').send({event:'PAYMENT_RECEIVED'}).expect(401);
  });
});
