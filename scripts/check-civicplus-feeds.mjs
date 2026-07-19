#!/usr/bin/env node
/**
 * Live health check for the CivicPlus city-calendar iCalendar feeds that
 * functions/api/civicplus-fetch.js depends on (see that file for background
 * on why the .ics export is used instead of these sites' broken RSS module).
 *
 * Fetches each configured city's REAL .ics URL directly — deliberately not
 * through our own deployed Worker — so a failure here means "a city changed
 * their site," not "our own deploy is down." Exits non-zero if any confirmed
 * city stops returning usable, future-dated events, so a scheduled CI run
 * (.github/workflows/civicplus-health.yml) turns that into a fast, visible
 * red X + GitHub failure notification instead of a silently empty feed.
 *
 * Run locally: node scripts/check-civicplus-feeds.mjs
 */

// Keep this list in sync with CITIES in functions/api/civicplus-fetch.js.
// Duplicated rather than imported: that file uses Cloudflare's ESM `export`
// syntax, which plain Node (no "type": "module" in package.json, .js not
// .mjs) can't import directly — same reason miamiToday() is duplicated
// across rss-fetch.js/mbcc-fetch.js/daily-refresh.mjs in this repo already.
const CITIES = [
  { name: 'Boca Raton',        domain: 'myboca.us',              catId: 27 },
  { name: 'Hollywood',         domain: 'hollywoodfl.org',         catId: 27 },
  { name: 'North Miami',       domain: 'northmiamifl.gov',        catId: 14 },
  { name: 'North Miami Beach', domain: 'citynmb.com',             catId: 14 },
  { name: 'Miami Gardens',     domain: 'miamigardens-fl.gov',     catId: 27 },
  { name: 'Hallandale Beach',  domain: 'hallandalebeachfl.gov',   catId: 14 },
  { name: 'Homestead',         domain: 'homesteadfl.gov',         catId: 14 },
  { name: 'Boynton Beach',     domain: 'boynton-beach.org',       catId: 30 },
  { name: 'Oakland Park',      domain: 'oaklandparkfl.gov',       catId: 14 },
  { name: 'Deerfield Beach',   domain: 'deerfield-beach.com',     catId: 24 },
  { name: 'Opa-locka',         domain: 'opalockafl.gov',          catId: 24 },
];

function icsUrl(city) {
  return `https://${city.domain}/common/modules/iCalendar/iCalendar.aspx?catID=${city.catId}&feed=calendar`;
}

function miamiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Minimal, deliberately independent of parseICS() in civicplus-fetch.js —
// this check exists to catch drift in the UPSTREAM feed shape, so it
// shouldn't share a parser with the code whose correctness it's guarding.
function countFutureEvents(ics, today) {
  if (!/BEGIN:VCALENDAR/.test(ics)) return { valid: false, total: 0, future: 0 };
  const dtstarts = [...ics.matchAll(/^DTSTART[^:\r\n]*:(\d{8})/gm)].map(m => m[1]);
  const dates = dtstarts.map(d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  return {
    valid: true,
    total: dates.length,
    future: dates.filter(d => d >= today).length,
  };
}

async function checkCity(city, today) {
  const url = icsUrl(city);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Miami-Ride-Companion/1.0 (civicplus-health-check)' },
    });
    if (!res.ok) return { city: city.name, ok: false, reason: `HTTP ${res.status}` };
    const ics = await res.text();
    const { valid, total, future } = countFutureEvents(ics, today);
    if (!valid) return { city: city.name, ok: false, reason: 'response is not a valid iCalendar file (BEGIN:VCALENDAR missing) — site structure likely changed' };
    if (total === 0) return { city: city.name, ok: false, reason: 'valid iCalendar envelope but zero VEVENTs — feed is empty' };
    if (future === 0) return { city: city.name, ok: false, reason: `${total} VEVENT(s) found but none dated today or later — feed may be stale` };
    return { city: city.name, ok: true, reason: `${future} upcoming event(s) (of ${total} total)` };
  } catch (err) {
    return { city: city.name, ok: false, reason: `fetch failed: ${err.message}` };
  }
}

async function main() {
  const today = miamiToday();
  console.log(`\n=== CivicPlus feed health check — ${today} ===\n`);

  const results = await Promise.all(CITIES.map(city => checkCity(city, today)));

  let failures = 0;
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.city.padEnd(20)} ${r.reason}`);
    if (!r.ok) failures++;
  }

  console.log(`\n${results.length - failures}/${results.length} feeds healthy.\n`);

  if (failures > 0) {
    console.error(`${failures} feed(s) broken — a city likely changed their site. Update functions/api/civicplus-fetch.js (and this script's CITIES list) to match.`);
    process.exitCode = 1;
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
