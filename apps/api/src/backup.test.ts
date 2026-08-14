import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBackupRetention, createVerifiedBackup, verifyBackup } from './database/backup-service.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fideliza-backup-'));
  directories.push(directory);
  const database = new Database(path.join(directory, 'source.db'));
  database.exec('CREATE TABLE tenants(id TEXT); CREATE TABLE customers(id TEXT); CREATE TABLE sales(id TEXT); CREATE TABLE users(id TEXT); INSERT INTO tenants VALUES (\'vivi\'); INSERT INTO customers VALUES (\'cliente\');');
  return { directory, database };
}

describe('recuperação de desastre', () => {
  it('cria e abre uma cópia íntegra com os dados essenciais', async () => {
    const { directory, database } = fixture();
    const summary = await createVerifiedBackup(database, path.join(directory, 'backups'));
    database.close();
    expect(summary.tenants).toBe(1);
    expect(summary.customers).toBe(1);
    expect(verifyBackup(summary.path).sizeBytes).toBeGreaterThan(0);
  });

  it('rejeita arquivo corrompido', () => {
    const { directory, database } = fixture(); database.close();
    const corrupted = path.join(directory, 'corrupted.db'); fs.writeFileSync(corrupted, 'não é sqlite');
    expect(() => verifyBackup(corrupted)).toThrow();
  });

  it('remove apenas backups vencidos e preserva arquivos alheios', () => {
    const { directory, database } = fixture(); database.close();
    const old = path.join(directory, 'fideliza-2020-01-01T00-00-00-000Z.db');
    const unrelated = path.join(directory, 'documento.db');
    fs.writeFileSync(old, 'old'); fs.writeFileSync(unrelated, 'keep');
    fs.utimesSync(old, new Date(0), new Date(0));
    expect(applyBackupRetention(directory, 30, 30)).toContain(old);
    expect(fs.existsSync(unrelated)).toBe(true);
  });
});
