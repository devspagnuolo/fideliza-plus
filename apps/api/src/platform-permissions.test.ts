import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';

const databasePath=path.resolve(process.cwd(),`data/platform-permissions-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='platform-permissions-secret-32-chars';
process.env.PLATFORM_ADMIN_NAME='Dono da Plataforma';
process.env.PLATFORM_ADMIN_EMAIL='root@fideliza.test';
process.env.PLATFORM_ADMIN_PASSWORD='Plataforma@123';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {app}=await import('./app.js');
const {platformAdminRoutes}=await import('./routes/platform-admin.routes.js');
const {asaasRoutes}=await import('./routes/asaas.routes.js');
const {portalRoutes}=await import('./routes/portal.routes.js');

const password='Equipe@Segura123';
async function loginAs(email:string){const agent=request.agent(app);await agent.post('/platform/auth/login').set('x-fideliza-request','web').send({email,password}).expect(200);return agent}

describe('permissões por papel da equipe da plataforma',()=>{
 const root=request.agent(app);
 const ids:Record<string,string>={};
 beforeAll(async()=>{
  await root.post('/platform/auth/login').set('x-fideliza-request','web').send({email:process.env.PLATFORM_ADMIN_EMAIL,password:process.env.PLATFORM_ADMIN_PASSWORD}).expect(200);
  for(const role of['finance','support','operations','viewer']){const created=await root.post('/platform/admins').set('x-fideliza-request','web').send({name:`Equipe ${role}`,email:`${role}@fideliza.test`,role,password}).expect(201);expect(created.body).toMatchObject({role,active:1});ids[role]=created.body.id}
 });
 afterAll(()=>{db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true})});

 it('exige uma permissão explícita em toda rota administrativa da plataforma',()=>{
  const unguarded:string[]=[];let checked=0;
  for(const router of[platformAdminRoutes,asaasRoutes,portalRoutes])for(const layer of(router as any).stack){const route=layer.route;if(!route||!String(route.path).startsWith('/platform/')||/^\/platform\/(auth|me)(\/|$)/.test(route.path))continue;checked++;if(!route.stack.some((s:any)=>s.handle?.platformPermission))unguarded.push(`${Object.keys(route.methods).join(',')} ${route.path}`)}
  expect(checked).toBeGreaterThan(90);expect(unguarded).toEqual([]);
 });

 it('informa papel e permissões efetivas no /platform/me',async()=>{
  const me=(await root.get('/platform/me').expect(200)).body;expect(me.role).toBe('super_admin');expect(me.permissions).toContain('admins.manage');
  const finance=await loginAs('finance@fideliza.test'),body=(await finance.get('/platform/me').expect(200)).body;
  expect(body).toMatchObject({role:'finance',roleLabel:'Financeiro'});expect(body.permissions).toEqual(expect.arrayContaining(['platform.read','billing.manage']));expect(body.permissions).not.toContain('companies.manage');
 });

 it('libera leitura a todos e bloqueia ações fora do papel',async()=>{
  const viewer=await loginAs('viewer@fideliza.test');
  await viewer.get('/platform/dashboard').expect(200);await viewer.get('/platform/finance/overview').expect(200);
  const denied=await viewer.post('/platform/finance/coupons').set('x-fideliza-request','web').send({code:'X10',description:'Teste',discountType:'percent',discountValue:10}).expect(403);
  expect(denied.body).toMatchObject({code:'PLATFORM_PERMISSION_DENIED',permission:'billing.manage'});
  await viewer.get('/platform/system').expect(403);await viewer.get('/platform/reports/export').expect(403);await viewer.get('/platform/admins').expect(403);
  const finance=await loginAs('finance@fideliza.test');
  await finance.post('/platform/finance/coupons').set('x-fideliza-request','web').send({code:'FIN10',description:'Cupom do financeiro',discountType:'percent',discountValue:10,maxUses:5}).expect(201);
  await finance.get('/platform/reports/export').expect(200);
  await finance.patch('/platform/settings').set('x-fideliza-request','web').send({'security.mfa_admin':'false'}).expect(403);
  await finance.post('/platform/companies/qualquer/homologation-reset').set('x-fideliza-request','web').send({}).expect(403);
  const operations=await loginAs('operations@fideliza.test');
  await operations.get('/platform/system').expect(200);await operations.post('/platform/billing/run').set('x-fideliza-request','web').expect(403);
 });

 it('aplica a permissão da área nos registros genéricos dos módulos',async()=>{
  const support=await loginAs('support@fideliza.test'),record={title:'Registro de teste',payload:{}};
  await support.post('/platform/modules/support/kb').set('x-fideliza-request','web').send(record).expect(201);
  await support.post('/platform/modules/settings/branding').set('x-fideliza-request','web').send(record).expect(403);
  await support.post('/platform/modules/desconhecido/area').set('x-fideliza-request','web').send(record).expect(403);
 });

 it('deixa o super admin ajustar a matriz sem conceder o que é reservado',async()=>{
  const finance=await loginAs('finance@fideliza.test');
  await root.patch('/platform/permissions/finance/billing.manage').set('x-fideliza-request','web').send({enabled:false}).expect(204);
  await finance.post('/platform/finance/coupons').set('x-fideliza-request','web').send({code:'FIN20',description:'Bloqueado',discountType:'percent',discountValue:20}).expect(403);
  await root.patch('/platform/permissions/finance/billing.manage').set('x-fideliza-request','web').send({enabled:true}).expect(204);
  await root.patch('/platform/permissions/finance/admins.manage').set('x-fideliza-request','web').send({enabled:true}).expect(400);
  await root.patch('/platform/permissions/super_admin/platform.read').set('x-fideliza-request','web').send({enabled:false}).expect(400);
  await finance.patch('/platform/permissions/finance/companies.manage').set('x-fideliza-request','web').send({enabled:true}).expect(403);
  expect(db.prepare("SELECT action FROM platform_audit_logs WHERE action='permission.update'").all()).toHaveLength(2);
 });

 it('protege a equipe: sem autoalteração, sempre um super admin e sessões revogadas na troca de papel',async()=>{
  const rootId=(await root.get('/platform/me').expect(200)).body.adminId;
  await root.patch(`/platform/admins/${rootId}`).set('x-fideliza-request','web').send({role:'viewer'}).expect(400);
  await root.patch(`/platform/admins/${rootId}`).set('x-fideliza-request','web').send({active:false}).expect(400);
  await root.post('/platform/admins').set('x-fideliza-request','web').send({name:'Duplicado',email:'FINANCE@fideliza.test',role:'viewer',password}).expect(409);
  await root.post('/platform/admins').set('x-fideliza-request','web').send({name:'Fraca',email:'fraca@fideliza.test',role:'viewer',password:'curta'}).expect(400);
  await root.post('/platform/admins').set('x-fideliza-request','web').send({name:'Inventado',email:'inventado@fideliza.test',role:'god',password}).expect(400);

  const viewer=await loginAs('viewer@fideliza.test');
  await root.patch(`/platform/admins/${ids.viewer}`).set('x-fideliza-request','web').send({role:'super_admin'}).expect(200);
  await viewer.get('/platform/dashboard').expect(401);
  const promoted=await loginAs('viewer@fideliza.test');
  await promoted.patch(`/platform/admins/${rootId}`).set('x-fideliza-request','web').send({active:false}).expect(200);
  await root.get('/platform/dashboard').expect(401);
  await promoted.patch(`/platform/admins/${ids.viewer}`).set('x-fideliza-request','web').send({role:'viewer'}).expect(400);
  db.prepare("UPDATE platform_admins SET active=1 WHERE id=?").run(rootId);
  const list=(await promoted.get('/platform/admins').expect(200)).body;expect(list.some((a:any)=>'password_hash'in a||'passwordHash'in a)).toBe(false);
  expect(db.prepare("SELECT COUNT(*) total FROM platform_audit_logs WHERE action LIKE 'platform_admin.%'").get()).toEqual({total:6});
 });

 it('nega tudo a um papel desconhecido gravado no banco',async()=>{
  db.prepare("UPDATE platform_admins SET role='legacy' WHERE id=?").run(ids.support);
  const legacy=await loginAs('support@fideliza.test');
  await legacy.get('/platform/dashboard').expect(403);expect((await legacy.get('/platform/me').expect(200)).body.permissions).toEqual([]);
 });
});
