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

const API_ROUTES = {
  '/api/claude-proxy': claudeProxy,
  '/api/rss-fetch': rssFetch,
  '/api/ticketmaster-fetch': ticketmasterFetch,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
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
