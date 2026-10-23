import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function privateIpv4(address: string) {
  const [a = 0, b = 0] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function privateAddress(address: string) {
  if (isIP(address) === 4) return privateIpv4(address);
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) return privateIpv4(value.slice(7));
  return value === '::' || value === '::1' || /^f[cd]/.test(value) || /^fe[89ab]/.test(value);
}

/**
 * Bloqueia URLs informadas por clientes que apontem para a rede interna do provedor (SSRF):
 * só HTTPS, sem credenciais na URL e com todos os IPs resolvidos públicos.
 */
export async function assertPublicHttpsUrl(raw: string, resolve: typeof lookup = lookup) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use um endereço HTTPS público');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await resolve(host, { all: true })).map(item => item.address);
  if (!addresses.length || addresses.some(privateAddress)) throw new Error('Use um endereço HTTPS público');
  return url;
}
