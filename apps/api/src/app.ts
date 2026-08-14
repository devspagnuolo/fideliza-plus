import express from 'express';import cors from 'cors';import helmet from 'helmet';import cookieParser from 'cookie-parser';import { config } from './config.js';import { apiRoutes } from './routes/index.js';
import { db } from './database/db.js';import { observeRequest,runtimeMetrics } from './observability.js';
export const app=express();
app.use(observeRequest);app.use(helmet());app.use(cors({origin:config.webOrigin,credentials:true}));app.use(express.json({limit:'2mb',verify:(req,_res,buffer)=>{(req as express.Request&{rawBody?:Buffer}).rawBody=Buffer.from(buffer);}}));app.use(express.text({type:['text/csv','application/csv'],limit:'5mb'}));app.use(cookieParser());
app.use((req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!req.path.endsWith('/auth/login')&&req.path!=='/webhooks/bling'&&req.header('x-fideliza-request')!=='web')return res.status(403).json({error:'Origem da requisição inválida'});next();});
app.get('/health',(_req,res)=>res.json({status:'ok',version:'v1',uptimeSeconds:runtimeMetrics().uptimeSeconds}));
app.get('/ready',(_req,res)=>{try{db.prepare('SELECT 1').get();res.json({status:'ready',database:'ok'});}catch{res.status(503).json({status:'unavailable',database:'error'});}});
app.use('/api/v1',apiRoutes);app.use(apiRoutes);
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{console.error(err);res.status(500).json({error:'Não foi possível concluir a operação'});});
