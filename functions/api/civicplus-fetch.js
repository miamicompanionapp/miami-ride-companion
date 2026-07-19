// functions/api/civicplus-fetch.js
// Cloudflare Worker route (functions/api/*, routed via src/index.js) — fetches
// public community-events calendars from South Florida city governments that
// run the CivicPlus/CivicEngage CMS. That platform's own RSS module is broken
// (validates as RSS 2.0 but never emits <item> entries — confirmed on Boca
// Raton's myboca.us), but its iCalendar (.ics) export works reliably at:
//   https://<city-domain>/common/modules/iCalendar/iCalendar.aspx?catID=<CID>&feed=calendar
// CID is a numeric calendar-category id, visible in the city's own
// calendar.aspx?CID=<N> page — different CIDs on the same site are different
// calendar categories (e.g. "Special Events" vs. "City Council Meetings").
//
// Surveyed ~45 South Florida municipalities (2026-07-18) for a populated,
// non-meetings-only calendar CID. These 11 came back with real, usable
// community events (concerts, festivals, markets) rather than an empty feed
// or wall-to-wall board/commission meetings:
//
// GET /api/civicplus-fetch  →  { events: [...], errors: [...] }
// Each event matches the shape used by rss-fetch/ticketmaster-fetch/mbcc-fetch:
//   { title, description, url, date, venue, address, free, price, image, source }

const CITIES = [
  { name: 'Boca Raton',       domain: 'myboca.us',              catId: 27 },
  { name: 'Hollywood',        domain: 'hollywoodfl.org',         catId: 27 },
  { name: 'North Miami',      domain: 'northmiamifl.gov',        catId: 14 },
  { name: 'North Miami Beach',domain: 'citynmb.com',             catId: 14 },
  { name: 'Miami Gardens',    domain: 'miamigardens-fl.gov',     catId: 27 },
  { name: 'Hallandale Beach', domain: 'hallandalebeachfl.gov',   catId: 14 },
  { name: 'Homestead',        domain: 'homesteadfl.gov',         catId: 14 },
  { name: 'Boynton Beach',    domain: 'boynton-beach.org',       catId: 30 },
  { name: 'Oakland Park',     domain: 'oaklandparkfl.gov',       catId: 14 },
  { name: 'Deerfield Beach',  domain: 'deerfield-beach.com',     catId: 24 },
  { name: 'Opa-locka',        domain: 'opalockafl.gov',          catId: 24 },
];

// Some of these calendars mix real community events with administrative
// noise (closures, board/committee meetings, budget hearings) — filter titles
// that are clearly not something a passenger would attend.
const NOISE_TITLE_RE = /\b(city hall closed|offices? closed|closed in observance|holiday closure|board meeting|commission meeting|council meeting|public hearing|budget workshop|special master hearing|advisory (board|committee)|closed for the holiday)\b/i;

// Calendars sometimes list recurring entries a year+ out (e.g. a 2027 lecture
// series). Cap how far ahead we surface — matches the spirit of Ticketmaster's
// VIP_LOOKAHEAD_DAYS in ticketmaster-fetch.js.
const LOOKAHEAD_DAYS = 120;

// Some cities' calendars run to 50-100+ entries; cap what one city can
// contribute so no single source can crowd out everything else.
const MAX_PER_CITY = 25;

function icsUrl(city) {
  return `https://${city.domain}/common/modules/iCalendar/iCalendar.aspx?catID=${city.catId}&feed=calendar`;
}

// ─── Minimal iCalendar (RFC 5545) parser ────────────────────────────────────

// Folded lines: a continuation line starts with a single space or tab and
// should be joined to the previous line with that leading whitespace removed.
function unfoldICS(text) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeICSText(value) {
  return (value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

// DTSTART values look like "20260731T190000" or (all-day) "20260807" — the
// date is always the first 8 digits regardless of TZID/VALUE=DATE params.
function parseICSDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function parseICSLine(line) {
  const idx = line.indexOf(':');
  if (idx === -1) return null;
  const name = line.slice(0, idx).split(';')[0].toUpperCase();
  const value = line.slice(idx + 1);
  return { name, value };
}

// LOCATION is typically "Venue Name - Street, City FL Zip". Split on the
// first " - "; if there isn't one, treat the whole string as the venue.
function splitLocation(location) {
  if (!location) return { venue: '', address: '' };
  const idx = location.indexOf(' - ');
  if (idx === -1) return { venue: location.trim(), address: '' };
  return { venue: location.slice(0, idx).trim(), address: location.slice(idx + 3).trim() };
}

// Pure parser: ICS text in, mapped event objects out. No network — directly
// unit-testable against a fixture string (see tests/backend.spec.js).
function parseICS(icsText, city) {
  const lines = unfoldICS(icsText);
  const raw = [];
  let cur = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (trimmed === 'END:VEVENT') {
      if (cur && cur.SUMMARY) raw.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const parsed = parseICSLine(trimmed);
    if (!parsed) continue;
    if (parsed.name === 'SUMMARY') cur.SUMMARY = unescapeICSText(parsed.value);
    else if (parsed.name === 'DESCRIPTION') cur.DESCRIPTION = unescapeICSText(parsed.value);
    else if (parsed.name === 'LOCATION') cur.LOCATION = unescapeICSText(parsed.value);
    else if (parsed.name === 'DTSTART') cur.DTSTART = parseICSDate(parsed.value);
    else if (parsed.name === 'URL') cur.URL = parsed.value.trim();
  }

  return raw
    .filter(ev => !NOISE_TITLE_RE.test(ev.SUMMARY))
    .map(ev => {
      const { venue, address } = splitLocation(ev.LOCATION);
      return {
        title:       ev.SUMMARY,
        description: (ev.DESCRIPTION || '').slice(0, 400),
        url:         ev.URL || `https://${city.domain}/calendar.aspx?CID=${city.catId}`,
        date:        ev.DTSTART || '',
        venue:       venue || city.name,
        address,
        free:        false,
        price:       '',
        source:      city.name,
      };
    });
}

// ─── Past-event guard + lookahead cap ────────────────────────────────────────

function miamiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function dropPastEvents(events, today = miamiToday()) {
  return (events || []).filter(e => !e.date || e.date >= today);
}

function withinLookahead(events, today = miamiToday(), days = LOOKAHEAD_DAYS) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return (events || []).filter(e => !e.date || e.date <= cutoffStr);
}

// Sort soonest-first, then cap. Order matters here: daily-refresh.mjs dedupes
// by title+venue and keeps whichever occurrence it sees FIRST, so a recurring
// entry (e.g. "Live Music at Hollywood Beach Theatre" repeated nightly) needs
// its soonest date to win, not an arbitrary one from the feed's own ordering.
function sortAndCap(events, max = MAX_PER_CITY) {
  return [...events]
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
    .slice(0, max);
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
  const today = miamiToday();

  await Promise.allSettled(
    CITIES.map(async city => {
      try {
        const res = await fetch(icsUrl(city), {
          headers: { 'User-Agent': 'Miami-Ride-Companion/1.0 (iCalendar reader)' },
          // 6h edge cache — these are slow-moving municipal calendars, not
          // live feeds, and we don't want to hammer a dozen city sites daily.
          cf: { cacheEverything: true, cacheTtl: 21600 },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ics = await res.text();
        if (!/BEGIN:VCALENDAR/.test(ics)) throw new Error('response is not a valid iCalendar file');

        const parsed = parseICS(ics, city);
        const kept = sortAndCap(withinLookahead(dropPastEvents(parsed, today), today));

        // A calendar that returns a valid VCALENDAR envelope but zero usable
        // events (empty, or everything filtered as noise/past/too-far-out) is
        // the same failure mode we found on myboca.us's RSS module — surface
        // it as a warning so a silently-broken feed doesn't go unnoticed.
        if (kept.length === 0) throw new Error('parsed 0 usable events (feed may be empty or its format changed)');

        events.push(...kept);
      } catch (err) {
        errors.push(`${city.name}: ${err.message}`);
      }
    })
  );

  return new Response(JSON.stringify({ events, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Test-only exports (see tests/backend.spec.js) — harmless to the bundler.
export {
  CITIES,
  icsUrl,
  unfoldICS,
  unescapeICSText,
  parseICSDate,
  splitLocation,
  parseICS,
  dropPastEvents,
  withinLookahead,
  sortAndCap,
  miamiToday,
};
