import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/staff-recovery-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='staff-recovery-test-secret-32-characters';
process.env.WHATSAPP_ACCESS_TOKEN='test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID='123456789';
process.env.WHATSAPP_PASSWORD_RESET_TEMPLATE='fideliza_password_reset';
const{db}=await import('./database/db.js');
await import('./database/migrate.js');
const{hashPassword}=await import('./security.js');
const{app}=await import('./app.js');

describe('recuperação de usuário da empresa por WhatsApp',()=>{
  beforeAll(()=>{
    db.prepare('INSERT INTO tenants(id,name,slug)VALUES(?,?,?)').run('staff-tenant','Loja Equipe','loja-equipe');
    db.prepare("INSERT INTO users(id,tenant_id,name,email,phone,password_hash,role)VALUES(?,?,?,?,?,?,'owner')").run('staff-owner','staff-tenant','Gestora','gestora@loja.test','11987654321',hashPassword('SenhaAntiga123'));
  });
  afterAll(()=>{db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true})});
  it('expõe o canal, valida celular e troca a senha com OTP de uso único',async()=>{
    expect((await request(app).get('/auth/recovery-channels').expect(200)).body.channels).toContain('whatsapp');
    const existing=request.agent(app);
    await existing.post('/auth/login').send({email:'gestora@loja.test',password:'SenhaAntiga123'}).expect(200);
    const requested=await request(app).post('/auth/forgot-password').send({email:'gestora@loja.test',channel:'whatsapp',phone:'(11) 98765-4321',consentWhatsApp:true}).expect(202);
    expect(requested.body).toMatchObject({channel:'whatsapp',developmentToken:expect.stringMatching(/^\d{6}$/)});
    expect(db.prepare("SELECT channel,recipient,status FROM outbound_messages WHERE template='user.password_reset_otp'").get()).toEqual({channel:'whatsapp',recipient:'11987654321',status:'queued'});
    await request(app).post('/auth/reset-password-code').send({email:'gestora@loja.test',phone:'11987654321',code:'000000',password:'SenhaNova123'}).expect(400);
    await request(app).post('/auth/reset-password-code').send({email:'gestora@loja.test',phone:'11987654321',code:requested.body.developmentToken,password:'SenhaNova123'}).expect(204);
    await existing.get('/me').expect(401);
    await request(app).post('/auth/login').send({email:'gestora@loja.test',password:'SenhaAntiga123'}).expect(401);
    await request(app).post('/auth/login').send({email:'gestora@loja.test',password:'SenhaNova123'}).expect(200);
    await request(app).post('/auth/reset-password-code').send({email:'gestora@loja.test',phone:'11987654321',code:requested.body.developmentToken,password:'OutraSenha123'}).expect(400);
  });
  it('não revela se e-mail ou telefone não correspondem',async()=>{
    const response=await request(app).post('/auth/forgot-password').send({email:'gestora@loja.test',channel:'whatsapp',phone:'11900000000',consentWhatsApp:true}).expect(202);
    expect(response.body).toEqual({message:'Se os dados estiverem cadastrados, enviaremos as instruções.',channel:'whatsapp'});
  });
});
