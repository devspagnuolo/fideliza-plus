import './database/migrate.js';
import { app } from './app.js';
import { config } from './config.js';
import { db } from './database/db.js';
import { startBackupSchedule, stopBackupSchedule } from './database/backup-schedule.js';
import { startWorker } from './worker.js';
import { startAutomationSchedule } from './automation-schedule.js';

if (!config.isProduction || process.env.SEED_DEMO_DATA === 'true') {
  await import('./database/seed.js');
}

const server = app.listen(config.port, () => console.log(`Fideliza+ API em http://localhost:${config.port}`));
const worker = startWorker();
const backupSchedule = startBackupSchedule();
const automationSchedule = startAutomationSchedule();
function shutdown(signal: string) {
  console.log(`${signal}: encerrando com segurança`);
  if (worker) clearInterval(worker);
  stopBackupSchedule(backupSchedule);
  if (automationSchedule) clearInterval(automationSchedule);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
