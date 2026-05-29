// functions/api/rss-fetch.js
// Cloudflare Pages Function — fetches Miami event RSS feeds server-side.
// The browser can't fetch these directly (CORS); this proxy runs at the edge.
//
// GET /api/rss-fetch  →  { events: [...], errors: [...] }
//
// Each event: { title, description, url, date, venue, address, free, source }

const RSS_FEEDS = [
  // Timeout Miami's RSS is gone — https://www.timeout.com/miami/rss/things-to-do
  // and every common alternate path return 404 (verified 2026-05-29, browser UA).
  // Disabled so it stops polluting `errors`; find a replacement feed → backlog #16.
  // { name: 'Timeout Miami', url: 'https://www.timeout.com/miami/rss/things-to-do' },
  {
    name: 'Eater Miami',
    url:  'https://miami.eater.com/rss/index.xml', // Atom feed (parsed by parseFeed)
  },
];

// ─── Minimal RSS 2.0 parser (no DOM available in Cloudflare Workers) ──────────

function extractField(block, tag) {
  // Handles CDATA and plain text, e.g. <title><![CDATA[…]]></title> or <title>…</title>
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`,
    'i'
  );
  const m = block.match(re);
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : m[2] || '').trim();
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Atom links are attributes, not text: <link rel="alternate" href="…"/>.
// Prefer rel="alternate", skip rel="self", else take the first link.
function extractAtomLink(block) {
  const links = (block.match(/<link\b[^>]*>/gi) || []);
  if (!links.length) return '';
  const pick = links.find(l => /rel=["']alternate["']/i.test(l))
            || links.find(l => !/rel=["']self["']/i.test(l))
            || links[0];
  const href = pick.match(/href=["']([^"']+)["']/i);
  return href ? href[1] : '';
}

// Handles both RSS 2.0 (<item>) and Atom (<entry>) — feeds in the wild are
// split between the two (e.g. Eater serves Atom). Auto-detects per feed.
function parseFeed(xml, sourceName) {
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blockRe = isAtom
    ? /<entry[^>]*>([\s\S]*?)<\/entry>/gi
    : /<item[^>]*>([\s\S]*?)<\/item>/gi;

  const items = [];
  let match;
  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[1];

    const title = stripHtml(extractField(block, 'title'));
    if (!title) continue;

    const link = isAtom
      ? extractAtomLink(block)
      : (extractField(block, 'link') || extractField(block, 'guid'));

    const rawDesc = isAtom
      ? (extractField(block, 'summary') || extractField(block, 'content'))
      : extractField(block, 'description');
    const desc = stripHtml(rawDesc).substring(0, 400);

    const pubDate = isAtom
      ? (extractField(block, 'published') || extractField(block, 'updated'))
      : extractField(block, 'pubDate');

    let date = '';
    if (pubDate) {
      try { date = new Date(pubDate).toISOString().split('T')[0]; } catch { /* ignore */ }
    }

    items.push({
      title,
      description: desc,
      url:     link,
      date,
      venue:   '',
      address: '',
      free:    false,
      source:  sourceName,
    });
  }

  return items.slice(0, 6); // cap at 6 items per feed
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

  await Promise.allSettled(
    RSS_FEEDS.map(async feed => {
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'Miami-Ride-Companion/1.0 (RSS reader)' },
          // Cache at the Cloudflare edge for 1 hour to avoid hammering the feeds
          cf: { cacheEverything: true, cacheTtl: 3600 },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${feed.url}`);
        const xml = await res.text();
        const items = parseFeed(xml, feed.name);
        events.push(...items);
      } catch (err) {
        errors.push(`${feed.name}: ${err.message}`);
      }
    })
  );

  return new Response(JSON.stringify({ events, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
