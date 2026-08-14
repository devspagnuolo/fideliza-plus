import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

const backupPattern = /^fideliza-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/;
export type BackupSummary = { path: string; sizeBytes: number; tenants: number; customers: number; sales: number };

export function verifyBackup(filePath: string): BackupSummary {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`Backup não encontrado: ${resolved}`);
  const database = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma('quick_check') as { quick_check: string }[];
    if (integrity[0]?.quick_check !== 'ok') throw new Error('Falha na verificação de integridade do backup');
    const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(({ name }) => name));
    for (const table of ['tenants', 'customers', 'sales', 'users']) if (!tables.has(table)) throw new Error(`Backup incompleto: tabela ${table} ausente`);
    const count = (table: string) => (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
    return { path: resolved, sizeBytes: fs.statSync(resolved).size, tenants: count('tenants'), customers: count('customers'), sales: count('sales') };
  } finally { database.close(); }
}

export function applyBackupRetention(directory: string, retentionDays: number, maxFiles: number, now = Date.now()) {
  if (!fs.existsSync(directory)) return [];
  const cutoff = now - retentionDays * 86_400_000;
  const files = fs.readdirSync(directory).filter((name) => backupPattern.test(name)).map((name) => ({ path: path.join(directory, name), modified: fs.statSync(path.join(directory, name)).mtimeMs })).sort((a, b) => b.modified - a.modified);
  const removed: string[] = [];
  for (const [index, file] of files.entries()) if (file.modified < cutoff || index >= maxFiles) { fs.rmSync(file.path); removed.push(file.path); }
  return removed;
}

export async function createVerifiedBackup(database: BetterSqlite3.Database, directory: string, retentionDays = 30, maxFiles = 30) {
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `fideliza-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await database.backup(destination);
  const summary = verifyBackup(destination);
  applyBackupRetention(directory, retentionDays, maxFiles);
  return summary;
}
