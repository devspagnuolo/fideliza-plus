import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';

const directory=path.resolve(process.cwd(),'backups');
fs.mkdirSync(directory,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const destination=path.join(directory,`fideliza-${stamp}.db`);
await db.backup(destination);
console.log(`Backup criado: ${destination}`);
