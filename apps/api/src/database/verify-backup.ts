import { verifyBackup } from './backup-service.js';

const filePath = process.argv[2];
if (!filePath) throw new Error('Informe o arquivo: npm run db:verify-backup -- caminho/do/backup.db');
const summary = verifyBackup(filePath);
console.log(`Backup íntegro: ${summary.path}`);
console.log(`Empresas: ${summary.tenants}; clientes: ${summary.customers}; vendas: ${summary.sales}; bytes: ${summary.sizeBytes}`);
