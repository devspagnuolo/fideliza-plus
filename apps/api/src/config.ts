import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 3333),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/fideliza.db'),
  sessionSecret: process.env.SESSION_SECRET ?? 'local-development-secret-change-me-please'
};
