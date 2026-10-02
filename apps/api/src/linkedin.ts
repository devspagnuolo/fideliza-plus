import { resilientFetch } from './circuit-breaker.js';

export type LinkedInToken = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresIn?: number;
  scopes: string[];
};

export type LinkedInTokenInspection = {active:boolean;status?:string;clientId?:string;authorizedAt?:number;createdAt?:number;expiresAt?:number;scopes:string[];authType?:string};

export function linkedInConfigured() {
  return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

export function linkedInRedirectUri() {
  return process.env.LINKEDIN_REDIRECT_URI ?? 'https://api.fidelizaplus.com.br/integrations/linkedin/callback';
}

export function linkedInScopes() {
  return (process.env.LINKEDIN_SCOPES ?? 'w_member_social')
    .split(/[\s,]+/)
    .map(scope => scope.trim())
    .filter(Boolean);
}

export function linkedInAuthorizationUrl(state: string) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) throw new Error('LinkedIn não configurado');
  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', linkedInRedirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', linkedInScopes().join(' '));
  return url.toString();
}

export async function exchangeLinkedInCode(code: string): Promise<LinkedInToken> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('LinkedIn não configurado');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: linkedInRedirectUri(),
  });
  const response = await resilientFetch('linkedin', 'https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
    error_description?: string;
    message?: string;
  };
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? data.message ?? `LinkedIn HTTP ${response.status}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresIn: data.expires_in ?? 5_184_000,
    refreshTokenExpiresIn: data.refresh_token_expires_in,
    scopes: (data.scope ?? linkedInScopes().join(' ')).split(/[\s,]+/).filter(Boolean),
  };
}

export async function inspectLinkedInToken(accessToken:string):Promise<LinkedInTokenInspection>{
  const clientId=process.env.LINKEDIN_CLIENT_ID,clientSecret=process.env.LINKEDIN_CLIENT_SECRET;
  if(!clientId||!clientSecret)throw new Error('LinkedIn não configurado');
  const response=await resilientFetch('linkedin','https://www.linkedin.com/oauth/v2/introspectToken',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,token:accessToken})});
  const data=await response.json() as {active?:boolean;status?:string;client_id?:string;authorized_at?:number;created_at?:number;expires_at?:number;scope?:string;auth_type?:string;error_description?:string;message?:string};
  if(!response.ok)throw new Error(data.error_description??data.message??`LinkedIn HTTP ${response.status}`);
  return {active:Boolean(data.active),status:data.status,clientId:data.client_id,authorizedAt:data.authorized_at,createdAt:data.created_at,expiresAt:data.expires_at,scopes:(data.scope??'').split(/[\s,]+/).filter(Boolean),authType:data.auth_type};
}
