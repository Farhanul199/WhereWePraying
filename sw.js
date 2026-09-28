const CACHE_NAME = 'wwp-v36';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];
// Core app shell: JS/CSS needed to render and run the app itself.
// Without these, the offline fallback above loads a blank/broken page —
// index.html alone is useless offline if none of its scripts/styles
// are cached alongside it. This list intentionally excludes the
// lazy-loaded, page-specific feature bundles (quran/journal/dua/guides/
// mosque/travel/community + their CSS) — those are cached on-demand by
// the stale-while-revalidate handler below the first time each page is
// actually visited, so a first-time offline visitor still gets a
// working home + prayer-times experience without downloading everything.
const CORE_ASSETS = [
  // Boot scripts (were inline in index.html until 28 Sep 2026). early.js
  // hides the boot loader — if it isn't cached, an offline start would
  // sit on the loader forever, so these MUST stay in this list.
  '/assets/js/boot/early.js?v=1',
  '/assets/js/boot/shell.js?v=1',
  '/assets/js/boot/event-theme.js?v=1',
  '/assets/js/boot/event-banners.js?v=1',
  '/assets/js/wwp-core.js?v=21',
  '/assets/js/services/storage.js?v=2',
  '/assets/js/services/platform.js?v=4',
  '/assets/js/features/prayer-times.js?v=10',
  '/assets/js/services/qibla-compass.js?v=2',
  '/assets/js/services/auth.js?v=6',
  '/assets/js/services/twinkle.js?v=3',
  '/assets/js/features/seasonal-themes.js?v=5',
  '/assets/js/features/glass-mode.js?v=3',
  '/assets/js/features/misc-widgets.js?v=2',
  '/assets/js/features/backup-restore.js?v=3',
  '/assets/js/features/supporter-checkout.js?v=2',
  '/assets/css/fonts.css?v=1',
  '/assets/fonts/manrope-latin-wght-normal.woff2',
  '/assets/css/base.css?v=3',
  '/assets/css/features/glass-mode.css?v=1',
  '/assets/css/features/seasonal-themes.css?v=3',
  '/assets/css/layout.css?v=1',
  '/assets/css/features/popups.css?v=2',
  '/assets/css/responsive-mobile.css?v=1',
  '/assets/css/features/auth.css?v=1',
  '/assets/css/features/leaderboard.css?v=1',
  '/assets/css/features/notifications.css?v=3',
  '/assets/css/app.css?v=13',
  '/assets/css/features/home.css?v=3',
  '/assets/css/features/prayer-times.css?v=3',
  '/assets/css/services/twinkle.css?v=2',
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
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
// DUA_IMAGES no longer precached (~800 KB every install); they're cached
// on first view of the Du'a page by the stale-while-revalidate handler.
const ALL_URLS = [...OFFLINE_URLS, ...CORE_ASSETS];

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
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(x => x !== CACHE_NAME).map(x => caches.delete(x)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

// Let the page ask the waiting SW to activate immediately (used for the
// "new version available -> reload" flow).
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Prayer-time / general push notifications.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'WhereWePraying?', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'WhereWePraying?';
  const options = {
    body: data.body || '',
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-96.png',
    tag: data.tag || 'wwp-notification',
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Only ever open pages on this site — a push payload can't send the
  // person to an outside URL (28 Sep 2026).
  let target = '/';
  try {
    const u = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
    if (u.origin === self.location.origin) target = u.href;
  } catch (_) { /* malformed — fall back to home */ }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) { c.navigate(target).catch(()=>0); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// Periodic Background Sync (Android/Chrome only, permission-gated on the
// client side — see index.html): refreshes already-cached prayer-time and
// mosque API responses in the background, so an offline open is never
// more than ~12h stale. It only re-fetches URLs this cache already knows
// about — never blind-fetches new ones — so it stays cheap and safe.
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'wwp-refresh-data') return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const refreshable = keys.filter(req => {
      const h = new URL(req.url).hostname;
      return h === 'api.aladhan.com' || (h === self.location.hostname && req.url.includes('/api/mosques/'));
    });
    await Promise.all(refreshable.map(async req => {
      try {
        const resp = await fetch(req);
        if (resp.ok) await cache.put(req, resp);
      } catch (_) { /* stays on the last cached copy until next attempt */ }
    }));
  })());
});

// Background Sync: fired by the browser when connectivity returns, even
// if the tab was only backgrounded (not closed) — the 'online' listener
// in wwp-core.js alone can't catch that case. Just wakes any open page(s)
// to run their own retry logic (WWP.flushPending), since the data that
// needs syncing lives in that page's localStorage, not in the SW.
self.addEventListener('sync', (e) => {
  if (e.tag !== 'wwp-flush-pending') return;
  e.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientsList.forEach(c => c.postMessage('FLUSH_PENDING'));
  })());
});

// Network-first, but don't hang on a weak signal (28 Sep 2026): if a
// cached copy exists and the network hasn't answered within `waitMs`, show
// the cached copy now and let the network finish in the background to
// refresh the cache for next time. With no cached copy, waits for the
// network as before. `networkFn` returns a fetch promise.
async function networkFirst(e, networkFn, waitMs, fallback) {
  const cache = await caches.open(CACHE_NAME);
  const network = networkFn().then((resp) => {
    if (resp && resp.ok) cache.put(e.request, resp.clone()).catch(() => 0);
    return resp;
  });
  e.waitUntil(network.then(() => 0, () => 0));
  const cached = await cache.match(e.request);
  if (!cached) {
    try { return await network; } catch (_) { return fallback ? fallback(cache) : new Response('', { status: 503 }); }
  }
  let timer;
  const timeout = new Promise((res) => { timer = setTimeout(() => res(null), waitMs); });
  try {
    const winner = await Promise.race([network, timeout]);
    return winner || cached;
  } catch (_) {
    return cached;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Qur'an recitation audio: let the browser handle it directly. The
  // responses are opaque range requests that can never be cached here.
  if (url.hostname === 'everyayah.com' || url.hostname === 'www.versebyversequran.com') return;

  // Live API data: network-first, cache as fallback for offline.
  // Fresh data wins; cached data is only the offline safety net.
  if (url.hostname === 'api.aladhan.com' || url.hostname === 'api.alquran.cloud') {
    e.respondWith(networkFirst(e, () => fetch(e.request), 4000));
    return;
  }

  // Page navigations / the app shell itself: always try the network first
  // so a GitHub push + Cloudflare deploy shows up on next load. Falls back
  // to the cached copy only when offline.
  const isAppShell = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isAppShell) {
    e.respondWith(networkFirst(
      e,
      // Navigation preload can start while the service worker boots.
      async () => (e.preloadResponse ? await e.preloadResponse : null) || fetch(e.request),
      3500,
      async (cache) => (await cache.match('/index.html')) || (await cache.match('/offline.html')) || new Response('Offline', { status: 503 })
    ));
    return;
  }

  // Mosque data (list, jama'ah times, favourites, photos): network-first,
  // cache as the offline fallback. Same reasoning as the prayer-time APIs
  // above — fresh data wins when online, but a user with no signal should
  // still see their last-known mosque list and favourites, not nothing.
  // This must be checked before the generic /api/ branch below, since that
  // branch would otherwise catch these same paths and skip caching them.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/mosques/')) {
    e.respondWith(networkFirst(e, () => fetch(e.request), 5000));
    return;
  }

  // Same-origin API calls (friends, leaderboard, streaks, pokes, etc.):
  // always network, never cached. This data is personal and changes from
  // actions taken elsewhere (a friend accepting a request, another device
  // poking you) — serving a stale cached copy here, even briefly before
  // the background refresh lands, would show outdated social/streak state.
  // Mutations (non-GET) already skip the whole handler above; this covers
  // the GET side of the same endpoints.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
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
