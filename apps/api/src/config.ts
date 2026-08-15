import 'dotenv/config';
import path from 'node:path';
import { validateProductionEnvironment } from './production-config.js';

const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET ?? 'local-development-secret-change-me-please';
validateProductionEnvironment(process.env);
const databasePath = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/fideliza.db');

export const config = {
  port: Number(process.env.PORT ?? 3333),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean),
  databasePath,
  sessionSecret,
  isProduction,
  backup: {
    enabled: process.env.AUTO_BACKUP_ENABLED === 'true',
    directory: path.resolve(process.cwd(), process.env.BACKUP_DIRECTORY ?? path.join(path.dirname(databasePath), 'backups')),
    intervalHours: Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS ?? 24)),
    retentionDays: Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS ?? 30)),
    maxFiles: Math.max(1, Number(process.env.BACKUP_MAX_FILES ?? 30))
  }
};
