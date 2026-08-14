const CACHE = 'fideliza-shell-v2';
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/icons/fideliza.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () =>
        (await caches.match(request)) || (await caches.match('/')) || (await caches.match('/offline.html'))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async cached => {
      if (cached) return cached;
      const response = await fetch(request);

      // Assets versionados pelo Vite não precisam de cache manual. Isso evita
      // guardar uma resposta HTML transitória como se fosse CSS ou JavaScript.
      if (response.ok && ['image', 'font'].includes(request.destination)) {
        const copy = response.clone();
        void caches.open(CACHE).then(cache => cache.put(request, copy));
      }

      return response;
    })
  );
});
