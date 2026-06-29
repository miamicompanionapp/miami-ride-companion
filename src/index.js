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
import * as bizcardStats from '../functions/api/bizcard-stats.js';

const API_ROUTES = {
  '/api/claude-proxy': claudeProxy,
  '/api/rss-fetch': rssFetch,
  '/api/ticketmaster-fetch': ticketmasterFetch,
  '/api/bizcard-stats': bizcardStats,
};

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
