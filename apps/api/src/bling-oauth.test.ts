import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath=path.resolve(process.cwd(),`data/test-bling-oauth-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='bling-oauth-test-secret-with-32-characters';
process.env.WEB_ORIGIN='https://app.fideliza.test,https://www.fideliza.test';process.env.BLING_CLIENT_ID='client-id';process.env.BLING_CLIENT_SECRET='client-secret';
const { db }=await import('./database/db.js');
await import('./database/migrate.js');
const { hashPassword }=await import('./security.js');
const { encryptSecret }=await import('./bling.js');
const { syncBling,resetBlingCompanyRetry }=await import('./bling-sync.js');
const { app }=await import('./app.js');

// Cada código de autorização devolve um token; cada token pertence a uma conta Bling.
const companyByToken=new Map<string,string>();
vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/oauth/token')){const code=new URLSearchParams(String(init?.body)).get('code')!;return Response.json({access_token:`access-${code}`,refresh_token:`refresh-${code}`,expires_in:3600});}
  if(url.pathname.endsWith('/empresas/me/dados-basicos')){const token=String(new Headers(init?.headers).get('authorization')).replace('Bearer ','');const id=companyByToken.get(token);return id?Response.json({data:{id,nome:'Conta Bling'}}):Response.json({error:{message:'invalid_token'}},{status:401});}
  return Response.json({data:[]});
}));

async function ownerOf(tenant:string){
  db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run(tenant,`Loja ${tenant}`,tenant);
  db.prepare('INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run(`owner-${tenant}`,tenant,'Dona',`${tenant}@example.com`,hashPassword('Senha@123'),'owner');
  const agent=request.agent(app);await agent.post('/auth/login').send({email:`${tenant}@example.com`,password:'Senha@123'}).expect(200);return agent;
}
async function connect(agent:ReturnType<typeof request.agent>,code:string,company:string){
  companyByToken.set(`access-${code}`,company);
  const authorize=await agent.post('/integrations/bling/authorize').set('x-fideliza-request','web').send({}).expect(200);
  const state=new URL(authorize.body.url).searchParams.get('state')!;
  return agent.get('/integrations/bling/callback').query({code,state}).expect(302);
}
const companyOf=(tenant:string)=>(db.prepare("SELECT external_company_id FROM integration_connections WHERE tenant_id=? AND provider='bling'").get(tenant) as {external_company_id:string|null}|undefined)?.external_company_id;

describe('vínculo da conta Bling no OAuth',()=>{
  let alpha:ReturnType<typeof request.agent>,beta:ReturnType<typeof request.agent>;
  beforeAll(async()=>{alpha=await ownerOf('alpha');beta=await ownerOf('beta');});
  afterAll(()=>{vi.unstubAllGlobals();db.close();for(const suffix of ['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true});});

  it('grava o companyId da conta autorizada junto com os tokens',async()=>{
    const response=await connect(alpha,'code-alpha','company-alpha');
    expect(response.headers.location).toBe('https://app.fideliza.test/?bling=connected');
    expect(companyOf('alpha')).toBe('company-alpha');
  });

  it('recusa ligar a mesma conta Bling a outra empresa e descarta os tokens',async()=>{
    const response=await connect(beta,'code-beta','company-alpha');
    expect(response.headers.location).toMatch(/\?bling=company_in_use$/);
    expect(db.prepare("SELECT 1 FROM integration_connections WHERE tenant_id='beta'").get()).toBeUndefined();
    expect(companyOf('alpha')).toBe('company-alpha');
    expect(db.prepare("SELECT action FROM audit_logs WHERE tenant_id='beta' ORDER BY rowid DESC LIMIT 1").get()).toEqual({action:'connect_rejected'});
  });

  it('troca o vínculo quando a empresa reconecta com outra conta Bling',async()=>{
    await connect(alpha,'code-alpha-2','company-alpha-new');
    expect(companyOf('alpha')).toBe('company-alpha-new');
    const response=await connect(beta,'code-beta-2','company-alpha');
    expect(response.headers.location).toMatch(/\?bling=connected$/);
    expect(companyOf('beta')).toBe('company-alpha');
  });

  it('rejeita o callback quando o Bling não informa a conta, com aviso em vez de erro 500',async()=>{
    const agent=await ownerOf('gamma');
    const authorize=await agent.post('/integrations/bling/authorize').set('x-fideliza-request','web').send({}).expect(200);
    const state=new URL(authorize.body.url).searchParams.get('state')!;
    const response=await agent.get('/integrations/bling/callback').query({code:'code-unknown',state}).expect(302);
    expect(response.headers.location).toMatch(/\?bling=account_unavailable$/);
    expect(db.prepare("SELECT 1 FROM integration_connections WHERE tenant_id='gamma'").get()).toBeUndefined();
    expect(db.prepare("SELECT action FROM audit_logs WHERE tenant_id='gamma' ORDER BY rowid DESC LIMIT 1").get()).toEqual({action:'connect_rejected'});
  });

  it('a sincronização identifica conexões antigas sem roubar contas de outra empresa',async()=>{
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('legacy','Loja antiga','legacy');
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('legacy-dup','Loja duplicada','legacy-dup');
    const insert=db.prepare('INSERT INTO integration_connections (id,tenant_id,provider,access_token_encrypted,refresh_token_encrypted,expires_at) VALUES (?,?,?,?,?,?)'),expires=new Date(Date.now()+3_600_000).toISOString();
    insert.run('legacy-connection','legacy','bling',encryptSecret('access-legacy'),encryptSecret('refresh-legacy'),expires);
    insert.run('legacy-dup-connection','legacy-dup','bling',encryptSecret('access-legacy-dup'),encryptSecret('refresh-legacy-dup'),expires);
    companyByToken.set('access-legacy','company-legacy');companyByToken.set('access-legacy-dup','company-alpha');
    await syncBling('legacy','manual');await syncBling('legacy-dup','manual');
    expect(companyOf('legacy')).toBe('company-legacy');
    expect(companyOf('legacy-dup')).toBeNull();
    expect(companyOf('beta')).toBe('company-alpha');
  });

  it('espera cada vez mais antes de perguntar de novo a conta quando o Bling recusa',async()=>{
    resetBlingCompanyRetry();
    db.prepare('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)').run('refused','Loja sem escopo','refused');
    db.prepare('INSERT INTO integration_connections (id,tenant_id,provider,access_token_encrypted,refresh_token_encrypted,expires_at) VALUES (?,?,?,?,?,?)').run('refused-connection','refused','bling',encryptSecret('access-refused'),encryptSecret('refresh-refused'),new Date(Date.now()+3_600_000).toISOString());
    const companyCalls=()=>vi.mocked(fetch).mock.calls.filter(([input,init])=>String(input).endsWith('/empresas/me/dados-basicos')&&new Headers(init?.headers).get('authorization')==='Bearer access-refused').length;
    await syncBling('refused','manual');
    expect(companyCalls()).toBe(1);
    await syncBling('refused','manual');
    expect(companyCalls()).toBe(1);
    expect(companyOf('refused')).toBeNull();
  });
});
