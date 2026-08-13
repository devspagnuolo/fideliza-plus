import { describe,expect,it } from 'vitest';
import { hashPassword,verifyPassword } from './security.js';
describe('senhas',()=>{it('valida sem armazenar texto puro',()=>{const hash=hashPassword('Senha@123');expect(hash).not.toContain('Senha@123');expect(verifyPassword('Senha@123',hash)).toBe(true);expect(verifyPassword('errada',hash)).toBe(false);});});
