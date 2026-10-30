/* Portal PIC DKLPO — service worker khusus PWA PIC.
   Pemeriksaan bulanan dan borang NCR/CAR/PAR berada dalam portal pemeriksa,
   bukan sebahagian daripada aplikasi PIC ini.
   Data/draf/bukti PIC dalam IndexedDB tidak dipadam sewaktu naik taraf.
   Queue pembetulan PIC disegerakkan oleh index.html semasa portal dibuka dan online.
*/
const CACHE_NAME = 'kkpas-pic-cache-v15-pic-only-20261030';
const APP_SHELL = ['./', './index.html', './manifest.json'];
const CACHE_PREFIXES = ['kkpas-pic-cache-', 'kkpas-pwa-'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      try { await cache.add(path); }
      catch (error) { console.warn('PIC offline file tidak tersedia:', path, error); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => CACHE_PREFIXES.some(prefix => key.startsWith(prefix)) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Hanya halaman utama PIC dan manifest dicache; jangan pintas portal pemeriksa.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = self.registration.scope;
  const paths = [
    new URL('./', scope).pathname,
    new URL('./index.html', scope).pathname,
    new URL('./manifest.json', scope).pathname
  ];
  if (url.origin !== self.location.origin || !paths.includes(url.pathname)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
          .catch(error => console.warn('PIC cache gagal disimpan:', error)));
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, {ignoreSearch:true});
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const home = await caches.match(new URL('./index.html', scope));
        if (home) return home;
      }
      return new Response('Portal PIC tidak tersedia di luar talian.', {
        status:503,
        headers:{'Content-Type':'text/plain; charset=utf-8'}
      });
    }
  })());
});
