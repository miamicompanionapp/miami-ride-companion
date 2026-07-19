#!/usr/bin/env node
/**
 * Daily events + weather refresh for Miami Ride Companion.
 * Called by .github/workflows/daily-refresh.yml every morning.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY  — Claude API key for AI review + translation
 *   WORKER_URL         — deployed Cloudflare Worker base URL
 *                        e.g. https://miami-ride-companion.metrekare.workers.dev
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_PATH    = join(__dirname, '../public/content.json');
const CACHE_PATH      = join(__dirname, 'review-cache.json');

const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!WORKER_URL)        { console.error('WORKER_URL is required');        process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is required'); process.exit(1); }

// Log Worker hostname so we can confirm the secret is correct in Actions logs.
try { console.log(`  Worker: ${new URL(WORKER_URL).hostname}`); } catch { /* invalid URL — fetch will fail */ }

// ── Helpers ───────────────────────────────────────────────────────────────────

function miamiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function miamiHour() {
  // Parse "6/23/2026, 08:00:00 AM" → hour integer, Miami time.
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
}

function genId(prefix) {
  return prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

async function callClaude(prompt, maxTokens = 4096) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object found in Claude response');
  return m[0];
}

// ── Event category inference ──────────────────────────────────────────────────

// Ticketmaster's own description often starts with its segment/genre
// classification text (e.g. "Music · Hip-Hop · Starts 20:00 · Kaseya Center"
// — see ticketmaster-fetch.js's mapEvent/mapCategory, the ground-truth source
// for *new* fetches). This mirrors that mapping for events whose description
// still carries the raw classification prefix.
function fromDescriptionSegment(desc) {
  const m = /^(Music|Sports|Arts & Theatre|Film|Miscellaneous|Undefined)\s*(?:·\s*([^·]+))?/i.exec(desc || '');
  if (!m) return null;
  const segment = m[1].toLowerCase();
  const genre = (m[2] || '').trim().toLowerCase();
  if (genre === 'comedy') return 'comedy';
  if (segment === 'music') return 'music';
  if (segment === 'sports') return 'sports';
  if (segment === 'arts & theatre' || segment === 'film') return 'arts';
  return null; // Miscellaneous/Undefined/absent — fall through to keyword rules
}

// Rules whose trigger words are prone to matching a VENUE'S proper name
// (e.g. "Jackie Gleason Theater" hosting a concert, "LIV Nightclub" hosting a
// DJ set) are checked against the TITLE only, so a venue name embedded in the
// description can't misclassify an otherwise-plain event.
const TITLE_ONLY_RULES = [
  { cat: 'nightlife',  re: /nightclub|afterparty|after party|welcome to destruction|off campus night|timelux/i },
  { cat: 'arts',       re: /museum|gallery|theatre|theater|ballet|opera|classical|cinema|wizard of oz|basquiat|pop air|jagged little pill|art walk|tony award/i },
];
// These keywords are safe to match against the full title+description text —
// checked against title + description together since RSS titles are often
// bare event names (e.g. "5LAN in Miami") with the actual genre signal
// ("DJ", "Live") only in the blurb.
const FULL_TEXT_RULES = [
  { cat: 'comedy',     re: /comedy|improv|comic show|one-man-show|storyteller|stand-up\b/i },
  { cat: 'sports',     re: /world cup|soccer|match day|fan fest|watch party|match \d+|kickoff pool|summer of soccer|michael irvin|el pibe|marathon|5k\b|run club|pickleball|wrestl|marlins|dolphins|\bmlb\b|\bnba\b|\bnfl\b|\bnhl\b/i },
  { cat: 'arts',       re: /exhibit|screening/i },
  { cat: 'food-drink', re: /brunch|swizzle|deli lane|pop.?up.*drink|rum bar|bloom.*caf|bloom.*restau|paella|cooking class|byob/i },
  { cat: 'community',  re: /market|artisan|fair\b|festival(?!.*(music|concert))|pilates|yoga|meditation|wellness|paws|pet friendly|dog park|family day|back to school/i },
  { cat: 'music',      re: /concert|tour\b|\blive\b|the tour|world tour|orchestra|\bband\b|sings?|\bdj\b|festival.*(music|concert)|jazz/i },
];

// Anything that doesn't match a specific signal above used to silently default
// to 'music' — which is wrong for things like art exhibits, pet meetups, or
// wellness classes that slip past the regexes. Ticketmaster is a ticketed
// concert/sports/arts platform, so an unclassified listing there (no segment,
// no keyword match — usually a bare artist name) is overwhelmingly a concert,
// so 'tm_' events default to 'music'. RSS blogs/listicles have no such bias,
// so 'rss_'/'manual_' events get the honest 'community' catch-all instead.
function inferEventCategory(e) {
  const title = e.title?.en || '';
  const desc = e.description?.en || '';
  const segCat = fromDescriptionSegment(desc);
  if (segCat) return segCat;
  for (const { cat, re } of TITLE_ONLY_RULES) if (re.test(title)) return cat;
  const fullText = `${title} ${desc}`;
  for (const { cat, re } of FULL_TEXT_RULES) if (re.test(fullText)) return cat;
  return e.id.startsWith('tm_') ? 'music' : 'community';
}

// ── Weather ───────────────────────────────────────────────────────────────────

const WD = {
  0:  { en: 'Clear skies',        es: 'Cielo despejado',      pt: 'Céu limpo',            fr: 'Ciel dégagé' },
  1:  { en: 'Mainly clear',       es: 'Mayormente despejado', pt: 'Principalmente limpo',  fr: 'Principalement dégagé' },
  2:  { en: 'Partly cloudy',      es: 'Parcialmente nublado', pt: 'Parcialmente nublado',  fr: 'Partiellement nuageux' },
  3:  { en: 'Overcast',           es: 'Nublado',              pt: 'Encoberto',             fr: 'Couvert' },
  45: { en: 'Foggy',              es: 'Neblina',              pt: 'Nevoeiro',              fr: 'Brumeux' },
  48: { en: 'Icy fog',            es: 'Niebla helada',        pt: 'Nevoeiro gelado',       fr: 'Brouillard givrant' },
  51: { en: 'Light drizzle',      es: 'Llovizna ligera',      pt: 'Chuvisco leve',         fr: 'Bruine légère' },
  61: { en: 'Light rain',         es: 'Lluvia ligera',        pt: 'Chuva leve',            fr: 'Pluie légère' },
  63: { en: 'Moderate rain',      es: 'Lluvia moderada',      pt: 'Chuva moderada',        fr: 'Pluie modérée' },
  65: { en: 'Heavy rain',         es: 'Lluvia intensa',       pt: 'Chuva forte',           fr: 'Pluie forte' },
  71: { en: 'Light snow',         es: 'Nieve ligera',         pt: 'Neve leve',             fr: 'Neige légère' },
  80: { en: 'Rain showers',       es: 'Chubascos',            pt: 'Aguaceiros',            fr: 'Averses' },
  81: { en: 'Moderate showers',   es: 'Chubascos moderados',  pt: 'Aguaceiros moderados',  fr: 'Averses modérées' },
  95: { en: 'Thunderstorm',       es: 'Tormenta eléctrica',   pt: 'Trovoada',              fr: 'Orage' },
  99: { en: 'Heavy thunderstorm', es: 'Tormenta intensa',     pt: 'Trovoada intensa',      fr: 'Orage violent' },
};
function getDesc(code) {
  return WD[code] || WD[Math.floor(code / 10) * 10]
    || { en: 'Partly cloudy', es: 'Parcialmente nublado', pt: 'Parcialmente nublado', fr: 'Partiellement nuageux' };
}

async function refreshWeather(content) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=25.7617&longitude=-80.1918'
    + '&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m,apparent_temperature'
    + '&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max'
    + '&hourly=temperature_2m,weathercode,precipitation_probability'
    + '&temperature_unit=fahrenheit&wind_speed_unit=mph'
    + '&timezone=America%2FNew_York&forecast_days=5';

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();

  const c = data.current;
  const d = data.daily;
  const hour = miamiHour();
  const now = new Date();

  content.weather = {
    fetchedAt: now.toISOString(),
    current: {
      temp_f:      Math.round(c.temperature_2m),
      feels_f:     Math.round(c.apparent_temperature),
      description: { en: 'Current conditions', es: 'Condiciones actuales', pt: 'Condições atuais', fr: 'Conditions actuelles' },
      humidity:    Math.round(c.relative_humidity_2m),
      wind_mph:    Math.round(c.windspeed_10m),
      rain_chance: d.precipitation_probability_max[0] || 0,
      weathercode: c.weathercode,
    },
    forecast: d.time.slice(0, 5).map((date, i) => ({
      date,
      high_f:      Math.round(d.temperature_2m_max[i]),
      low_f:       Math.round(d.temperature_2m_min[i]),
      weathercode: d.weathercode[i],
      rain_chance: d.precipitation_probability_max[i],
      description: getDesc(d.weathercode[i]),
    })),
    // Next 24 hours starting from current Miami hour.
    // Open-Meteo returns hourly times as "YYYY-MM-DDTHH:MM" (Miami TZ when timezone param is set),
    // so we slice directly from the string rather than parsing as a Date to avoid UTC offset issues.
    hourly: data.hourly.time.slice(hour, hour + 24).map((t, i) => ({
      hour:        t.slice(11, 16),
      temp_f:      Math.round(data.hourly.temperature_2m[hour + i]),
      weathercode: data.hourly.weathercode[hour + i],
      rain_chance: data.hourly.precipitation_probability[hour + i],
    })),
  };

  console.log(`  weather: ${content.weather.current.temp_f}°F, code ${content.weather.current.weathercode}`);
}

// ── Advisories (beach water quality + NWS weather/safety alerts) ──────────────
// All items get a hard 24h expiresAt so a missed daily-refresh run can never
// leave a stale advisory showing in the app — the client re-checks this on
// every render, it doesn't just trust that content.json was refreshed today.
const ADVISORY_TTL_MS = 24 * 60 * 60 * 1000;

// Water quality copy is a fixed template (beach name + CFU value are the only
// variables), so it's hand-translated once here rather than round-tripped
// through Claude on every run like event descriptions are.
function beachAdvisoryItem(beach, fetchedAt) {
  return {
    id:         `beach_${beach.slug || beach.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    type:       'water_quality',
    severity:   'advisory',
    title: {
      en: `${beach.name} — Water Quality Advisory`,
      es: `${beach.name} — Aviso de Calidad del Agua`,
      pt: `${beach.name} — Aviso de Qualidade da Água`,
      fr: `${beach.name} — Avis de Qualité de l'Eau`,
    },
    detail: {
      en: `Elevated Enterococcus bacteria detected (${beach.value} CFU/100mL, sampled ${beach.sampleDate}). Health officials advise against swimming here until levels return to normal.`,
      es: `Se detectaron niveles elevados de bacterias Enterococcus (${beach.value} UFC/100mL, muestreado el ${beach.sampleDate}). Las autoridades de salud recomiendan no nadar aquí hasta que los niveles vuelvan a la normalidad.`,
      pt: `Foram detectados níveis elevados de bactérias Enterococcus (${beach.value} UFC/100mL, amostrado em ${beach.sampleDate}). As autoridades de saúde recomendam não nadar aqui até que os níveis voltem ao normal.`,
      fr: `Des niveaux élevés de bactéries Enterococcus ont été détectés (${beach.value} UFC/100mL, échantillonné le ${beach.sampleDate}). Les autorités sanitaires déconseillent de se baigner ici tant que les niveaux ne reviennent pas à la normale.`,
    },
    source:      'Florida Dept. of Health — Healthy Beaches',
    sourceUrl:   beach.url,
    effectiveAt: beach.sampleDate,
    expiresAt:   new Date(fetchedAt.getTime() + ADVISORY_TTL_MS).toISOString(),
  };
}

async function refreshBeachAdvisories(content, fetchedAt) {
  const res = await fetch(WORKER_URL + '/api/beach-advisories-fetch');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { beaches, errors } = await res.json();
  if (errors?.length) console.warn('  [beach-advisories] warnings:', errors.join('; '));
  const advisories = (beaches || []).filter(b => b.status === 'advisory');
  console.log(`  beach advisories: ${advisories.length} active (of ${beaches?.length || 0} monitored)`);
  return advisories.map(b => beachAdvisoryItem(b, fetchedAt));
}

// Small set of recurring South Florida hazard types — translated once here so
// weather items don't need a Claude round-trip just for the title badge.
// Anything not in this list falls back to the English NWS event name in every
// language (aL() on the client also falls back to .en for any missing key).
const NWS_EVENT_NAMES = {
  'Rip Current Statement':        { en: 'Rip Current Statement',        es: 'Aviso de Corrientes de Resaca',      pt: 'Aviso de Correntes de Retorno',       fr: 'Avis de Courants de Baïn' },
  'Coastal Flood Advisory':       { en: 'Coastal Flood Advisory',       es: 'Aviso de Inundación Costera',        pt: 'Aviso de Inundação Costeira',         fr: "Avis d'Inondation Côtière" },
  'Coastal Flood Warning':        { en: 'Coastal Flood Warning',        es: 'Alerta de Inundación Costera',       pt: 'Alerta de Inundação Costeira',        fr: "Alerte d'Inondation Côtière" },
  'Heat Advisory':                { en: 'Heat Advisory',                es: 'Aviso de Calor',                     pt: 'Aviso de Calor',                      fr: 'Avis de Chaleur' },
  'Excessive Heat Warning':       { en: 'Excessive Heat Warning',       es: 'Alerta de Calor Extremo',            pt: 'Alerta de Calor Extremo',             fr: 'Alerte de Chaleur Extrême' },
  'Small Craft Advisory':         { en: 'Small Craft Advisory',         es: 'Aviso para Embarcaciones Pequeñas',  pt: 'Aviso para Pequenas Embarcações',     fr: "Avis pour Petites Embarcations" },
  'Tropical Storm Watch':         { en: 'Tropical Storm Watch',         es: 'Vigilancia de Tormenta Tropical',    pt: 'Vigilância de Tempestade Tropical',   fr: 'Veille de Tempête Tropicale' },
  'Tropical Storm Warning':       { en: 'Tropical Storm Warning',       es: 'Alerta de Tormenta Tropical',        pt: 'Alerta de Tempestade Tropical',       fr: 'Alerte de Tempête Tropicale' },
  'Hurricane Watch':              { en: 'Hurricane Watch',              es: 'Vigilancia de Huracán',              pt: 'Vigilância de Furacão',                fr: "Veille d'Ouragan" },
  'Hurricane Warning':            { en: 'Hurricane Warning',            es: 'Alerta de Huracán',                  pt: 'Alerta de Furacão',                    fr: "Alerte d'Ouragan" },
  'Severe Thunderstorm Warning':  { en: 'Severe Thunderstorm Warning',  es: 'Alerta de Tormenta Severa',          pt: 'Alerta de Tempestade Severa',         fr: 'Alerte de Orage Violent' },
  'Flash Flood Warning':          { en: 'Flash Flood Warning',          es: 'Alerta de Inundación Repentina',     pt: 'Alerta de Enchente Repentina',        fr: "Alerte de Crue Éclair" },
};

function nwsAdvisoryItem(alert, fetchedAt) {
  const p = alert.properties;
  const titles = NWS_EVENT_NAMES[p.event] || { en: p.event, es: p.event, pt: p.event, fr: p.event };
  const sourceExpires = p.expires ? new Date(p.expires).getTime() : null;
  const capExpires = fetchedAt.getTime() + ADVISORY_TTL_MS;
  return {
    id:         `nws_${p.id || p.event}`.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80),
    type:       'weather',
    severity:   (p.severity || 'moderate').toLowerCase(),
    title:      titles,
    // detail is the NWS's own free-text description — es/pt/fr start blank and
    // get filled in by translateAdvisoryDetails() below (same as event
    // descriptions). content.spec.js's translation-completeness check requires
    // every {en,...} string to carry all 4 languages, no English-fallback exception.
    detail:     { en: (p.description || p.headline || '').slice(0, 400), es: '', pt: '', fr: '' },
    source:      'National Weather Service',
    sourceUrl:   p['@id'] || 'https://www.weather.gov/mfl/',
    effectiveAt: p.effective || p.onset || fetchedAt.toISOString(),
    expiresAt:   new Date(sourceExpires && sourceExpires < capExpires ? sourceExpires : capExpires).toISOString(),
  };
}

async function refreshNwsAlerts(fetchedAt) {
  // Same Miami point used for the weather fetch above — coastal alerts for
  // this point cover the beaches passengers are asking about.
  const url = 'https://api.weather.gov/alerts/active?point=25.7617,-80.1918';
  const res = await fetch(url, { headers: { 'User-Agent': 'MiamiRideCompanion/1.0 (daily-refresh@github-actions)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { features } = await res.json();
  console.log(`  NWS alerts: ${features?.length || 0} active`);
  return (features || []).slice(0, 5).map(a => nwsAdvisoryItem(a, fetchedAt));
}

async function refreshAdvisories(content) {
  const fetchedAt = new Date();
  const items = [];

  try {
    items.push(...await refreshBeachAdvisories(content, fetchedAt));
  } catch (err) {
    console.error(`  beach advisories failed: ${err.message} — keeping existing entries`);
    // Keep prior beach_* items (client-side expiry will drop them once stale)
    // rather than silently wiping a real advisory because one fetch hiccuped.
    if (content.advisories?.items) items.push(...content.advisories.items.filter(i => i.id.startsWith('beach_')));
  }

  try {
    items.push(...await refreshNwsAlerts(fetchedAt));
  } catch (err) {
    console.error(`  NWS alerts failed: ${err.message} — keeping existing entries`);
    if (content.advisories?.items) items.push(...content.advisories.items.filter(i => i.id.startsWith('nws_')));
  }

  await translateAdvisoryDetails(items);

  content.advisories = { fetchedAt: fetchedAt.toISOString(), items };
}

// NWS alert descriptions are free text (unlike the templated beach copy
// above), so they go through Claude like event descriptions do. Batched to
// stay well under a single prompt's practical size even if several alerts
// are active at once.
async function translateAdvisoryDetails(items) {
  const needsTranslation = items.filter(i => i.detail && !i.detail.es);
  if (!needsTranslation.length) return;
  console.log(`  translating ${needsTranslation.length} advisory detail(s)…`);
  const payload = {};
  needsTranslation.forEach(i => { payload[i.id] = i.detail.en; });
  try {
    const result = await callClaude(
`Translate these official weather/safety advisory notices into Spanish (Latin American), Portuguese (Brazilian), and French. Keep the tone official and concise, matching the source.
Return ONLY valid JSON — no markdown, no extra keys:
{ "<id>": { "es":"...","pt":"...","fr":"..." }, ... }

Notices:
${JSON.stringify(payload)}`, 2000);

    const translations = JSON.parse(extractJson(result));
    needsTranslation.forEach(i => {
      const t = translations[i.id];
      if (!t) return;
      if (t.es) i.detail.es = t.es;
      if (t.pt) i.detail.pt = t.pt;
      if (t.fr) i.detail.fr = t.fr;
    });
  } catch (err) {
    console.error(`  advisory translation failed: ${err.message} — these items will keep an English-only detail until next run`);
  }
}

// ── Geocoding (Nominatim, 1 req/sec per usage policy) ────────────────────────

async function geocodeEvent(ev) {
  if (!ev.address) return;
  await new Promise(r => setTimeout(r, 1100));
  try {
    const params = new URLSearchParams({ q: ev.address, format: 'json', limit: '1' });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'MiamiRideCompanion/1.0 (daily-refresh@github-actions)' },
    });
    if (!res.ok) return;
    const [hit] = await res.json();
    if (hit) {
      ev.lat = parseFloat(hit.lat);
      ev.lng = parseFloat(hit.lon);
    }
  } catch { /* non-fatal — passenger app shows no distance badge */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = miamiToday();
  console.log(`\n=== Daily refresh ${today} ===\n`);

  // 1. Load content.json + review cache
  const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'));
  if (!content.guide) content.guide = {};
  if (!Array.isArray(content.guide.events)) content.guide.events = [];

  let reviewCache = {};
  try { reviewCache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { /* fresh start */ }

  // 2. Drop past events
  const before = content.guide.events.length;
  content.guide.events = content.guide.events.filter(e => !e.date || e.date >= today);
  console.log(`  dropped ${before - content.guide.events.length} past events (${content.guide.events.length} remain)`);

  // Track which events existed before this run so we only AI-review new arrivals.
  const preExistingIds = new Set(content.guide.events.map(e => e.id));

  // 3. Fetch from Worker endpoints and merge
  const seenUrls = new Set(content.guide.events.map(e => e.url).filter(Boolean));
  // Cross-run title+venue dedup: prevents recurring daily packages (e.g. "Ride and Dine")
  // from accumulating one entry per date when Ticketmaster lists each day as a separate URL.
  const seenTitleVenue = new Set(
    content.guide.events.map(e => `${(e.title?.en || '').trim()}|${(e.venue || '').trim()}`.toLowerCase())
  );

  for (const [endpoint, idPrefix, label] of [
    ['/api/rss-fetch',          'rss_',  'RSS'],
    ['/api/ticketmaster-fetch', 'tm_',   'Ticketmaster'],
    ['/api/mbcc-fetch',         'mbcc_', 'MBCC'],
    ['/api/civicplus-fetch',    'cp_',   'CivicPlus'],
  ]) {
    try {
      const res = await fetch(WORKER_URL + endpoint);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
        throw new Error(msg);
      }
      const { events, errors } = await res.json();
      if (errors?.length) console.warn(`  [${label}] warnings:`, errors.join('; '));

      const added = [];
      for (const e of events) {
        if (!e.url || seenUrls.has(e.url)) continue;
        if (e.date && e.date < today) continue;
        const tvKey = `${(e.title || '').trim()}|${(e.venue || e.source || '').trim()}`.toLowerCase();
        if (seenTitleVenue.has(tvKey)) continue;
        if (reviewCache[tvKey]?.verdict === 'skip') continue; // permanently blocklisted
        seenUrls.add(e.url);
        seenTitleVenue.add(tvKey);
        const ev = {
          id:          genId(idPrefix),
          title:       { en: e.title, es: '', pt: '', fr: '' },
          date:        e.date || today,
          venue:       e.venue || e.source || '',
          address:     e.address || '',
          url:         e.url,
          free:        !!e.free,
          price:       e.price || '',
          image:       e.image || '',
          description: { en: e.description || '', es: '', pt: '', fr: '' },
          // The specific feed/site this came from (e.g. "Soul of Miami",
          // "Hollywood", "Ticketmaster") — the UI doesn't render this, it's
          // here so review-cache verdicts can be tagged by source (see step 5
          // below) for later evaluation of which feeds are worth keeping.
          source:      e.source || label,
        };
        // Ticketmaster ships a real segment/genre-derived category — keep it
        // instead of guessing later. RSS events have none, so step 7 below
        // (inferEventCategory) fills those in from the title.
        if (e.category) ev.category = e.category;
        if (Number.isFinite(e.lat) && Number.isFinite(e.lng)) { ev.lat = e.lat; ev.lng = e.lng; }
        added.push(ev);
      }
      content.guide.events.push(...added);
      console.log(`  ${label}: +${added.length} new`);
    } catch (err) {
      const cause = err.cause ? ` — cause: ${err.cause}` : '';
      console.error(`  [${label}] failed: ${err.message}${cause}`);
    }
  }

  // 4. Geocode new RSS events missing coordinates
  const toGeocode = content.guide.events.filter(
    e => e.id.startsWith('rss_') && e.address && e.lat === undefined
  );
  if (toGeocode.length) {
    console.log(`  geocoding ${toGeocode.length} RSS event(s)…`);
    for (const ev of toGeocode) await geocodeEvent(ev);
  }

  // 5. AI review — only events added this run that aren't already in the review cache
  const allNewEvents = content.guide.events.filter(e => !preExistingIds.has(e.id));
  // Build a map so we can look up title+venue for skipped events when writing to cache.
  const newEventMeta = new Map(allNewEvents.map(e => [
    e.id,
    { tvKey: `${(e.title?.en || '').trim()}|${(e.venue || '').trim()}`.toLowerCase(), source: e.source },
  ]));
  const needsReview = allNewEvents.filter(e => !reviewCache[newEventMeta.get(e.id).tvKey]);
  const cacheHits   = allNewEvents.length - needsReview.length;
  if (cacheHits) console.log(`  AI review: ${cacheHits} event(s) skipped (already in cache)`);

  if (needsReview.length) {
    console.log(`  AI reviewing ${needsReview.length} new event(s)…`);
    const payload = {};
    needsReview.forEach(e => {
      payload[e.id] = {
        title: e.title.en,
        venue: e.venue,
        date:  e.date,
        free:  e.free,
        desc:  (e.description.en || '').slice(0, 200),
      };
    });
    try {
      const result = await callClaude(
`You are helping curate events for a Miami ride-share companion app. Passengers are tourists or locals on a short Lyft/Uber trip.

For each item, rate "keep" (a specific, time-bound gathering at a real venue that passengers could attend) or "skip" for anything else.

Rate "skip" if ANY of these apply:
- It is a news article, blog post, deal, promotion, coupon, or evergreen tourism tip — not a specific dated event
- venue is empty or is just the source/blog name (e.g. "Miami on the Cheap") — strong signal it is an article
- It is a recurring daily/weekly tourist package or venue tour (e.g. bus tours, combo dining packages, arena backstage tours) rather than a one-off event
- It is outside South Florida (Homestead to Boca Raton)
- It is too niche or low-interest for a general tourist/local audience (e.g. very small local bands with no recognizable acts)

Add one short reason, max 8 words.

Return ONLY valid JSON — no markdown:
{ "<id>": { "verdict": "keep"|"skip", "reason": "..." }, ... }

Events:
${JSON.stringify(payload)}`);

      const ratings = JSON.parse(extractJson(result));

      // Persist all verdicts to the review cache, tagged with the source that
      // produced the event — lets a later pass tally keep/skip rates per
      // source (e.g. "Miami on the Cheap" vs. "Hollywood") to see which feeds
      // are worth keeping.
      for (const [id, r] of Object.entries(ratings)) {
        const meta = newEventMeta.get(id);
        if (meta) reviewCache[meta.tvKey] = { verdict: r.verdict, reason: r.reason, cached: today, source: meta.source };
      }

      const skipIds = new Set(
        Object.entries(ratings).filter(([, v]) => v.verdict === 'skip').map(([id]) => id)
      );
      const keepCount = Object.values(ratings).filter(v => v.verdict === 'keep').length;
      const beforeReview = content.guide.events.length;
      content.guide.events = content.guide.events.filter(e => !skipIds.has(e.id));
      console.log(`  AI review: ${keepCount} keep, ${skipIds.size} skip → removed ${beforeReview - content.guide.events.length}`);
    } catch (err) {
      console.error(`  AI review failed: ${err.message} — keeping all new events`);
    }
  }

  // Save review cache (skip entries block future re-adds; keep entries avoid redundant API calls).
  writeFileSync(CACHE_PATH, JSON.stringify(reviewCache, null, 2) + '\n', 'utf8');

  // 6. Translate events missing ES/PT/FR (in batches of 5)
  const needsTranslation = content.guide.events.filter(
    e => !e.title.es || !e.description.es
  );
  if (needsTranslation.length) {
    console.log(`  translating ${needsTranslation.length} event(s)…`);
    const BATCH = 5;
    for (let i = 0; i < needsTranslation.length; i += BATCH) {
      const chunk = needsTranslation.slice(i, i + BATCH);
      const payload = {};
      chunk.forEach(e => { payload[e.id] = { title_en: e.title.en, desc_en: e.description.en || '' }; });
      try {
        const result = await callClaude(
`Translate these Miami events into Spanish (Latin American), Portuguese (Brazilian), and French.
Return ONLY valid JSON — no markdown, no extra keys:
{ "<id>": { "title_es":"...","title_pt":"...","title_fr":"...","desc_es":"...","desc_pt":"...","desc_fr":"..." }, ... }

Events:
${JSON.stringify(payload)}`, 4000);

        const translations = JSON.parse(extractJson(result));
        chunk.forEach(e => {
          const t = translations[e.id];
          if (!t) return;
          if (t.title_es) e.title.es = t.title_es;
          if (t.title_pt) e.title.pt = t.title_pt;
          if (t.title_fr) e.title.fr = t.title_fr;
          if (t.desc_es)  e.description.es = t.desc_es;
          if (t.desc_pt)  e.description.pt = t.desc_pt;
          if (t.desc_fr)  e.description.fr = t.desc_fr;
        });
      } catch (err) {
        console.error(`  translation batch ${Math.floor(i / BATCH) + 1} failed: ${err.message}`);
      }
    }
  }

  // 7. Assign category to any event that doesn't have one yet
  const needsCat = content.guide.events.filter(e => !e.category);
  if (needsCat.length) {
    console.log(`  assigning category to ${needsCat.length} event(s)…`);
    needsCat.forEach(e => { e.category = inferEventCategory(e); });
  }

  // 8. Refresh weather
  console.log('  refreshing weather…');
  try {
    await refreshWeather(content);
  } catch (err) {
    console.error(`  weather failed: ${err.message} — keeping existing data`);
  }

  // 9. Refresh advisories (beach water quality + NWS weather/safety alerts)
  console.log('  refreshing advisories…');
  try {
    await refreshAdvisories(content);
  } catch (err) {
    console.error(`  advisories failed: ${err.message} — keeping existing data`);
  }

  // 10. Write content.json
  content.meta.lastUpdated  = new Date().toISOString();
  content.meta.publishedBy  = 'daily-refresh[bot]';
  writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + '\n', 'utf8');

  const finalCount = content.guide.events.length;
  const advisoryCount = content.advisories?.items?.length || 0;
  console.log(`\n✓ Done — ${finalCount} events, ${advisoryCount} active advisories in content.json\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
