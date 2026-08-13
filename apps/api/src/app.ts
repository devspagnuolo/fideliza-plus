import express from 'express';import cors from 'cors';import helmet from 'helmet';import cookieParser from 'cookie-parser';import { config } from './config.js';import { apiRoutes } from './routes/index.js';
export const app=express();
app.use(helmet());app.use(cors({origin:config.webOrigin,credentials:true}));app.use(express.json({limit:'2mb'}));app.use(express.text({type:['text/csv','application/csv'],limit:'5mb'}));app.use(cookieParser());
app.use((req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!req.path.endsWith('/auth/login')&&req.header('x-fideliza-request')!=='web')return res.status(403).json({error:'Origem da requisição inválida'});next();});
app.get('/health',(_req,res)=>res.json({status:'ok',version:'v1'}));
app.use('/api/v1',apiRoutes);app.use(apiRoutes);
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{console.error(err);res.status(500).json({error:'Não foi possível concluir a operação'});});
