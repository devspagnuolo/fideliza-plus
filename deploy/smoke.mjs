const apiUrl = (process.env.SMOKE_API_URL ?? 'http://localhost:3333').replace(/\/$/, '');
const webUrl = (process.env.SMOKE_WEB_URL ?? 'http://localhost:8080').replace(/\/$/, '');

async function expectResponse(label, url, validate) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const body = await response.text();
  if (!validate(response, body)) throw new Error(`${label}: resposta inesperada`);
  console.log(`OK ${label}`);
}

await expectResponse('API ativa', `${apiUrl}/health`, (_response, body) => JSON.parse(body).status === 'ok');
await expectResponse('Banco disponível', `${apiUrl}/ready`, (_response, body) => JSON.parse(body).status === 'ready');
await expectResponse(
  'Interface web',
  webUrl,
  (response, body) =>
    (response.headers.get('content-type') ?? '').includes('text/html') &&
    /<div[^>]+id=["']root["'][^>]*>/i.test(body),
);
console.log('Homologação técnica básica aprovada.');
