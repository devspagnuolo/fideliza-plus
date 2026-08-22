import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function hashPassword(password: string) {
  password = canonicalizePassword(password);
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== 64) return false;
  const candidates = [...new Set([password, canonicalizePassword(password)])];
  return candidates.some((candidate) => timingSafeEqual(expected, scryptSync(candidate, salt, 64)));
}
export function canonicalizePassword(password: string) { return password.normalize('NFKC').trim(); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export function hashToken(token: string) { return createHash('sha256').update(`${token}.${config.sessionSecret}`).digest('hex'); }
