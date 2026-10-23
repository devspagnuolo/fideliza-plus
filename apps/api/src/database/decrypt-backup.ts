import fs from 'node:fs';
import { decryptBackup } from './backup-offsite.js';

const [input, output] = process.argv.slice(2);
const secret = process.env.BACKUP_ENCRYPTION_KEY?.trim();
if (!input || !output || !secret) {
  console.error('Uso: BACKUP_ENCRYPTION_KEY=... npm run db:decrypt-backup -- <arquivo.gz.enc> <saida.db>');
  process.exit(1);
}
fs.writeFileSync(output, decryptBackup(fs.readFileSync(input), secret));
console.log(`Backup restaurado em ${output}. Confira com npm run db:verify-backup -- ${output}`);
