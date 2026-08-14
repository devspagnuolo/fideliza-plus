import './database/migrate.js';
import { app } from './app.js';
import { config } from './config.js';
import { db } from './database/db.js';
import { startBackupSchedule, stopBackupSchedule } from './database/backup-schedule.js';
import { startWorker } from './worker.js';

const server = app.listen(config.port, () => console.log(`Fideliza+ API em http://localhost:${config.port}`));
const worker = startWorker();
const backupSchedule = startBackupSchedule();
function shutdown(signal: string) {
  console.log(`${signal}: encerrando com segurança`);
  if (worker) clearInterval(worker);
  stopBackupSchedule(backupSchedule);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
