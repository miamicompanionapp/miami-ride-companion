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

  return new Response(JSON.stringify({ total: parseInt(total || '0'), bySource, byDay }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
