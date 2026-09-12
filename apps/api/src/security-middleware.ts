import { randomUUID } from 'node:crypto';
import type { NextFunction,Request,Response } from 'express';
import { config } from './config.js';
import { recordSecurityEvent } from './security-events.js';

const unsafe=new Set(['POST','PUT','PATCH','DELETE']);
const webhookPaths=new Set(['/webhooks/bling','/webhooks/asaas','/api/v1/webhooks/asaas']);

export function securityEnvelope(req:Request,res:Response,next:NextFunction){
  const requestId=String(req.header('x-request-id')||randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||randomUUID();
  res.setHeader('X-Request-Id',requestId);res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');res.setHeader('X-Permitted-Cross-Domain-Policies','none');
  if(/^\/(auth|customer\/auth|platform|me|customers|sales|finance|integrations|jobs|audit)/.test(req.path))res.setHeader('Cache-Control','no-store, max-age=0');
  if(['TRACE','TRACK','CONNECT'].includes(req.method)){recordSecurityEvent(req,{eventType:'prohibited_http_method',severity:'medium',reason:`Método ${req.method} bloqueado`});return res.status(405).json({error:'Método não permitido'})}
  if(config.isProduction&&req.header('x-forwarded-proto')&&req.header('x-forwarded-proto')!=='https')return res.status(426).json({error:'HTTPS obrigatório'});
  if(unsafe.has(req.method)&&!webhookPaths.has(req.path)){
    const origin=req.header('origin'),fetchSite=req.header('sec-fetch-site');
    if(origin&&!config.webOrigins.includes(origin)){recordSecurityEvent(req,{eventType:'cross_origin_mutation',severity:'high',reason:'Origem não autorizada',metadata:{origin,path:req.path}});return res.status(403).json({error:'Origem da requisição inválida'})}
    if(fetchSite==='cross-site'){recordSecurityEvent(req,{eventType:'cross_site_mutation',severity:'high',reason:'Requisição cross-site bloqueada',metadata:{origin,path:req.path}});return res.status(403).json({error:'Origem da requisição inválida'})}
  }
  next();
}

export function credentialPayloadGuard(req:Request,res:Response,next:NextFunction){
  const candidates=[req.body?.password,req.body?.newPassword,req.body?.currentPassword,req.body?.temporaryPassword];
  if(candidates.some(value=>typeof value==='string'&&value.length>128)){recordSecurityEvent(req,{eventType:'oversized_credential_payload',severity:'medium',reason:'Credencial acima do limite seguro',metadata:{path:req.path}});return res.status(413).json({error:'Credencial acima do tamanho permitido'})}
  next();
}
