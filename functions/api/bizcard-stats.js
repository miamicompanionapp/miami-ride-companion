export async function onRequestGet({ request, env }) {
  if (!env.BIZCARD_STATS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const url = new URL(request.url);
  const sources = (url.searchParams.get('sources') || 'card,flyer,magnet,generic').split(',').filter(Boolean);

  const [total, ...sourceCounts] = await Promise.all([
    env.BIZCARD_STATS.get('total'),
    ...sources.map(s => env.BIZCARD_STATS.get('src:' + s)),
  ]);

  const bySource = {};
  sources.forEach((s, i) => { bySource[s] = parseInt(sourceCounts[i] || '0'); });

  // Last 14 days
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const dayCounts = await Promise.all(days.map(d => env.BIZCARD_STATS.get('day:' + d)));
  const byDay = days.map((date, i) => ({ date, count: parseInt(dayCounts[i] || '0') }));

  // Hourly breakdown for a single day (defaults to today), e.g. ?date=2026-07-18
  const hourDate = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const hourCounts = await Promise.all(hours.map(h => env.BIZCARD_STATS.get('hour:' + hourDate + ':' + h)));
  const byHour = hours.map((hour, i) => ({ hour, count: parseInt(hourCounts[i] || '0') }));

  return new Response(JSON.stringify({ total: parseInt(total || '0'), bySource, byDay, byHour: { date: hourDate, hours: byHour } }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
