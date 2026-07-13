// functions/api/beach-advisories-fetch.js
// Cloudflare Worker route (functions/api/*, routed via src/index.js) — fetches
// current Enterococcus bacteria advisory status for Miami-Dade beaches.
//
// Source: floridahealthybeaches.com, a public front-end for the Florida
// Department of Health's Healthy Beaches sampling program. The page is
// Next.js SSG — the full dataset ships as JSON in a <script id="__NEXT_DATA__">
// tag, so we parse that JSON directly instead of scraping rendered card HTML
// (confirmed 2026-07-13: far more stable than markup scraping like mbcc-fetch.js
// has to do — this site hands us structured data for free).
//
// `advisoryStatus` (not `enterococcusStatus`, which reflects only the latest
// single sample against the threshold) is the field that reflects the
// county health department's actual persistent advisory state — a beach can
// show enterococcusStatus "Good" on its most recent single sample while
// advisoryStatus stays "Yes" until a clean resample clears it.
//
// GET /api/beach-advisories-fetch  →  { beaches: [...], errors: [...] }
// Each beach: { name, slug, status: 'advisory'|'good', value, sampleDate,
//               updatedAt, url, lat, lng }

const BASE_URL = 'https://www.floridahealthybeaches.com';
const COUNTY_PATH = '/county/dade';

function parseSampleDate(mdY) {
  // "7/8/2026" → "2026-07-08"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdY || '');
  if (!m) return '';
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Parses the county page's embedded __NEXT_DATA__ JSON into beach status rows.
// Pure function — no network — directly unit-testable against saved markup.
function parseBeachAdvisories(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const beaches = data?.props?.pageProps?.county?.beaches;
  if (!Array.isArray(beaches)) return [];

  return beaches.map(b => {
    const latest = Array.isArray(b.data) ? b.data[0] : null;
    return {
      name:       b.name || '',
      slug:       b.slug || '',
      status:     latest?.advisoryStatus === 'Yes' ? 'advisory' : 'good',
      value:      latest ? Number(latest.enterococcusValue) : null,
      sampleDate: parseSampleDate(latest?.sampleDate),
      updatedAt:  latest?.updatedAt || '',
      url:        b.slug ? `${BASE_URL}${COUNTY_PATH}/beach/${b.slug}` : `${BASE_URL}${COUNTY_PATH}`,
      lat:        latest?.latitude  != null ? Number(latest.latitude)  : null,
      lng:        latest?.longitude != null ? Number(latest.longitude) : null,
    };
  }).filter(b => b.name);
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
  const errors = [];
  let beaches = [];

  try {
    const res = await fetch(`${BASE_URL}${COUNTY_PATH}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Miami-Ride-Companion/1.0',
        'Accept': 'text/html',
      },
      // Sampling is roughly twice a month per beach — cache at the edge for a
      // few hours so a burst of app opens doesn't hammer the source site.
      cf: { cacheEverything: true, cacheTtl: 10800 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    beaches = parseBeachAdvisories(html);
    if (!beaches.length) errors.push('parsed 0 beaches — page structure may have changed');
  } catch (err) {
    errors.push(`beach-advisories: ${err.message}`);
  }

  return new Response(JSON.stringify({ beaches, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Test-only exports (see tests/backend.spec.js) — harmless to the bundler.
export { parseBeachAdvisories, parseSampleDate };
