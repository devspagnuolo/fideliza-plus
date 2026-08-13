import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './database/db.js';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import { hashToken, newToken, verifyPassword } from './security.js';

export const app = express();
app.use(helmet()); app.use(cors({ origin: config.webOrigin, credentials: true })); app.use(express.json({ limit: '2mb' })); app.use(cookieParser());
app.get('/health', (_req,res) => res.json({ status:'ok' }));

app.post('/auth/login', (req,res) => {
  const parsed = z.object({email:z.string().email(),password:z.string().min(8)}).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:'Dados inválidos'});
  const user = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1').get(parsed.data.email) as any;
  if (!user || !verifyPassword(parsed.data.password,user.password_hash)) return res.status(401).json({error:'E-mail ou senha inválidos'});
  const token=newToken(); const expires=new Date(Date.now()+7*86400000);
  db.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(randomUUID(),user.id,hashToken(token),expires.toISOString());
  res.cookie('fideliza_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',expires});
  res.json({user:{name:user.name,role:user.role}});
});
app.post('/auth/logout',requireAuth,(req,res)=>{ const token=req.cookies.fideliza_session; db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); res.clearCookie('fideliza_session'); res.status(204).end(); });
app.get('/me',requireAuth,(req,res)=>res.json(req.auth));

app.get('/dashboard',requireAuth,(req,res)=>{
  const t=req.auth!.tenantId;
  const stats=db.prepare(`SELECT (SELECT COUNT(*) FROM customers WHERE tenant_id=?) customers, (SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE tenant_id=? AND occurred_at >= datetime('now','-30 days')) revenueCents, (SELECT COUNT(*) FROM sales WHERE tenant_id=? AND occurred_at >= datetime('now','-30 days')) sales`).get(t,t,t) as any;
  const inactive=db.prepare(`SELECT COUNT(*) total FROM customers c WHERE c.tenant_id=? AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id=c.id AND s.occurred_at >= datetime('now','-45 days'))`).get(t) as any;
  const recommendations=[];
  if(inactive.total>0) recommendations.push({title:'Reative clientes inativos',description:`${inactive.total} clientes estão sem comprar há 45 dias. Crie uma campanha de retorno.`,impact:'Alto'});
  if(stats.customers<20) recommendations.push({title:'Amplie sua base identificada',description:'Cadastre o cliente no caixa para transformar vendas anônimas em relacionamento.',impact:'Médio'});
  res.json({...stats,averageTicketCents:stats.sales?Math.round(stats.revenueCents/stats.sales):0,recommendations});
});
app.get('/customers',requireAuth,(req,res)=>res.json(db.prepare('SELECT * FROM customers WHERE tenant_id=? ORDER BY created_at DESC').all(req.auth!.tenantId)));
app.post('/customers',requireAuth,(req,res)=>{
  const p=z.object({name:z.string().min(2),email:z.string().email().optional().or(z.literal('')),phone:z.string().optional()}).safeParse(req.body); if(!p.success)return res.status(400).json({error:'Cliente inválido'});
  const id=randomUUID(); db.prepare('INSERT INTO customers (id,tenant_id,name,email,phone) VALUES (?,?,?,?,?)').run(id,req.auth!.tenantId,p.data.name,p.data.email||null,p.data.phone||null); res.status(201).json({id,...p.data});
});
app.get('/sales',requireAuth,(req,res)=>res.json(db.prepare(`SELECT s.*,c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.tenant_id=? ORDER BY occurred_at DESC LIMIT 100`).all(req.auth!.tenantId)));
app.post('/sales',requireAuth,(req,res)=>{
  const p=z.object({customerId:z.string().optional(),totalCents:z.number().int().positive(),occurredAt:z.string().datetime().optional()}).safeParse(req.body); if(!p.success)return res.status(400).json({error:'Venda inválida'});
  const tenant=req.auth!.tenantId; const saleId=randomUUID(); const tenantRow=db.prepare('SELECT points_per_real FROM tenants WHERE id=?').get(tenant) as any; const points=Math.floor((p.data.totalCents/100)*tenantRow.points_per_real);
  db.transaction(()=>{ db.prepare('INSERT INTO sales (id,tenant_id,customer_id,total_cents,occurred_at) VALUES (?,?,?,?,?)').run(saleId,tenant,p.data.customerId||null,p.data.totalCents,p.data.occurredAt||new Date().toISOString()); if(p.data.customerId){ const customer=db.prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?').get(p.data.customerId,tenant); if(!customer) throw new Error('Cliente não pertence à empresa'); db.prepare('INSERT INTO loyalty_ledger (id,tenant_id,customer_id,sale_id,points,reason) VALUES (?,?,?,?,?,?)').run(randomUUID(),tenant,p.data.customerId,saleId,points,'Pontos por compra'); db.prepare('UPDATE customers SET points_balance=points_balance+? WHERE id=? AND tenant_id=?').run(points,p.data.customerId,tenant); } })(); res.status(201).json({id:saleId,points});
});
app.get('/campaigns',requireAuth,(req,res)=>res.json(db.prepare('SELECT * FROM campaigns WHERE tenant_id=? ORDER BY created_at DESC').all(req.auth!.tenantId)));
app.post('/campaigns',requireAuth,(req,res)=>{const p=z.object({name:z.string().min(3),channel:z.enum(['whatsapp','email','sms']).default('whatsapp')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Campanha inválida'});const id=randomUUID();db.prepare('INSERT INTO campaigns (id,tenant_id,name,channel) VALUES (?,?,?,?)').run(id,req.auth!.tenantId,p.data.name,p.data.channel);res.status(201).json({id,...p.data,status:'draft'});});
app.use((err:any,_req:any,res:any,_next:any)=>{console.error(err);res.status(500).json({error:'Não foi possível concluir a operação'});});
