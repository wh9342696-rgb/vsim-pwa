
const CACHE = 'vsim-v16-kyc-mobile';
const ASSETS = [
  './',
  './index.html',
  './css/app.css?v=20260906-kyc-mobile',
  './js/app.js?v=20260906-kyc-mobile',
  './js/pwa-register.js?v=20260906-kyc-mobile',
  './icons/vsim.svg',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const requestUrl = new URL(e.request.url);
  if (requestUrl.pathname === '/admin' || requestUrl.pathname.startsWith('/admin/')) return;
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
