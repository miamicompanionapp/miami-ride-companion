// Miami Ride Companion — Service Worker
// Version this string whenever you deploy a significant update.
// Changing it forces all clients to re-cache everything fresh.
const CACHE_VERSION = 'miami-ride-v1.8.0';

// ─── Files to pre-cache on install ───────────────────────────────────────────
// These are fetched and stored the moment the SW installs (first app open on Wi-Fi).
// The app will work fully offline as long as these are cached.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/content.json',
  // Google Fonts — cached so text renders offline
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:wght@500;600&display=swap',
  // Tabler icons — pinned version for reliable caching
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/fonts/tabler-icons.woff2',
  // QR code generator
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  // Game images — stored locally, cached offline
  '/images/games/statue-of-liberty.jpg',
  '/images/games/eiffel-tower.jpg',
  '/images/games/colosseum.jpg',
  '/images/games/machu-picchu.jpg',
  '/images/games/taj-mahal.jpg',
  '/images/games/sydney-opera.jpg',
  '/images/games/golden-gate.jpg',
  '/images/games/big-ben.jpg',
  '/images/games/sagrada-familia.jpg',
  '/images/games/christ-redeemer.jpg',
  '/images/games/great-wall.jpg',
  '/images/games/wynwood-walls.webp',
  '/images/games/burj-khalifa.jpg',
  '/images/games/petra.jpg',
  '/images/games/angkor-wat.jpg',
];

// ─── Files that should NEVER be cached ───────────────────────────────────────
// The editor should always load fresh — never serve a cached version.
const NEVER_CACHE = [
  '/editor.html',
  '/editor',
  '/analytics.json',
  '/api/',
];

// ─── Install: pre-cache everything ───────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        // Cache what we can — don't let one failure block the whole install.
        // Fonts/CDN might fail if there's no internet at install time.
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => {
              console.warn(`[SW] Failed to pre-cache: ${url}`, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_VERSION)
            .map(name => {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: serve from cache, fall back to network ───────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache the editor or analytics
  if (NEVER_CACHE.some(path => url.pathname.startsWith(path))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // content.json: Network first, fall back to cache.
  // This ensures passengers always get the latest content
  // when the app is opened at home on Wi-Fi.
  if (url.pathname === '/content.json') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Update the cache with the fresh response
          const responseClone = response.clone();
          caches.open(CACHE_VERSION).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // No network — serve cached version
          return caches.match(event.request);
        })
    );
    return;
  }

  // Everything else: Cache first, fall back to network.
  // This makes the app load instantly from cache.
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache immediately
          // Also fetch in background to keep cache fresh (stale-while-revalidate)
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_VERSION).then(cache => {
                  cache.put(event.request, networkResponse.clone());
                });
              }
              return networkResponse;
            })
            .catch(() => {});
          return cachedResponse;
        }

        // Not in cache — fetch from network and cache it
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200 || response.type === 'opaque') {
              return response;
            }
            const responseClone = response.clone();
            caches.open(CACHE_VERSION).then(cache => {
              cache.put(event.request, responseClone);
            });
            return response;
          })
          .catch(() => {
            // Network failed and nothing in cache
            // Return a minimal offline fallback for HTML requests
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// ─── Message: force cache refresh ────────────────────────────────────────────
// The passenger app can send { type: 'SKIP_WAITING' } to trigger an update.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
