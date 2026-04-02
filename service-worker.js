const CACHE_NAME = 'book-scanner-v3';
const ASSETS = [
  '/book-scanner/',
  '/book-scanner/index.html',
  '/book-scanner/manifest.json'
];

// インストール時にキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ネットワーク優先、失敗時はキャッシュから返す
self.addEventListener('fetch', e => {
  // POST/PUT等はSWを通さない（GASへのPOSTをキャッシュしない）
  if (e.request.method !== 'GET') return;
  // APIリクエストはキャッシュしない
  if (e.request.url.includes('api.anthropic.com') ||
      e.request.url.includes('script.google.com') ||
      e.request.url.includes('script.googleusercontent.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 200以外またはオペーク（クロスオリジンCORSなし）はキャッシュしない
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
