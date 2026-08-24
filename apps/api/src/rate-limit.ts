import type { NextFunction, Request, Response } from 'express';

const attempts = new Map<string,{count:number;resetAt:number}>();
function identity(req:Request,values?:unknown[]){
  const cpf=typeof req.body?.cpf==='string'?req.body.cpf.replace(/\D/g,''):req.body?.cpf;
  return (values??[req.body?.email,cpf,req.body?.tenantSlug]).filter(value=>typeof value==='string').join(':').trim().toLowerCase()||'unknown';
}
function key(req:Request,values?:unknown[],path=req.path){return `${req.ip??'unknown'}:${path.toLowerCase()}:${identity(req,values)}`;}
export function loginRateLimit(req:Request,res:Response,next:NextFunction) {
  const requestKey=key(req); const now=Date.now(); const current=attempts.get(requestKey);
  if(attempts.size>5_000)for(const [storedKey,value] of attempts)if(value.resetAt<now)attempts.delete(storedKey);
  if(!current||current.resetAt<now){attempts.set(requestKey,{count:1,resetAt:now+15*60_000});return next();}
  if(current.count>=10)return res.status(429).json({error:'Muitas tentativas. Tente novamente em alguns minutos.'});
  current.count+=1; next();
}
export function clearLoginRateLimit(req:Request,values?:unknown[],path=req.path){attempts.delete(key(req,values,path));}
