// Miami Ride Companion — Service Worker
// Version this string whenever you deploy a significant update.
// Changing it forces all clients to re-cache everything fresh.
const CACHE_VERSION = 'miami-ride-v1.75.0';

// Tile cache lives separately so it survives app cache version bumps.
const TILE_CACHE_NAME = 'miami-map-tiles-v1';

// ─── Files to pre-cache on install ───────────────────────────────────────────
// These are fetched and stored the moment the SW installs (first app open on Wi-Fi).
// The app will work fully offline as long as these are cached.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/content.json',
  // PWA install icons
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Google Fonts — cached so text renders offline
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:wght@500;600&display=swap',
  // Tabler icons — pinned version for reliable caching
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/fonts/tabler-icons.woff2',
  // QR code generator
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  // Leaflet (map tab)
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js',
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

// ─── Offline fallback page for the (never-cached) dashboard ──────────────────
// Inlined so it needs no network and nothing in the cache. Matches the app's
// navy/teal/gold palette. Shown when editor.html is opened with no connection.
const OFFLINE_EDITOR_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard offline</title>
<style>
  html,body{margin:0;height:100%}
  body{background:#0F2137;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}
  .card{max-width:420px}
  .icon{font-size:54px;margin-bottom:12px}
  h1{font-size:22px;margin:0 0 10px;color:#C9A84C;font-weight:600}
  p{font-size:15px;line-height:1.5;color:rgba(255,255,255,.82);margin:0 0 22px}
  .actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  button{background:#0B9EA6;color:#fff;border:0;border-radius:10px;
    padding:13px 26px;font-size:15px;font-weight:600;cursor:pointer}
  button:active{opacity:.85}
  button.secondary{background:transparent;color:rgba(255,255,255,.82);
    border:1px solid rgba(255,255,255,.3)}
</style></head><body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>Dashboard needs a connection</h1>
    <p>The driver dashboard always loads fresh, so it can't open offline. Reconnect to Wi-Fi or cellular, then try again — or head back to the passenger app, which works offline.</p>
    <div class="actions">
      <button onclick="location.reload()">Try again</button>
      <button class="secondary" onclick="location.href='/'">Back to passenger app</button>
    </div>
  </div>
</body></html>`;

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
            .filter(name => name !== CACHE_VERSION && name !== TILE_CACHE_NAME && name !== 'miami-event-images')
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

  // Never cache the editor or analytics — always load fresh from the network.
  // But fail GRACEFULLY when offline: without a .catch() here the fetch()
  // promise rejects, respondWith() gets a rejected promise, and the browser
  // shows a raw "FetchEvent.respondWith received an error: TypeError: Load
  // failed" page (seen opening the dashboard in airplane mode end-of-shift).
  if (NEVER_CACHE.some(path => url.pathname.startsWith(path))) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Document (HTML) requests get a friendly offline page; everything else
        // (analytics.json, /api/*) gets a 503 the calling code can handle.
        if (event.request.destination === 'document') {
          return new Response(OFFLINE_EDITOR_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      })
    );
    return;
  }

  // OSM map tiles: cache-first in dedicated tile cache so they survive app
  // version bumps and can be pre-warmed by the driver dashboard.
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(tileCache =>
        tileCache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp && resp.ok) tileCache.put(event.request, resp.clone());
            return resp;
          }).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
        })
      )
    );
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

// ─── Message: force cache refresh / tile pre-warm ────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  // { type: 'CACHE_TILES', tiles: [{z,x,y}, ...] }
  // Sent by the driver dashboard to pre-warm offline map tiles.
  if (event.data && event.data.type === 'CACHE_TILES') {
    event.waitUntil(cacheTilesJob(event.data.tiles, event.source));
  }
});

async function cacheTilesJob(tiles, client) {
  const cache = await caches.open(TILE_CACHE_NAME);
  const total = tiles.length;
  let done = 0, cached = 0;
  const BATCH = 6; // concurrent requests per batch

  for (let i = 0; i < tiles.length; i += BATCH) {
    const batch = tiles.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async ({ z, x, y }) => {
      const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      const existing = await cache.match(url);
      if (existing) {
        cached++;
      } else {
        try {
          const resp = await fetch(url, { credentials: 'omit' });
          if (resp && resp.ok) { await cache.put(url, resp); cached++; }
        } catch { /* skip failed tiles */ }
      }
      done++;
    }));
    try { client.postMessage({ type: 'CACHE_TILES_PROGRESS', done, total }); } catch {}
    await new Promise(r => setTimeout(r, 40)); // polite rate limit
  }
  try { client.postMessage({ type: 'CACHE_TILES_DONE', cached, total }); } catch {}
}
