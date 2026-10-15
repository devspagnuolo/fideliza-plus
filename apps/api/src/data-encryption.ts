import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

function baseKey(value:string,purpose:string){return createHash('sha256').update(`fidelizei:data:${purpose}:v2:${value}`).digest()}
function keyId(key:Buffer){return createHash('sha256').update(key).digest('hex').slice(0,16)}
function activeSecret(){return process.env.DATA_ENCRYPTION_KEY?.trim()||config.sessionSecret}
function keyCandidates(purpose:string){return [...new Set([process.env.DATA_ENCRYPTION_KEY?.trim(),process.env.DATA_ENCRYPTION_KEY_PREVIOUS?.trim(),config.sessionSecret].filter((item):item is string=>Boolean(item)))].map(secret=>baseKey(secret,purpose))}
export function hasVersionedDataCipher(value:string){return value.startsWith('v2.')}
export function isCurrentDataCipher(value:string,purpose:string){const parts=value.split('.');return parts.length===5&&parts[0]==='v2'&&parts[1]===keyId(baseKey(activeSecret(),purpose))}
export function encryptData(value:string,purpose:string){const key=baseKey(activeSecret(),purpose),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return ['v2',keyId(key),iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.')}
export function decryptData(value:string,purpose:string){const parts=value.split('.');if(parts.length!==5||parts[0]!=='v2')throw new Error('Formato de dado criptografado inválido');const key=keyCandidates(purpose).find(candidate=>keyId(candidate)===parts[1]);if(!key)throw new Error('Chave de criptografia indisponível; configure a chave anterior para concluir a rotação');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(parts[2]!,'base64url'));decipher.setAuthTag(Buffer.from(parts[3]!,'base64url'));return Buffer.concat([decipher.update(Buffer.from(parts[4]!,'base64url')),decipher.final()]).toString('utf8')}
export function decryptLegacyData(value:string,key:Buffer){const parts=value.split('.');if(parts.length!==3)throw new Error('Formato legado de dado criptografado inválido');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(parts[0]!,'base64url'));decipher.setAuthTag(Buffer.from(parts[1]!,'base64url'));return Buffer.concat([decipher.update(Buffer.from(parts[2]!,'base64url')),decipher.final()]).toString('utf8')}
