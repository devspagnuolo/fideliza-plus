import type { NextFunction,Request,Response } from 'express';

const startedAt=Date.now();
let requests=0,errors=0,totalDurationMs=0;
const byStatus=new Map<number,number>();

export function observeRequest(req:Request,res:Response,next:NextFunction){
  const start=performance.now();requests++;
  res.on('finish',()=>{const duration=performance.now()-start;totalDurationMs+=duration;byStatus.set(res.statusCode,(byStatus.get(res.statusCode)??0)+1);if(res.statusCode>=500)errors++;});
  next();
}

export function runtimeMetrics(){return {startedAt:new Date(startedAt).toISOString(),uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),requests,errors,errorRate:requests?Number((errors/requests*100).toFixed(2)):0,averageResponseMs:requests?Number((totalDurationMs/requests).toFixed(2)):0,byStatus:Object.fromEntries(byStatus)};}
