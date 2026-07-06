// functions/api/ticketmaster-fetch.js
// Cloudflare Worker route (functions/api/*, routed via src/index.js) — fetches
// upcoming South Florida events from the Ticketmaster Discovery API server-side,
// so the API key stays out of the browser.
// Set TICKETMASTER_KEY as an encrypted SECRET in:
//   Cloudflare Dashboard → your Worker → Settings → Variables and Secrets
// (Use a Secret, NOT a plain-text var — `wrangler deploy` on git push wipes
//  plain vars not declared in wrangler.jsonc, but Secrets persist. The Build
//  tab's variables are build-time only; the Worker never sees them.)
//
// GET /api/ticketmaster-fetch  →  { events: [...], errors: [...] }
// Each event matches the same shape as /api/rss-fetch:
//   { title, description, url, date, venue, address, free, price, image, lat, lng, source }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// All of South Florida — Abdullah's rideshare route runs Boca Raton down to
// Homestead, so we geo-filter by a center point + radius instead of a single
// city. (25.95, -80.20) sits around the Aventura/Hollywood line; a 45-mile
// radius reaches Boca Raton to the north and Homestead to the south.
// We pull a large page because Ticketmaster returns one row per showtime;
// after collapsing duplicate exhibitions/runs we keep only MAX_EVENTS distinct.
const TM_PARAMS = {
  latlong: '25.95,-80.20',
  radius: '45',
  unit: 'miles',
  sort: 'date,asc',
  size: '100',
  locale: '*',
};
const MAX_EVENTS = 25;

// Second "VIP" query — hunts for major Music events up to 90 days out.
// Sorted date,asc so the soonest upcoming show surfaces first, but the wider
// date window means arena-scale concerts (e.g. Shakira, Bad Bunny) aren't
// crowded out by this week's small shows in the main query.
// segmentId KZFzniwnSyZfZ7v7nJ = Music segment on Ticketmaster.
const TM_VIP_PARAMS = {
  latlong: '25.95,-80.20',
  radius: '45',
  unit: 'miles',
  sort: 'date,asc',
  size: '50',
  locale: '*',
  segmentId: 'KZFzniwnSyZfZ7v7nJ',
};
const VIP_LOOKAHEAD_DAYS = 90;

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
          'TICKETMASTER_KEY is not set. Add it as an encrypted Secret in Cloudflare Dashboard → your Worker → Settings → Variables and Secrets (use your app\'s Consumer Key from developer.ticketmaster.com).',
      },
      500
    );
  }

  // Only upcoming events. Ticketmaster wants ISO without milliseconds.
  const now = new Date();
  const startDateTime = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  // VIP query end date: 90 days out.
  const vipEnd = new Date(now);
  vipEnd.setDate(vipEnd.getDate() + VIP_LOOKAHEAD_DAYS);
  const endDateTime = vipEnd.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const mainParams = new URLSearchParams({ ...TM_PARAMS,     apikey: apiKey, startDateTime });
  const vipParams  = new URLSearchParams({ ...TM_VIP_PARAMS, apikey: apiKey, startDateTime, endDateTime });
  const BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

  const errors = [];
  const [mainRes, vipRes] = await Promise.allSettled([
    fetch(`${BASE}?${mainParams}`, { cf: { cacheEverything: true, cacheTtl: 1800 } }),
    fetch(`${BASE}?${vipParams}`,  { cf: { cacheEverything: true, cacheTtl: 1800 } }),
  ]);

  const rawEvents = [];
  for (const [result, label] of [[mainRes, 'main'], [vipRes, 'vip']]) {
    if (result.status === 'rejected') {
      errors.push(`Ticketmaster ${label}: ${result.reason?.message}`);
      continue;
    }
    if (!result.value.ok) {
      errors.push(`Ticketmaster ${label}: HTTP ${result.value.status}`);
      continue;
    }
    try {
      const data = await result.value.json();
      rawEvents.push(...(data?._embedded?.events || []));
    } catch (err) {
      errors.push(`Ticketmaster ${label} parse: ${err.message}`);
    }
  }

  if (rawEvents.length === 0 && errors.length) {
    return json({ events: [], errors });
  }

  // Ticketmaster returns one entry per showtime, so a multi-day exhibition
  // (e.g. "Balloon Museum") appears many times. Collapse to one entry per
  // name+venue across both queries. Results are sorted date,asc within each
  // query so the first seen is the soonest.
  const seen = new Set();
  const events = [];
  for (const ev of rawEvents.map(mapEvent)) {
    if (!ev.title) continue;
    const key = `${ev.title}|${ev.venue}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(ev);
    if (events.length >= MAX_EVENTS * 2) break; // combined cap — AI review trims further
  }
  return json({ events, errors });
}

// Ticketmaster returns an images[] array at several ratios/sizes. Prefer a
// wide 16:9 image around card size (~640px) for a clean banner; otherwise take
// the widest available, then whatever's first.
function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return '';
  const wide = images
    .filter(im => im?.url && (im.ratio === '16_9' || !im.ratio))
    .sort((a, b) => Math.abs((a.width || 0) - 640) - Math.abs((b.width || 0) - 640));
  if (wide.length) return wide[0].url;
  const widest = [...images].filter(im => im?.url).sort((a, b) => (b.width || 0) - (a.width || 0));
  return widest[0]?.url || '';
}

// Ticketmaster's own segment/genre already tells us the category — using it
// beats guessing from the title (which used to default everything unmatched
// to "music", mislabeling exhibits, family days, and wellness events).
// segment/genre names seen in the wild: Music, Sports, Arts & Theatre, Film,
// Miscellaneous, Undefined; genre "Comedy" nests under Arts & Theatre.
function mapCategory(cls) {
  const segment = (cls?.segment?.name || '').toLowerCase();
  const genre    = (cls?.genre?.name  || '').toLowerCase();
  if (genre === 'comedy') return 'comedy';
  if (segment === 'music') return 'music';
  if (segment === 'sports') return 'sports';
  if (segment === 'arts & theatre' || segment === 'film') return 'arts';
  if (segment === 'miscellaneous' || segment === 'undefined' || !segment) return '';
  return '';
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
  const category = mapCategory(cls);
  const startTime = ev?.dates?.start?.localTime
    ? ev.dates.start.localTime.slice(0, 5)
    : '';
  const descParts = [
    ev?.info || ev?.pleaseNote || clsBits.join(' · '),
    startTime ? `Starts ${startTime}` : '',
    venue?.name || '',
  ].filter(Boolean);

  // Price: free if a 0 minimum is reported, else the lowest min as "$N".
  const mins = Array.isArray(ev?.priceRanges)
    ? ev.priceRanges.map(p => p?.min).filter(n => typeof n === 'number')
    : [];
  const minPrice = mins.length ? Math.min(...mins) : null;
  const free = minPrice === 0;
  const price = (minPrice && minPrice > 0) ? '$' + Math.round(minPrice) : '';

  // Venue coordinates come straight from the API → passenger app shows distance.
  const lat = parseFloat(venue?.location?.latitude);
  const lng = parseFloat(venue?.location?.longitude);

  return {
    title:       (ev?.name || '').trim(),
    description: descParts.join(' · ').slice(0, 400),
    url:         ev?.url || '',
    date:        ev?.dates?.start?.localDate || '',
    venue:       (venue?.name || '').trim(),
    address:     addressBits.join(', '),
    price,
    lat:         Number.isFinite(lat) ? lat : undefined,
    lng:         Number.isFinite(lng) ? lng : undefined,
    free,
    image:       pickImage(ev?.images),
    source:      'Ticketmaster',
    category:    category || undefined,
  };
}

// Test-only exports (see tests/backend.spec.js) — harmless to the bundler.
export { mapEvent, pickImage, mapCategory };
