import { beforeAll,describe,expect,it } from 'vitest';

process.env.SESSION_SECRET='bling-unit-test-secret-with-32-characters';
process.env.BLING_CLIENT_ID='client-test';

let encryptSecret:(value:string)=>string;
let decryptSecret:(value:string)=>string;
let blingAuthorizationUrl:(state:string)=>string;

beforeAll(async()=>({encryptSecret,decryptSecret,blingAuthorizationUrl}=await import('./bling.js')));

describe('adaptador Bling',()=>{
  it('protege tokens com criptografia autenticada',()=>{const encrypted=encryptSecret('token-confidencial');expect(encrypted.startsWith('v2.')).toBe(true);expect(encrypted).not.toContain('token-confidencial');expect(decryptSecret(encrypted)).toBe('token-confidencial');const parts=encrypted.split('.'),ciphertext=parts[4]!,tampered=[...parts.slice(0,4),`${ciphertext[0]==='A'?'B':'A'}${ciphertext.slice(1)}`].join('.');expect(()=>decryptSecret(tampered)).toThrow();});
  it('gera autorização OAuth com estado e cliente',()=>{const url=new URL(blingAuthorizationUrl('estado-seguro'));expect(url.origin).toBe('https://www.bling.com.br');expect(url.searchParams.get('response_type')).toBe('code');expect(url.searchParams.get('client_id')).toBe('client-test');expect(url.searchParams.get('state')).toBe('estado-seguro');});
});
