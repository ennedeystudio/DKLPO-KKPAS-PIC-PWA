const CACHE_NAME = 'kkpas-pic-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  'https://arleta.site/interactivelink/3333/DKLPO_Master_192.png',
  'https://arleta.site/interactivelink/3333/DKLPO_Master_512.png'
];

// Pasang Service Worker dan cache fail utama
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Guna Network-First strategy (ambil dari internet dulu, kalau tiada internet ambil dari cache)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

// Buang cache lama apabila ada versi baharu
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});