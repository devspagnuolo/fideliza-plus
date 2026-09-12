import type { NextFunction, Request, Response } from 'express';
import { db } from './database/db.js';

const attempts = new Map<string,{count:number;resetAt:number}>();
function identity(req:Request,values?:unknown[]){
  const cpf=typeof req.body?.cpf==='string'?req.body.cpf.replace(/\D/g,''):req.body?.cpf;
  return (values??[req.body?.email,cpf,req.body?.tenantSlug]).filter(value=>typeof value==='string').join(':').trim().toLowerCase()||'unknown';
}
function keys(req:Request,values?:unknown[],path=req.path){const ip=req.ip??'unknown',route=path.toLowerCase(),subject=identity(req,values);return[`${ip}:${route}:${subject}`,`${ip}:${route}:*`,`*:${route}:${subject}`];}
function configuredLimit(){try{const row=db.prepare("SELECT value FROM global_settings WHERE key='security.lock_attempts'").get()as{value:string}|undefined,value=Number(row?.value||5);return Number.isInteger(value)?Math.min(10,Math.max(3,value)):5}catch{return 5}}
export function loginRateLimit(req:Request,res:Response,next:NextFunction) {
  const now=Date.now(),requestKeys=keys(req),limit=configuredLimit(),blocked=requestKeys.map(requestKey=>attempts.get(requestKey)).find(current=>current&&current.resetAt>now&&current.count>=limit);
  if(attempts.size>10_000)for(const [storedKey,value] of attempts)if(value.resetAt<=now)attempts.delete(storedKey);
  if(blocked){const retryAfter=Math.max(1,Math.ceil((blocked.resetAt-now)/1000));res.setHeader('Retry-After',String(retryAfter));return res.status(429).json({error:'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',retryAfterSeconds:retryAfter});}
  for(const requestKey of requestKeys){const current=attempts.get(requestKey);if(!current||current.resetAt<=now)attempts.set(requestKey,{count:1,resetAt:now+15*60_000});else current.count+=1;}
  next();
}
export function clearLoginRateLimit(req:Request,values?:unknown[],path=req.path){for(const requestKey of keys(req,values,path))attempts.delete(requestKey);}
