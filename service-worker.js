const CACHE_NAME = 'power-fire-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/maskable.svg',
  // Ícones PNG
  './icons/icon-72.png',
  './icons/icon-128.png',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  // Áudios com caminhos codificados (para lidar com espaços)
  './sons/inicio.mp3',
  './sons/pausa%20para%20descanso.mp3',
  './sons/Iniciar%20treino.mp3',
  './sons/fim_series.mp3'
  ,
  // Background do app
  './img/bakground.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // ignore non-GET
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      // Optionally cache new GETs from same-origin
      if (new URL(req.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      // offline fallback: return root for navigations
      if (req.mode === 'navigate') {
        return caches.match('./');
      }
      throw err;
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        client.focus();
        return;
      }
    }
    if (clients.openWindow) {
      await clients.openWindow('./');
    }
  })());
});
