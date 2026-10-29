const CACHE_NAME = 'kkpas-pic-cache-v8-20261029';
const CORE = ['./', './index.html', './manifest.json'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('kkpas-pic-cache-') && k !== CACHE_NAME)
    .map(k => caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method!=='GET') return; // Never intercept or cache POST APIs.
  const url=new URL(req.url);
  const local=url.origin===self.location.origin;
  if(!local) return; // Remote Drive images and APIs stay network-only.
  event.respondWith((async()=>{
    try {
      const response=await fetch(req);
      if(response && response.ok && (response.type==='basic'||response.type==='default') &&
         (req.mode==='navigate' || ['.html','.js','.css','.json','.png','.svg','.ico'].some(ext=>url.pathname.endsWith(ext)))){
        const clone=response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(req,clone)).catch(()=>{}));
      }
      return response;
    }catch(error){
      const cached=await caches.match(req);
      if(cached)return cached;
      if(req.mode==='navigate'){
        const shell=await caches.match('./index.html');
        if(shell)return shell;
      }
      return new Response('Offline: kandungan ini belum disimpan.',{
        status:503,statusText:'Offline',headers:{'Content-Type':'text/plain; charset=utf-8'}
      });
    }
  })());
});
