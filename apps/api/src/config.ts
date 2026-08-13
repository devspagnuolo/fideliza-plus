import 'dotenv/config';
import path from 'node:path';

const isProduction=process.env.NODE_ENV==='production';
const sessionSecret=process.env.SESSION_SECRET ?? 'local-development-secret-change-me-please';
if(isProduction&&sessionSecret.length<32)throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres em produção');

export const config = {
  port: Number(process.env.PORT ?? 3333),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/fideliza.db'),
  sessionSecret,
  isProduction
};
