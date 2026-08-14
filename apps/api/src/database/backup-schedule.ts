import { config } from '../config.js';
import { db } from './db.js';
import { createVerifiedBackup } from './backup-service.js';

export type BackupSchedule = ReturnType<typeof setInterval> | undefined;
export function startBackupSchedule(): BackupSchedule {
  if (!config.backup.enabled) return;
  let running = false;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const result = await createVerifiedBackup(db, config.backup.directory, config.backup.retentionDays, config.backup.maxFiles);
      console.log(`Backup automático verificado: ${result.path}`);
    } catch (error) { console.error('Falha no backup automático', error); }
    finally { running = false; }
  };
  void execute();
  return setInterval(execute, config.backup.intervalHours * 3_600_000);
}
export function stopBackupSchedule(schedule: BackupSchedule) { if (schedule) clearInterval(schedule); }
