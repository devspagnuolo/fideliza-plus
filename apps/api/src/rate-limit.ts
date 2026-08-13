import type { NextFunction, Request, Response } from 'express';

const attempts = new Map<string,{count:number;resetAt:number}>();
export function loginRateLimit(req:Request,res:Response,next:NextFunction) {
  const key=req.ip??'unknown'; const now=Date.now(); const current=attempts.get(key);
  if(!current||current.resetAt<now){attempts.set(key,{count:1,resetAt:now+15*60_000});return next();}
  if(current.count>=10)return res.status(429).json({error:'Muitas tentativas. Tente novamente em alguns minutos.'});
  current.count+=1; next();
}
