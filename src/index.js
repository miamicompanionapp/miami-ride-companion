// Workers entry point.
//
// This project deploys as a Worker with Static Assets (`wrangler deploy`), which
// — unlike Cloudflare Pages / `wrangler pages dev` — does NOT auto-route the
// `functions/` directory. Without this entry, /api/* returns 404 in production.
//
// So we route /api/* to the existing (Pages-style) function modules and hand
// everything else to the static-assets binding. `wrangler dev` and
// `wrangler deploy` now behave identically.
import * as claudeProxy from '../functions/api/claude-proxy.js';
import * as rssFetch from '../functions/api/rss-fetch.js';
import * as ticketmasterFetch from '../functions/api/ticketmaster-fetch.js';
import * as mbccFetch from '../functions/api/mbcc-fetch.js';
import * as bizcardStats from '../functions/api/bizcard-stats.js';
import * as beachAdvisoriesFetch from '../functions/api/beach-advisories-fetch.js';

import * as qrStats from '../functions/api/qr-stats.js';

const API_ROUTES = {
  '/api/claude-proxy': claudeProxy,
  '/api/rss-fetch': rssFetch,
  '/api/ticketmaster-fetch': ticketmasterFetch,
  '/api/mbcc-fetch': mbccFetch,
  '/api/bizcard-stats': bizcardStats,
  '/api/beach-advisories-fetch': beachAdvisoriesFetch,
  '/api/qr-stats': qrStats,
};

// Static (content.json-independent) QR redirect destinations.
const QR_STATIC_DESTS = {
  'app-soflo': 'https://soflo-vegan-eateries.miamivegan2026.workers.dev/',
  'app-lifeos': 'https://unalplanner.netlify.app/',
  'app-tend': 'https://tend-dma.pages.dev/',
};

// Mirrors the destination logic in openQR() (public/index.html) so the
// on-screen QR image can point at /qr/<type>/<id> instead of the raw
// destination — the raw hostname still shows as the preview text below the
// code, but the actual scan now round-trips through us so we can count it.
export function resolveQrDestination(type, id, content, origin) {
  if (type === 'app') return origin;
  if (QR_STATIC_DESTS[type]) return QR_STATIC_DESTS[type];
  if (!content) return null;

  if (type === 'venue') {
    const v = content.guide?.venues?.find((x) => x.id === id);
    if (!v) return null;
    return v.website || `https://maps.google.com/?q=${encodeURIComponent(v.address)}`;
  }
  if (type === 'event') {
    const e = content.guide?.events?.find((x) => x.id === id);
    return e?.url || null;
  }
  if (type === 'advisory') {
    const a = content.advisories?.items?.find((x) => x.id === id);
    return a?.sourceUrl || null;
  }
  if (type === 'driver-thumbtack') {
    return content.driver?.thumbtack?.url || null;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // /go  or  /go/:source  — business card redirect with per-source analytics
    if (pathname === '/go' || pathname.startsWith('/go/')) {
      const source = pathname.split('/')[2] || 'generic';
      try {
        const assetRes = await env.ASSETS.fetch(new Request(url.origin + '/content.json'));
        const data = await assetRes.json();
        const dest = data?.businessCard?.redirectUrl;
        if (env.BIZCARD_STATS) ctx.waitUntil(trackClick(env.BIZCARD_STATS, source));
        if (dest) return Response.redirect(dest, 302);
        return new Response('Business card redirect not configured', { status: 404 });
      } catch {
        return new Response('Error loading redirect', { status: 500 });
      }
    }

    // /qr/:type  or  /qr/:type/:id  — real QR-scan redirect + tracking.
    // The QR image encodes this URL (not the raw destination) so we can tell
    // an actual phone scan apart from someone just tapping the box open on
    // the tablet; the preview text under the code still shows the real
    // hostname (see openQR() in index.html), so nothing looks different to
    // the passenger.
    if (pathname.startsWith('/qr/')) {
      const [, , type, rawId] = pathname.split('/');
      const id = rawId ? decodeURIComponent(rawId) : null;
      let dest = null;
      try {
        const assetRes = await env.ASSETS.fetch(new Request(url.origin + '/content.json'));
        const content = await assetRes.json();
        dest = resolveQrDestination(type, id || null, content, url.origin);
      } catch {
        dest = resolveQrDestination(type, id || null, null, url.origin);
      }
      if (env.BIZCARD_STATS) ctx.waitUntil(trackQrScan(env.BIZCARD_STATS, type, id || null));
      if (dest) return Response.redirect(dest, 302);
      return new Response('QR destination not configured', { status: 404 });
    }

    const mod = API_ROUTES[pathname];

    if (mod) {
      // Pages-style handlers: onRequestGet / onRequestPost / onRequestOptions.
      const handler = mod[`onRequest${methodName(request.method)}`] || mod.onRequest;
      if (!handler) return new Response('Method Not Allowed', { status: 405 });
      return handler({ request, env, ctx });
    }

    // Not an API route — serve the static site (index.html, content.json, etc.).
    return env.ASSETS.fetch(request);
  },
};

function methodName(method) {
  const m = method.toLowerCase();
  return m.charAt(0).toUpperCase() + m.slice(1); // get -> Get, post -> Post, options -> Options
}

async function trackClick(kv, source) {
  const day = new Date().toISOString().slice(0, 10);
  await Promise.all([
    increment(kv, 'total'),
    increment(kv, 'src:' + source),
    increment(kv, 'day:' + day),
  ]);
}

async function increment(kv, key) {
  const val = parseInt(await kv.get(key) || '0');
  await kv.put(key, String(val + 1));
}

// Shares the BIZCARD_STATS KV binding under a 'qr:' key prefix rather than
// provisioning a second namespace — day/type/id counters are never deleted,
// so full history is preserved even though the dashboard only charts a
// recent window (see functions/api/qr-stats.js).
async function trackQrScan(kv, type, id) {
  const day = new Date().toISOString().slice(0, 10);
  const jobs = [
    increment(kv, 'qr:total'),
    increment(kv, 'qr:type:' + type),
    increment(kv, 'qr:day:' + day),
  ];
  if (id) jobs.push(increment(kv, 'qr:id:' + type + ':' + id));
  await Promise.all(jobs);
}
