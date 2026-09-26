import './database/migrate.js';
import { db } from './database/db.js';
import { startWorker } from './worker.js';

const worker = startWorker();
if (!worker) throw new Error('WORKER_ENABLED=false impede a inicializacao do worker dedicado');
console.log('Fidelizei worker dedicado iniciado');

function shutdown(signal: string) {
  console.log(`${signal}: encerrando worker com seguranca`);
  clearInterval(worker);
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
