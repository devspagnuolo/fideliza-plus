import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databasePath=path.resolve(process.cwd(),`data/plan-reality-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='plan-reality-secret-with-32-characters';
process.env.ASAAS_BILLING_ENABLED='true';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {hashPassword}=await import('./security.js');
const {app}=await import('./app.js');
const {runAsaasBillingCycle}=await import('./asaas.js');
const trialEmailCode=async(email:string)=>(await request(app).post('/public/trials/email-code').set('x-fideliza-request','web').send({email}).expect(202)).body.developmentCode as string;

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
    for(const plan of response.body.plans)expect(plan.features).toEqual(expect.arrayContaining(['erp_integrations','basic_reports','core_crm','loyalty','rewards','customer_portal']));
    expect(response.body.plans.find((plan:any)=>plan.code==='pilot').features).not.toContain('manager_dashboard');
    expect(response.body.plans.find((plan:any)=>plan.code==='essential').features).toEqual(expect.arrayContaining(['campaigns_basic','operational_dashboard','offers']));
    expect(response.body.plans.find((plan:any)=>plan.code==='essential').features).not.toContain('campaigns_advanced');
    expect(response.body.plans.find((plan:any)=>plan.code==='growth').features).toEqual(expect.arrayContaining(['manager_dashboard','advanced_reports','public_api']));
    expect(response.body.plans.find((plan:any)=>plan.code==='growth').features).not.toContain('multi_unit');
    expect(response.body.plans.find((plan:any)=>plan.code==='professional').features).toEqual(expect.arrayContaining(['multi_unit','audit_export']));
    const contract=await request(app).get('/public/software-license-contract').expect(200);
    expect(contract.body).toMatchObject({version:'1.0',effectiveDate:'2026-09-10'});
    expect(contract.body.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(contract.body.sections).toHaveLength(50);
  });

  it('não cria assinatura sem aceite contratual e ciência da fidelidade mínima',async()=>{
    await request(app).post('/public/trials').set('x-fideliza-request','web').send({planCode:'pilot',companyName:'Sem Aceite',legalName:'Sem Aceite LTDA',cnpj:'33444555000103',responsibleName:'Responsável',email:'sem-aceite@plan.test',phone:'11977776666',password:'Contrato@123',postalCode:'01310100',address:'Avenida Paulista',addressNumber:'10',complement:'',district:'Bela Vista',city:'São Paulo',state:'SP',paymentMethod:'boleto',acceptTerms:true,billingConsent:true}).expect(400);
    expect(db.prepare("SELECT COUNT(*) total FROM tenants WHERE cnpj='33444555000103'").get()).toEqual({total:0});
  });

  it('reflete imediatamente no site o preço e os limites atualizados pelo administrador',async()=>{
    db.prepare("UPDATE platform_plans SET monthly_price_cents=5790,user_limit=3,consumer_limit=1250 WHERE code='pilot'").run();
    const response=await request(app).get('/public/plans').expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.plans.find((plan:any)=>plan.code==='pilot').monthlyPriceCents).toBe(5790);
    expect(response.body.plans.find((plan:any)=>plan.code==='pilot')).toMatchObject({userLimit:3,consumerLimit:1250});
    db.prepare("UPDATE platform_plans SET monthly_price_cents=4900,user_limit=2,consumer_limit=1000 WHERE code='pilot'").run();
  });

  it('cria teste público por exatamente sete dias sem cobrança imediata',async()=>{
    const before=Date.now();
    const emailCode=await trialEmailCode('trial@plan.test');
    const response=await request(app).post('/public/trials').set('x-fideliza-request','web').send({planCode:'essential',companyName:'Loja Trial',legalName:'Loja Trial LTDA',cnpj:'11222333000181',responsibleName:'Responsável Trial',email:'trial@plan.test',phone:'11999999999',password:'Trial@12345',postalCode:'01310100',address:'Avenida Paulista',addressNumber:'1000',complement:'',district:'Bela Vista',city:'São Paulo',state:'SP',paymentMethod:'boleto',acceptContract:true,acceptTerms:true,minimumTermConsent:true,billingConsent:true,emailCode}).expect(201);
    const subscription=db.prepare('SELECT status,current_period_end,monthly_price_cents monthlyPriceCents,payment_method paymentMethod,billing_consent_at billingConsentAt FROM subscriptions WHERE tenant_id=?').get(response.body.tenantId)as any;
    expect(subscription.status).toBe('trialing');
    expect(subscription.monthlyPriceCents).toBe(9900);
    expect(subscription.paymentMethod).toBe('boleto');
    expect(subscription.billingConsentAt).toBeTruthy();
    const acceptance=db.prepare('SELECT contract_version contractVersion,contract_hash contractHash,signer_email signerEmail,plan_code planCode,monthly_price_cents monthlyPriceCents,minimum_term_consent minimumTermConsent,billing_consent billingConsent,ip_address ipAddress,contract_snapshot contractSnapshot FROM subscription_contract_acceptances WHERE subscription_id=?').get(response.body.subscriptionId)as any;
    expect(acceptance).toMatchObject({contractVersion:'1.0',signerEmail:'trial@plan.test',planCode:'essential',monthlyPriceCents:9900,minimumTermConsent:1,billingConsent:1});
    expect(acceptance.contractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(acceptance.contractSnapshot).sections).toHaveLength(50);
    expect(db.prepare('SELECT COUNT(*) total FROM invoices WHERE tenant_id=?').get(response.body.tenantId)).toEqual({total:0});
    const cycle=await runAsaasBillingCycle();
    expect(cycle.created).toBe(0);
    const days=(new Date(`${subscription.current_period_end}T00:00:00Z`).getTime()-before)/86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThanOrEqual(7.1);
  });

  it('agenda cartão no checkout Asaas para o fim do teste sem receber dados do cartão',async()=>{
    const previousKey=process.env.ASAAS_API_KEY,requests:Array<{url:string;body:any}>=[];
    process.env.ASAAS_API_KEY='sandbox-test-key';
    const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const url=String(input),body=init?.body?JSON.parse(String(init.body)):undefined;requests.push({url,body});
      if(url.endsWith('/customers'))return new Response(JSON.stringify({id:'cus_trial_card'}),{status:200,headers:{'content-type':'application/json'}});
      if(url.endsWith('/checkouts'))return new Response(JSON.stringify({id:'chk_trial_card',link:'https://sandbox.asaas.com/checkoutSession/show/chk_trial_card'}),{status:200,headers:{'content-type':'application/json'}});
      return new Response('{}',{status:404,headers:{'content-type':'application/json'}});
    });
    try{
      const emailCode=await trialEmailCode('card@plan.test');
      const response=await request(app).post('/public/trials').set('x-fideliza-request','web').send({planCode:'growth',companyName:'Loja Cartão',legalName:'Loja Cartão LTDA',cnpj:'22333444000192',responsibleName:'Responsável Cartão',email:'card@plan.test',phone:'11988887777',password:'Cartao@12345',postalCode:'01310100',address:'Avenida Paulista',addressNumber:'2000',complement:'Sala 2',district:'Bela Vista',city:'São Paulo',state:'SP',paymentMethod:'card',acceptContract:true,acceptTerms:true,minimumTermConsent:true,billingConsent:true,emailCode}).expect(201);
      expect(response.body.checkoutUrl).toContain('chk_trial_card');
      const checkout=requests.find(item=>item.url.endsWith('/checkouts'))?.body;
      expect(checkout).toMatchObject({billingTypes:['CREDIT_CARD'],chargeTypes:['RECURRENT'],externalReference:response.body.subscriptionId,subscription:{cycle:'MONTHLY'}});
      expect(new Date(`${checkout.subscription.nextDueDate}T00:00:00Z`).getTime()-Date.now()).toBeGreaterThan(6*86_400_000);
      expect(JSON.stringify(checkout)).not.toMatch(/creditCard|cardNumber|cvv/i);
      const subscription=db.prepare('SELECT billing_setup_status status,external_checkout_id checkoutId FROM subscriptions WHERE id=?').get(response.body.subscriptionId)as any;
      expect(subscription).toEqual({status:'checkout_pending',checkoutId:'chk_trial_card'});
      // O retorno do navegador não confirma o cartão; só o Asaas confirma, e o "ready" não é desfeito.
      const token=new URL(checkout.callback.successUrl).searchParams.get('token');
      expect((await request(app).post('/public/trials/billing-confirm').set('x-fideliza-request','web').send({token,status:'success'}).expect(200)).body.status).toBe('checkout_returned');
      db.prepare("UPDATE subscriptions SET billing_setup_status='ready' WHERE id=?").run(response.body.subscriptionId);
      expect((await request(app).post('/public/trials/billing-confirm').set('x-fideliza-request','web').send({token,status:'cancel'}).expect(200)).body.status).toBe('ready');
    }finally{fetchMock.mockRestore();if(previousKey===undefined)delete process.env.ASAAS_API_KEY;else process.env.ASAAS_API_KEY=previousKey}
  });

  it('restringe o Piloto e libera dashboard, ofertas e integração ERP a partir do Essencial',async()=>{
    const pilot=request.agent(app),essential=request.agent(app);
    await pilot.post('/auth/login').send({email:tenants.pilot!.email,password:'Plano@12345'}).expect(200);
    await essential.post('/auth/login').send({email:tenants.essential!.email,password:'Plano@12345'}).expect(200);
    await pilot.get('/dashboard').expect(403);
    await pilot.get('/campaigns').expect(403);
    await pilot.get('/offers').expect(403);
    await pilot.get('/rewards').expect(200);
    await essential.get('/dashboard').expect(200);
    await essential.get('/offers').expect(200);
    await essential.get('/api-keys').expect(200);
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

  it('reserva a gestão multiunidade e a auditoria exportável ao plano Profissional',async()=>{
    const growth=request.agent(app),professional=request.agent(app);
    await growth.post('/auth/login').send({email:tenants.growth!.email,password:'Plano@12345'}).expect(200);
    await professional.post('/auth/login').send({email:tenants.professional!.email,password:'Plano@12345'}).expect(200);
    await growth.get('/units').expect(403).expect(({body})=>expect(body.code).toBe('PLAN_UPGRADE_REQUIRED'));
    await growth.get('/audit').expect(403).expect(({body})=>expect(body.code).toBe('PLAN_UPGRADE_REQUIRED'));
    await professional.get('/units').expect(200);
    await professional.post('/units').set('x-fideliza-request','web').send({name:'Filial Centro'}).expect(201);
    await professional.get('/audit').expect(200);
    await professional.get('/audit/export').expect(200).expect('content-type',/text\/csv/).expect(({text})=>expect(text).toContain('acao,tipo_entidade'));
  });

  it('aplica a franquia de armazenamento aos anexos do ambiente',async()=>{
    const pilot=request.agent(app);
    await pilot.post('/auth/login').send({email:tenants.pilot!.email,password:'Plano@12345'}).expect(200);
    db.prepare("UPDATE platform_plans SET storage_mb=0 WHERE code='pilot'").run();
    await pilot.put('/me/avatar').set('x-fideliza-request','web').send({image:'data:image/png;base64,iVBORw0KGgo='}).expect(409).expect(({body})=>expect(body.code).toBe('PLAN_STORAGE_LIMIT_REACHED'));
    db.prepare("UPDATE platform_plans SET storage_mb=250 WHERE code='pilot'").run();
  });
});
