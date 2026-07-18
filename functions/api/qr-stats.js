// Real (redirect-confirmed) QR scan analytics — reads the 'qr:' prefixed
// keys that src/index.js writes on every /qr/:type/:id hit. All counters are
// cumulative and never deleted, so full history lives in KV even though this
// endpoint only surfaces a recent window by default (see `days` param).
export async function onRequestGet({ request, env }) {
  if (!env.BIZCARD_STATS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const url = new URL(request.url);
  const windowDays = Math.min(parseInt(url.searchParams.get('days')) || 14, 90);

  const [total, byType, byId] = await Promise.all([
    env.BIZCARD_STATS.get('qr:total'),
    listCounts(env.BIZCARD_STATS, 'qr:type:'),
    listCounts(env.BIZCARD_STATS, 'qr:id:'),
  ]);

  const days = Array.from({ length: windowDays }, (_, i) => {
    const d = new Date(Date.now() - (windowDays - 1 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const dayCounts = await Promise.all(days.map((d) => env.BIZCARD_STATS.get('qr:day:' + d)));
  const byDay = days.map((date, i) => ({ date, count: parseInt(dayCounts[i] || '0') }));

  // Hourly breakdown for a single day (defaults to today), e.g. ?date=2026-07-18
  const hourDate = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const hourCounts = await Promise.all(hours.map((h) => env.BIZCARD_STATS.get('qr:hour:' + hourDate + ':' + h)));
  const byHour = hours.map((hour, i) => ({ hour, count: parseInt(hourCounts[i] || '0') }));

  return new Response(JSON.stringify({
    total: parseInt(total || '0'),
    byType,
    byId,
    byDay,
    byHour: { date: hourDate, hours: byHour },
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

async function listCounts(kv, prefix) {
  const out = {};
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const k of page.keys) {
      const val = await kv.get(k.name);
      out[k.name.slice(prefix.length)] = parseInt(val || '0');
    }
    cursor = page.cursor;
    if (page.list_complete) break;
  } while (cursor);
  return out;
}
