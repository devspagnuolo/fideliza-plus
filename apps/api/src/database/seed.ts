import './migrate.js';
import { db } from './db.js';
import { hashPassword } from '../security.js';

const seed = db.transaction(() => {
  if (!process.env.PILOT_ADMIN_EMAIL || !process.env.PILOT_ADMIN_PASSWORD) {
    console.log('Seed piloto ignorado: defina PILOT_ADMIN_EMAIL e PILOT_ADMIN_PASSWORD somente em ambiente local.');
    return;
  }
  const tenantId = 'tenant-vivi-moda';
  const pilotExists = db.prepare('SELECT 1 FROM users WHERE lower(email)=lower(?)').get(process.env.PILOT_ADMIN_EMAIL);
  if (pilotExists) return;

  db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,segment,points_per_real,customer_portal_enabled) VALUES (?,?,?,?,?,1)').run(tenantId,'Vivi Moda Plus Size','vivi-moda-plus-size','Moda plus size',1);
  db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('user-vivi-admin',tenantId,process.env.PILOT_ADMIN_NAME||'Administrador da loja',process.env.PILOT_ADMIN_EMAIL,hashPassword(process.env.PILOT_ADMIN_PASSWORD),'owner');
});
seed();
console.log('Estrutura piloto criada sem clientes, vendas ou credenciais fixas no código.');
