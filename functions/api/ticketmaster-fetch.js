// functions/api/ticketmaster-fetch.js
// Cloudflare Pages Function — fetches upcoming Miami events from the
// Ticketmaster Discovery API server-side, so the API key stays out of the
// browser. Set TICKETMASTER_KEY in:
//   Cloudflare Dashboard → Pages → your project → Settings → Environment Variables
//
// GET /api/ticketmaster-fetch  →  { events: [...], errors: [...] }
// Each event matches the same shape as /api/rss-fetch:
//   { title, description, url, date, venue, address, free, source }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Greater Miami — city filter keeps it simple and reliable. We pull a large
// page because Ticketmaster returns one row per showtime; after collapsing
// duplicate exhibitions/runs we keep only MAX_EVENTS distinct events.
const TM_PARAMS = {
  city: 'Miami',
  sort: 'date,asc',
  size: '100',
  locale: '*',
};
const MAX_EVENTS = 25;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ env }) {
  const apiKey = env.TICKETMASTER_KEY;
  if (!apiKey) {
    return json(
      {
        error:
          'TICKETMASTER_KEY is not set. Add it in Cloudflare Dashboard → Pages → your project → Settings → Environment Variables (use your app\'s Consumer Key from developer.ticketmaster.com).',
      },
      500
    );
  }

  // Only upcoming events. Ticketmaster wants ISO without milliseconds.
  const startDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const params = new URLSearchParams({ ...TM_PARAMS, apikey: apiKey, startDateTime });
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;

  const errors = [];
  try {
    const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 1800 } });
    if (!res.ok) {
      // Surface a useful message without leaking the key (it's only in the query we built).
      throw new Error(`Ticketmaster HTTP ${res.status}`);
    }
    const data = await res.json();
    const tmEvents = data?._embedded?.events || [];

    // Ticketmaster returns one entry per showtime, so a multi-day exhibition
    // (e.g. "Balloon Museum") appears many times. Collapse to one entry per
    // name+venue. Results are sorted date,asc so the first seen is the soonest.
    const seen = new Set();
    const events = [];
    for (const ev of tmEvents.map(mapEvent)) {
      if (!ev.title) continue;
      const key = `${ev.title}|${ev.venue}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
      if (events.length >= MAX_EVENTS) break;
    }
    return json({ events, errors });
  } catch (err) {
    errors.push(`Ticketmaster: ${err.message}`);
    return json({ events: [], errors });
  }
}

function mapEvent(ev) {
  const venue = ev?._embedded?.venues?.[0] || {};
  const addressBits = [
    venue?.address?.line1,
    venue?.city?.name,
    venue?.state?.stateCode,
  ].filter(Boolean);

  // Ticketmaster events rarely carry a prose description — build a short,
  // useful line from info/pleaseNote or the classification (segment · genre).
  const cls = ev?.classifications?.[0] || {};
  const clsBits = [cls?.segment?.name, cls?.genre?.name]
    .filter(Boolean)
    .filter(v => v.toLowerCase() !== 'undefined');
  const startTime = ev?.dates?.start?.localTime
    ? ev.dates.start.localTime.slice(0, 5)
    : '';
  const descParts = [
    ev?.info || ev?.pleaseNote || clsBits.join(' · '),
    startTime ? `Starts ${startTime}` : '',
    venue?.name || '',
  ].filter(Boolean);

  // Treat as free only if Ticketmaster explicitly reports a 0 minimum price.
  const free = Array.isArray(ev?.priceRanges)
    ? ev.priceRanges.some(p => p?.min === 0)
    : false;

  return {
    title:       (ev?.name || '').trim(),
    description: descParts.join(' · ').slice(0, 400),
    url:         ev?.url || '',
    date:        ev?.dates?.start?.localDate || '',
    venue:       venue?.name || '',
    address:     addressBits.join(', '),
    free,
    source:      'Ticketmaster',
  };
}
