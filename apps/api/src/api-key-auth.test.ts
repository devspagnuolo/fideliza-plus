import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const databasePath=path.resolve(process.cwd(),`data/test-api-key-rate-${randomUUID()}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.SESSION_SECRET='api-key-rate-test-secret-with-32-chars';
const {db}=await import('./database/db.js');
await import('./database/migrate.js');
const {consumeApiKeyRateLimit}=await import('./api-key-auth.js');

describe('rate limit persistente das chaves de API',()=>{
 beforeAll(()=>{
  db.prepare('INSERT INTO tenants(id,name,slug)VALUES(?,?,?)').run('rate-tenant','Rate tenant','rate-tenant');
  db.prepare("INSERT INTO api_keys(id,tenant_id,name,key_prefix,key_hash,scopes)VALUES(?,?,?,?,?,'[]')").run('rate-key','rate-tenant','Teste','fz_live_test','hash-test');
  db.prepare("INSERT INTO api_keys(id,tenant_id,name,key_prefix,key_hash,scopes)VALUES(?,?,?,?,?,'[]')").run('rate-key-2','rate-tenant','Teste 2','fz_live_test2','hash-test2');
 });
 afterAll(()=>{db.close();for(const suffix of['','-shm','-wal'])fs.rmSync(`${databasePath}${suffix}`,{force:true})});
 it('mantém o limite por janela no banco e separa chaves',()=>{
  const start=Date.UTC(2026,9,15,12,0,0);
  for(let i=0;i<120;i++)expect(consumeApiKeyRateLimit('rate-key',start+i)).toBe(true);
  expect(consumeApiKeyRateLimit('rate-key',start+121)).toBe(false);
  expect(consumeApiKeyRateLimit('rate-key-2',start+121)).toBe(true);
  expect(consumeApiKeyRateLimit('rate-key',start+60_000)).toBe(true);
  expect(db.prepare("SELECT request_count FROM api_key_rate_limits WHERE api_key_id='rate-key' AND window_start=?").get(start)).toEqual({request_count:121});
 });
});
