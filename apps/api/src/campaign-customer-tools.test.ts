import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';

const databasePath=path.resolve(process.cwd(),`data/test-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='campaign-tools-test-secret-32-characters';
const { db }=await import('./database/db.js');
await import('./database/migrate.js');
const { hashPassword }=await import('./security.js');
const { app }=await import('./app.js');

describe('campanhas integradas e assistência ao consumidor',()=>{
  const agent=request.agent(app);
  beforeAll(async()=>{
    db.prepare("INSERT INTO tenants(id,name,slug)VALUES('campaign-tools','Loja Campanhas','loja-campanhas')").run();
    db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role)VALUES('campaign-owner','campaign-tools','Gestora','gestora@campanhas.test',?,'owner')").run(hashPassword('Gestora@123'));
    db.prepare("INSERT INTO customers(id,tenant_id,name,email,phone,cpf,enrolled_at,status)VALUES('campaign-customer','campaign-tools','Cliente Teste','cliente@campanhas.test','11999999999','52998224725',CURRENT_TIMESTAMP,'active')").run();
    db.prepare("INSERT INTO customer_accounts(id,tenant_id,customer_id,password_hash)VALUES('campaign-account','campaign-tools','campaign-customer',?)").run(hashPassword('Cliente@123'));
    await agent.post('/auth/login').send({email:'gestora@campanhas.test',password:'Gestora@123'}).expect(200);
  });
  afterAll(()=>{db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true});});

  it('oferece campanha de pontos vigente no teste A/B e cria comunicação vinculada',async()=>{
    const promotion=await agent.post('/loyalty/promotions').set('x-fideliza-request','web').send({name:'Semana em dobro',multiplier:2,startsAt:new Date(Date.now()-60_000).toISOString(),endsAt:new Date(Date.now()+86_400_000).toISOString()}).expect(201);
    const options=await agent.get('/campaigns/experiment-options').expect(200);
    expect(options.body).toContainEqual(expect.objectContaining({sourceId:promotion.body.id,name:'Semana em dobro',sourceType:'promotion'}));
    const experiment=await agent.post(`/loyalty/promotions/${promotion.body.id}/experiment`).set('x-fideliza-request','web').send({channel:'email',segment:'all',variantA:'Aproveite pontos em dobro hoje.',variantB:'Hoje suas compras valem o dobro de pontos.',windowDays:7}).expect(201);
    const campaign=db.prepare('SELECT audience_rule,variant_a_message,variant_b_message FROM campaigns WHERE id=?').get(experiment.body.campaignId)as any;
    expect(JSON.parse(campaign.audience_rule)).toMatchObject({sourcePromotionId:promotion.body.id,segment:'all'});
    expect(campaign.variant_a_message).toContain('dobro');
  });

  it('permite que a empresa dispare recuperação sem conhecer a senha',async()=>{
    const response=await agent.post('/crm/customers/campaign-customer/password-reset').set('x-fideliza-request','web').send({channel:'email'}).expect(202);
    expect(response.body.message).toContain('e-mail');
    expect(db.prepare("SELECT recipient,channel,status FROM outbound_messages WHERE tenant_id='campaign-tools' AND template='customer.password_reset'").get()).toEqual({recipient:'cliente@campanhas.test',channel:'email',status:'queued'});
    expect(db.prepare("SELECT delivery_channel,used_at FROM customer_password_reset_tokens WHERE account_id='campaign-account'").get()).toEqual({delivery_channel:'email',used_at:null});
  });
});
