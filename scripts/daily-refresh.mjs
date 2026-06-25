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
const CONTENT_PATH = join(__dirname, '../public/content.json');

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

  // 1. Load content.json
  const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'));
  if (!content.guide) content.guide = {};
  if (!Array.isArray(content.guide.events)) content.guide.events = [];

  // 2. Drop past events
  const before = content.guide.events.length;
  content.guide.events = content.guide.events.filter(e => !e.date || e.date >= today);
  console.log(`  dropped ${before - content.guide.events.length} past events (${content.guide.events.length} remain)`);

  // Track which events existed before this run so we only AI-review new arrivals.
  const preExistingIds = new Set(content.guide.events.map(e => e.id));

  // 3. Fetch from Worker endpoints and merge
  const seenUrls = new Set(content.guide.events.map(e => e.url).filter(Boolean));

  for (const [endpoint, idPrefix, label] of [
    ['/api/rss-fetch',          'rss_', 'RSS'],
    ['/api/ticketmaster-fetch', 'tm_',  'Ticketmaster'],
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
        seenUrls.add(e.url);
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
        };
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

  // 5. AI review — only events added this run
  const newEvents = content.guide.events.filter(e => !preExistingIds.has(e.id));
  if (newEvents.length) {
    console.log(`  AI reviewing ${newEvents.length} new event(s)…`);
    const payload = {};
    newEvents.forEach(e => {
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
- It is outside South Florida (Homestead to Boca Raton)
- It is too niche or low-interest for a general tourist/local audience

Add one short reason, max 8 words.

Return ONLY valid JSON — no markdown:
{ "<id>": { "verdict": "keep"|"skip", "reason": "..." }, ... }

Events:
${JSON.stringify(payload)}`);

      const ratings = JSON.parse(extractJson(result));
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

  // 7. Refresh weather
  console.log('  refreshing weather…');
  try {
    await refreshWeather(content);
  } catch (err) {
    console.error(`  weather failed: ${err.message} — keeping existing data`);
  }

  // 8. Write content.json
  content.meta.lastUpdated  = new Date().toISOString();
  content.meta.publishedBy  = 'daily-refresh[bot]';
  writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + '\n', 'utf8');

  const finalCount = content.guide.events.length;
  console.log(`\n✓ Done — ${finalCount} events in content.json\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
