import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export type OffsiteConfig = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix: string; encryptionKey: string };
export type OffsiteResult = { key: string; bytes: number } | { error: string };

const MAGIC = Buffer.from('FZB1');

/** Lê a configuração do armazenamento externo compatível com S3 (Cloudflare R2, Backblaze B2, AWS S3). */
export function offsiteConfig(env: Record<string, string | undefined> = process.env): OffsiteConfig | null {
  if (!env.BACKUP_S3_BUCKET) return null;
  return {
    endpoint: String(env.BACKUP_S3_ENDPOINT || '').replace(/\/+$/, ''),
    bucket: env.BACKUP_S3_BUCKET,
    region: env.BACKUP_S3_REGION || 'auto',
    accessKeyId: String(env.BACKUP_S3_ACCESS_KEY_ID || ''),
    secretAccessKey: String(env.BACKUP_S3_SECRET_ACCESS_KEY || ''),
    prefix: String(env.BACKUP_S3_PREFIX || 'fidelizei/').replace(/^\/+/, ''),
    encryptionKey: String(env.BACKUP_ENCRYPTION_KEY || '').trim(),
  };
}

function backupKey(secret: string) { return createHash('sha256').update(`fidelizei:backup:v1:${secret}`).digest(); }

/** Compacta e criptografa (AES-256-GCM) antes de sair do servidor: o provedor nunca vê os dados. */
export function encryptBackup(content: Buffer, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', backupKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(content)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBackup(content: Buffer, secret: string) {
  if (!content.subarray(0, 4).equals(MAGIC)) throw new Error('Arquivo não é um backup criptografado do Fidelizei');
  const decipher = createDecipheriv('aes-256-gcm', backupKey(secret), content.subarray(4, 16));
  decipher.setAuthTag(content.subarray(16, 32));
  return gunzipSync(Buffer.concat([decipher.update(content.subarray(32)), decipher.final()]));
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();

/** PUT assinado com AWS Signature V4 em estilo de caminho, suficiente para R2, B2 e S3. */
export async function putObject(config: OffsiteConfig, key: string, body: Buffer, now = new Date()) {
  const url = new URL(`${config.endpoint}/${encodeURIComponent(config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amzDate.slice(0, 8), payloadHash = sha256(body);
  const canonical = ['PUT', url.pathname, '', `host:${url.host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${amzDate}`, '', 'host;x-amz-content-sha256;x-amz-date', payloadHash].join('\n');
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')).digest('hex');
  const response = await fetch(url, {
    method: 'PUT', body: new Uint8Array(body),
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, 'content-type': 'application/octet-stream',
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Armazenamento externo HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

export async function uploadBackupOffsite(filePath: string, config = offsiteConfig()): Promise<OffsiteResult | null> {
  if (!config) return null;
  try {
    const body = encryptBackup(fs.readFileSync(filePath), config.encryptionKey);
    const key = `${config.prefix}${path.basename(filePath)}.gz.enc`;
    await putObject(config, key, body);
    return { key, bytes: body.length };
  } catch (error) {
    console.error('Falha ao enviar backup para o armazenamento externo', (error as Error).message);
    return { error: (error as Error).message };
  }
}

/** Alerta quando o disco do banco passa de 70%: disco cheio impede gravações e derruba a API. */
export function diskUsagePercent(directory: string) {
  try {
    const stats = fs.statfsSync(directory);
    return Math.round((1 - stats.bavail / stats.blocks) * 100);
  } catch { return null; }
}
