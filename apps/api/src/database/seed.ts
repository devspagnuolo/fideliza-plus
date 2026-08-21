import { randomUUID } from 'node:crypto';
import './migrate.js';
import { db } from './db.js';
import { hashPassword } from '../security.js';

const seed = db.transaction(() => {
  const tenantId = 'tenant-vivi-moda';
  const pilotExists = db.prepare('SELECT 1 FROM users WHERE lower(email)=lower(?)').get('admin@vivimoda.local');
  if (pilotExists) return;

  db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,segment,points_per_real,customer_portal_enabled) VALUES (?,?,?,?,?,1)').run(tenantId,'Vivi Moda Plus Size','vivi-moda-plus-size','Moda plus size',1);
  db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?)').run('user-vivi-admin',tenantId,'Viviane Administradora','admin@vivimoda.local',hashPassword('Vivi@123'),'owner');
  const customers: Array<[string, string, string, number]> = [
    ['Ana Souza','ana@example.com','11999990001',120], ['Beatriz Lima','bia@example.com','11999990002',35],
    ['Carla Mendes','carla@example.com','11999990003',0], ['Daniela Rocha','dani@example.com','11999990004',80]
  ];
  for (const [name,email,phone,points] of customers) {
    const id = randomUUID();
    db.prepare('INSERT OR IGNORE INTO customers (id,tenant_id,name,email,phone,tags,points_balance) VALUES (?,?,?,?,?,?,?)').run(id,tenantId,name,email,phone,JSON.stringify(points > 70 ? ['VIP'] : []),points);
  }
  const ids = db.prepare('SELECT id FROM customers WHERE tenant_id=?').all(tenantId) as {id:string}[];
  const totals = [25990,14990,32990,8990];
  ids.forEach((customer, i) => db.prepare('INSERT OR IGNORE INTO sales (id,tenant_id,customer_id,external_id,total_cents,occurred_at,source) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),tenantId,customer.id,`SEED-${i+1}`,totals[i],new Date(Date.now()-i*86400000*8).toISOString(),'seed'));
});
seed();
console.log('Dados piloto da Vivi Moda criados. Login: admin@vivimoda.local / Vivi@123');
