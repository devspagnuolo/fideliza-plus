import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../database/db.js';
import { requireAuth } from '../auth.js';
import { hashToken,newToken,verifyPassword } from '../security.js';
import { loginRateLimit } from '../rate-limit.js';

export const authRoutes=Router();
authRoutes.post('/auth/login',loginRateLimit,(req,res)=>{const parsed=z.object({email:z.string().email(),password:z.string().min(8)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Dados inválidos'});const user=db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1').get(parsed.data.email) as any;if(!user||!verifyPassword(parsed.data.password,user.password_hash))return res.status(401).json({error:'E-mail ou senha inválidos'});const token=newToken();const expires=new Date(Date.now()+7*86400000);db.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(randomUUID(),user.id,hashToken(token),expires.toISOString());res.cookie('fideliza_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',expires});res.json({user:{name:user.name,role:user.role}});});
authRoutes.post('/auth/logout',requireAuth,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(req.cookies.fideliza_session));res.clearCookie('fideliza_session');res.status(204).end();});
authRoutes.get('/me',requireAuth,(req,res)=>res.json(req.auth));
