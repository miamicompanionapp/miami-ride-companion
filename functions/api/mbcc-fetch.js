// functions/api/mbcc-fetch.js
// Cloudflare Worker route (functions/api/*, routed via src/index.js) — scrapes
// the Miami Beach Convention Center's public events calendar server-side.
// No RSS/JSON feed exists (confirmed 2026-07-13); the calendar is plain
// server-rendered HTML (Drupal), so we parse it directly instead.
//
// Why this source exists: Florida Supercon 2026 (self-ticketed via its own
// site, not Ticketmaster) never appeared in our events pipeline because
// Ticketmaster doesn't sell its tickets and the RSS blogs didn't cover it in
// time. Conventions/expos at MBCC are consistently missed by our other two
// sources, so this scrapes the venue directly.
//
// GET /api/mbcc-fetch  →  { events: [...], errors: [...] }
// Each event matches the shape used by /api/rss-fetch and /api/ticketmaster-fetch:
//   { title, description, url, date, venue, address, free, price, image, lat, lng, source }

const BASE_URL = 'https://www.miamibeachconvention.com';
const EVENTS_PATH = '/events';

// Single fixed venue — no per-event geocoding needed.
// (1901 Convention Center Drive, Miami Beach, FL 33139 — via Nominatim, 2026-07-13.)
const VENUE = 'Miami Beach Convention Center';
const ADDRESS = '1901 Convention Center Drive, Miami Beach, FL 33139';
const LAT = 25.7955257;
const LNG = -80.1335150;

// The calendar lists events chronologically, 6 per page. Two pages (12 events)
// comfortably covers a few months out without hammering the site — it 403'd
// us once during manual testing under back-to-back requests with no delay.
const PAGES_TO_FETCH = 2;

function decodeEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripHtml(html) {
  return decodeEntities((html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Parses one events-listing page's HTML into raw event rows. Pure function —
// no network — so it's directly unit-testable against a saved HTML fixture.
function parseMbccPage(html) {
  const events = [];
  const articleRe = /<article\b([^>]*data-detype="event"[^>]*)>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = articleRe.exec(html)) !== null) {
    const [, attrs, block] = m;

    const nameAttr = attrs.match(/data-dename="([^"]*)"/);
    const title = decodeEntities(nameAttr ? nameAttr[1] : '');
    if (!title) continue;

    // First date in the date-summary block is the start date (MM/DD/YYYY).
    const dateMatch = block.match(/class="date">(\d{2})\/(\d{2})\/(\d{4})</);
    const date = dateMatch ? `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}` : '';

    const linkMatch = block.match(/field--name-field-display-title[\s\S]*?<a href="([^"]+)"/);
    const url = linkMatch ? new URL(linkMatch[1], BASE_URL).href : '';

    const descMatch = block.match(/field--name-body[\s\S]*?<p>([\s\S]*?)<\/p>/);
    const description = descMatch ? stripHtml(descMatch[1]).slice(0, 400) : '';

    const imgMatch = block.match(/<img[^>]*\bsrc="([^"]+)"/);
    const image = imgMatch ? new URL(imgMatch[1], BASE_URL).href : '';

    events.push({
      title,
      description,
      url,
      date,
      venue:   VENUE,
      address: ADDRESS,
      free:    false,
      price:   '',
      image,
      lat: LAT,
      lng: LNG,
      source: 'Miami Beach Convention Center',
    });
  }
  return events;
}

// ─── Past-event guard ────────────────────────────────────────────────────────
function miamiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function dropPastEvents(events, today = miamiToday()) {
  return (events || []).filter(e => !e.date || e.date >= today);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet() {
  const events = [];
  const errors = [];

  for (let page = 0; page < PAGES_TO_FETCH; page++) {
    try {
      const res = await fetch(`${BASE_URL}${EVENTS_PATH}?page=${page}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Miami-Ride-Companion/1.0',
          'Accept': 'text/html',
        },
        // Cache at the Cloudflare edge for 6 hours — this is a slow-moving
        // convention calendar, not a live feed, and the site rate-limits us.
        cf: { cacheEverything: true, cacheTtl: 21600 },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} (page ${page})`);
      const html = await res.text();
      events.push(...parseMbccPage(html));
    } catch (err) {
      errors.push(`MBCC page ${page}: ${err.message}`);
      break; // stop paginating on first failure — later pages are unlikely to work either
    }
  }

  return new Response(JSON.stringify({ events: dropPastEvents(events), errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Test-only exports (see tests/backend.spec.js) — harmless to the bundler.
export { parseMbccPage, dropPastEvents, miamiToday };
