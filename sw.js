const CACHE_NAME = 'wwp-v3';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/css/bootstrap.min.css'
];
const DUA_IMAGES = [
  'assets/dua/tile/morning.webp','assets/dua/tile/evening.webp','assets/dua/tile/salah.webp',
  'assets/dua/tile/sleep.webp','assets/dua/tile/praise.webp','assets/dua/tile/qurandua.webp',
  'assets/dua/tile/istighfar.webp','assets/dua/tile/ummah.webp','assets/dua/tile/names.webp',
  'assets/dua/tile/other.webp','assets/dua/banner/morning.webp','assets/dua/banner/evening.webp',
  'assets/dua/banner/salah.webp','assets/dua/banner/sleep.webp','assets/dua/banner/praise.webp',
  'assets/dua/banner/qurandua.webp','assets/dua/banner/istighfar.webp','assets/dua/banner/ummah.webp',
  'assets/dua/banner/names.webp','assets/dua/banner/other.webp'
];
const ALL_URLS = [...OFFLINE_URLS, ...DUA_IMAGES];

// Precache an offline fallback set. This never blocks getting fresh content —
// it's only used when the network is unavailable.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => Promise.all(ALL_URLS.map(u => c.add(u).catch(() => 0))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(n => Promise.all(n.filter(x => x !== CACHE_NAME).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

// Let the page ask the waiting SW to activate immediately (used for the
// "new version available -> reload" flow).
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Live API data: network-first, cache as fallback for offline.
  if (url.hostname === 'api.aladhan.com' || url.hostname === 'api.alquran.cloud' || url.hostname === 'everyayah.com') {
    e.respondWith(
      caches.open(CACHE_NAME).then(c => c.match(e.request).then(cached => {
        const fp = fetch(e.request).then(r => {
          if (r.status === 200) c.put(e.request, r.clone());
          return r;
        }).catch(() => cached || new Response('', { status: 503 }));
        return cached || fp;
      }))
    );
    return;
  }

  // Page navigations / the app shell itself: always try the network first
  // so a GitHub push + Cloudflare deploy shows up on next load. Falls back
  // to the cached copy only when offline.
  const isAppShell = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isAppShell) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.status === 200) caches.open(CACHE_NAME).then(c => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Everything else (images, fonts, third-party CSS): stale-while-revalidate.
  // Serve the cached copy instantly, then refresh the cache in the
  // background so the *next* load auto-picks up any change — no manual
  // cache-name bump ever needed.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(resp => {
        if (resp.status === 200) caches.open(CACHE_NAME).then(c => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
