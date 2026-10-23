import { createHash } from 'node:crypto';
import { decryptData,decryptLegacyData,encryptData,hasVersionedDataCipher } from './data-encryption.js';
import { config } from './config.js';
import { resilientFetch } from './circuit-breaker.js';
import { db } from './database/db.js';

const legacyKey=createHash('sha256').update(config.sessionSecret).digest();
export function encryptSecret(value:string){return encryptData(value,'bling')}
export function decryptSecret(value:string){return hasVersionedDataCipher(value)?decryptData(value,'bling'):decryptLegacyData(value,legacyKey)}
export function blingAuthorizationUrl(state:string){const clientId=process.env.BLING_CLIENT_ID;if(!clientId)throw new Error('Bling não configurado');const url=new URL('https://www.bling.com.br/Api/v3/oauth/authorize');url.searchParams.set('response_type','code');url.searchParams.set('client_id',clientId);url.searchParams.set('state',state);return url.toString();}
export async function exchangeBlingToken(grantType:'authorization_code'|'refresh_token',value:string){const clientId=process.env.BLING_CLIENT_ID,secret=process.env.BLING_CLIENT_SECRET;if(!clientId||!secret)throw new Error('Bling não configurado');const body=new URLSearchParams({grant_type:grantType,[grantType==='authorization_code'?'code':'refresh_token']:value});const response=await resilientFetch('bling','https://api.bling.com.br/Api/v3/oauth/token',{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded',accept:'1.0','enable-jwt':'1'},body});const data=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number;error?:{message?:string};error_description?:string};if(!response.ok||!data.access_token||!data.refresh_token)throw new Error(data.error_description||data.error?.message||`Bling HTTP ${response.status}`);return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in??3600};}
// O webhook do Bling identifica a conta pelo companyId. O vínculo com a empresa
// do Fidelizei nasce no callback OAuth, consultando a conta dona do token, e
// nunca por "primeiro webhook que chegar".
export async function fetchBlingCompanyId(accessToken:string){const response=await resilientFetch('bling','https://api.bling.com.br/Api/v3/empresas/me/dados-basicos',{headers:{authorization:`Bearer ${accessToken}`,'enable-jwt':'1',accept:'application/json'}});const body=await response.json().catch(()=>({})) as {data?:{id?:string|number|null}};const id=body.data?.id==null?'':String(body.data.id).trim();if(!response.ok||!id)throw new Error(`Bling não informou a empresa conectada (HTTP ${response.status})`);return id;}
export function blingCompanyTenant(companyId:string){return (db.prepare("SELECT tenant_id FROM integration_connections WHERE provider='bling' AND external_company_id=?").get(companyId) as {tenant_id:string}|undefined)?.tenant_id;}
/** Grava o companyId se ninguém mais o usa. Retorna false quando a conta Bling já pertence a outra empresa. */
export function bindBlingCompany(tenantId:string,companyId:string){return db.transaction(()=>{const owner=blingCompanyTenant(companyId);if(owner&&owner!==tenantId)return false;db.prepare("UPDATE integration_connections SET external_company_id=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND provider='bling'").run(companyId,tenantId);return true;})();}
