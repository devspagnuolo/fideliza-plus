import { beforeAll,describe,expect,it } from 'vitest';

process.env.SESSION_SECRET='data-encryption-test-secret-with-32-chars';
let encryptData:(value:string,purpose:string)=>string;
let decryptData:(value:string,purpose:string)=>string;
let isCurrentDataCipher:(value:string,purpose:string)=>boolean;
beforeAll(async()=>({encryptData,decryptData,isCurrentDataCipher}=await import('./data-encryption.js')));

describe('criptografia versionada de dados persistidos',()=>{
 it('separa finalidade, autentica o ciphertext e permite rotação com chave anterior',()=>{
  process.env.DATA_ENCRYPTION_KEY='A'.repeat(48);
  delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
  const oldValue=encryptData('segredo antigo','bling');
  expect(oldValue.startsWith('v2.')).toBe(true);
  expect(isCurrentDataCipher(oldValue,'bling')).toBe(true);
  process.env.DATA_ENCRYPTION_KEY='B'.repeat(48);
  process.env.DATA_ENCRYPTION_KEY_PREVIOUS='A'.repeat(48);
  expect(isCurrentDataCipher(oldValue,'bling')).toBe(false);
  expect(decryptData(oldValue,'bling')).toBe('segredo antigo');
  const rotated=encryptData(decryptData(oldValue,'bling'),'bling');
  expect(isCurrentDataCipher(rotated,'bling')).toBe(true);
  expect(decryptData(rotated,'bling')).toBe('segredo antigo');
  expect(()=>decryptData(oldValue,'totp')).toThrow();
  const parts=rotated.split('.');
  parts[4]='A'.repeat(parts[4]!.length);
  expect(()=>decryptData(parts.join('.'),'bling')).toThrow();
 });
});
