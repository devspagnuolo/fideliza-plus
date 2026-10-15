import { createHash } from 'node:crypto';
import { decryptData,decryptLegacyData,encryptData,hasVersionedDataCipher } from './data-encryption.js';
import { config } from './config.js';
import { resilientFetch } from './circuit-breaker.js';

const legacyKey=createHash('sha256').update(config.sessionSecret).digest();
export function encryptSecret(value:string){return encryptData(value,'bling')}
export function decryptSecret(value:string){return hasVersionedDataCipher(value)?decryptData(value,'bling'):decryptLegacyData(value,legacyKey)}
export function blingAuthorizationUrl(state:string){const clientId=process.env.BLING_CLIENT_ID;if(!clientId)throw new Error('Bling não configurado');const url=new URL('https://www.bling.com.br/Api/v3/oauth/authorize');url.searchParams.set('response_type','code');url.searchParams.set('client_id',clientId);url.searchParams.set('state',state);return url.toString();}
export async function exchangeBlingToken(grantType:'authorization_code'|'refresh_token',value:string){const clientId=process.env.BLING_CLIENT_ID,secret=process.env.BLING_CLIENT_SECRET;if(!clientId||!secret)throw new Error('Bling não configurado');const body=new URLSearchParams({grant_type:grantType,[grantType==='authorization_code'?'code':'refresh_token']:value});const response=await resilientFetch('bling','https://api.bling.com.br/Api/v3/oauth/token',{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded',accept:'1.0','enable-jwt':'1'},body});const data=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number;error?:{message?:string};error_description?:string};if(!response.ok||!data.access_token||!data.refresh_token)throw new Error(data.error_description||data.error?.message||`Bling HTTP ${response.status}`);return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in??3600};}
