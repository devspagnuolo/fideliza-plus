import { createHash,createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import { decryptData,decryptLegacyData,encryptData,hasVersionedDataCipher } from './data-encryption.js';import { config } from './config.js';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',key=createHash('sha256').update(`${config.sessionSecret}.two-factor`).digest();
function encodeBase32(buffer:Buffer){let bits='';for(const byte of buffer)bits+=byte.toString(2).padStart(8,'0');let result='';for(let i=0;i<bits.length;i+=5)result+=alphabet[Number.parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];return result;}
function decodeBase32(value:string){let bits='';for(const char of value.replace(/=+$/,'').toUpperCase()){const index=alphabet.indexOf(char);if(index<0)throw new Error('Segredo TOTP inválido');bits+=index.toString(2).padStart(5,'0');}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));return Buffer.from(bytes);}
export function newTotpSecret(){return encodeBase32(randomBytes(20));}
export function totpCode(secret:string,time=Date.now()){const counter=BigInt(Math.floor(time/30_000)),buffer=Buffer.alloc(8);buffer.writeBigUInt64BE(counter);const digest=createHmac('sha1',decodeBase32(secret)).update(buffer).digest(),offset=digest[digest.length-1]!&15,value=(digest.readUInt32BE(offset)&0x7fffffff)%1_000_000;return String(value).padStart(6,'0');}
export function verifyTotp(secret:string,code:string,time=Date.now()){if(!/^\d{6}$/.test(code))return false;return [-1,0,1].some(step=>{const expected=totpCode(secret,time+step*30_000);return timingSafeEqual(Buffer.from(expected),Buffer.from(code));});}
export function encryptTotp(secret:string){return encryptData(secret,'totp')}
export function decryptTotp(value:string){return hasVersionedDataCipher(value)?decryptData(value,'totp'):decryptLegacyData(value,key)}
export function totpUri(secret:string,email:string){return `otpauth://totp/${encodeURIComponent(`Fidelizei:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('Fidelizei')}&algorithm=SHA1&digits=6&period=30`;}
