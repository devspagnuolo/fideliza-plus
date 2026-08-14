import { config } from '../config.js';
import { db } from './db.js';
import { createVerifiedBackup } from './backup-service.js';

const summary = await createVerifiedBackup(db, config.backup.directory, config.backup.retentionDays, config.backup.maxFiles);
console.log(`Backup verificado: ${summary.path} (${summary.sizeBytes} bytes, ${summary.tenants} empresas)`);
db.close();
