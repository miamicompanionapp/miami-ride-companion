// functions/api/rss-fetch.js
// Cloudflare Pages Function — fetches South Florida event RSS feeds server-side.
// The browser can't fetch these directly (CORS); this proxy runs at the edge.
//
// GET /api/rss-fetch  →  { events: [...], errors: [...] }
//
// Each event: { title, description, url, date, venue, address, free, image, source }

const RSS_FEEDS = [
  // Timeout Miami's RSS is gone — https://www.timeout.com/miami/rss/things-to-do
  // and every common alternate path return 404 (verified 2026-05-29, browser UA).
  // { name: 'Timeout Miami', url: 'https://www.timeout.com/miami/rss/things-to-do' },

  // The Soul of Miami — a long-running South Florida events blog (real RSS 2.0,
  // ~50 items, one post per event). Each post's structured intro carries the
  // ACTUAL event date, time, venue, full address, and cost; decorateSoulOfMiami()
  // lifts those out, because the feed's own pubDate is just when the post went
  // live (so every item would otherwise show today's date). This is the events
  // source that replaces the dead Timeout feed (backlog #16). Verified 2026-05-30.
  {
    name: 'Soul of Miami',
    url:  'https://www.soulofmiami.org/feed/',
    decorate: decorateSoulOfMiami,
  },

  // Eater Miami (https://miami.eater.com/rss/index.xml) is ALIVE (Atom) but it's
  // food *news* — articles like "16 Best Restaurants…", not dated events — so it
  // pollutes an events list. Disabled here; re-enable behind a future food-news
  // strip if wanted. parseFeed() already handles its Atom format.
  // { name: 'Eater Miami', url: 'https://miami.eater.com/rss/index.xml' },
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
    // Decode the remaining numeric character refs (e.g. &#124; → |, &#8217; → ’)
    // that WordPress feeds sprinkle in. Named refs above stay as-is.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeCodePoint(n) {
  try { return Number.isFinite(n) ? String.fromCodePoint(n) : ''; }
  catch { return ''; }
}

// Emoji glyphs, smileys, and tracking pixels show up as tiny <img>s in
// WordPress feeds (e.g. a ™ in a title renders as s.w.org/.../2122.png). Skip
// them so we don't pick a 16px emoji as the event's photo.
const JUNK_IMG = /(s\.w\.org|\/emoji\/|wpcom-smileys|stats\.wp\.com|gravatar\.com|feedburner|pixel\.|\/blank\.|spacer\.gif)/i;

// Pull a usable image out of a feed item. Tries the common feed conventions in
// order: media:thumbnail / media:content (RSS Media extension), <enclosure>
// (RSS 2.0), then the first real <img src> in the description/content HTML.
// Returns '' when none is present (the card falls back to its gradient).
function extractImage(block) {
  const ok = u => u && !JUNK_IMG.test(u);
  const first = re => { const m = block.match(re); return m && ok(m[1]) ? m[1].trim() : ''; };

  const media =
    first(/<media:thumbnail[^>]*\burl=["']([^"']+)["']/i) ||
    first(/<media:content[^>]*\burl=["']([^"']+)["'][^>]*>/i) ||
    first(/<enclosure[^>]*\burl=["']([^"']+)["'][^>]*type=["']image/i) ||
    first(/<enclosure[^>]*type=["']image[^>]*\burl=["']([^"']+)["']/i);
  if (media) return media;

  // Fall back to the first <img> whose src isn't an emoji/tracking pixel.
  for (const m of block.matchAll(/<img[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (ok(m[1])) return m[1].trim();
  }
  return '';
}

// Per-feed enrichment for The Soul of Miami. Its posts open with a consistent
// structured line, e.g.:
//   "<Title> Sunday, 06/21/2026-, 02:00 pm- Segafredos 1040 Lincoln Road,
//    Miami Beach, Florida, 33139 Website Cost: Free After 26 years…"
// We lift the real event date, the venue + street address, and the free/paid
// flag out of that prose (the feed's pubDate is only the post date). Anything
// that doesn't match degrades gracefully (keeps pubDate, blank venue).
function decorateSoulOfMiami(item) {
  // "Front Page …" posts are the site's daily link digest, not a single event.
  // Returning null drops them (the handler filters falsy results).
  if (/^\s*Front Page\b/i.test(item.title)) return null;

  const d = item.description || '';

  // Real event start date: first M/D/YYYY in the intro line.
  const dm = d.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dm) {
    const iso = `${dm[3]}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(iso))) item.date = iso;
  }

  // Cost line → free flag.
  if (/Cost:\s*Free/i.test(d)) item.free = true;
  else if (/Cost:\s*\$\s*\d/i.test(d)) item.free = false;

  // Venue + address sit between the time range and "Website Cost".
  const va = d.match(/\d{1,2}(?::\d{2})?\s*[ap]m(?:\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]m)?\s*-?\s*(.+?)\s+Website\s+Cost/i);
  if (va) {
    const blk = va[1].trim();
    const addr = blk.match(/\d{1,6}\s+.+?,\s*[A-Za-z .]+,\s*(?:Florida|FL),?\s*\d{5}/i);
    if (addr) {
      item.address = addr[0].trim();
      item.venue = blk.slice(0, addr.index).trim() || item.address;
    } else {
      item.venue = blk;
    }
  }
  return item;
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
      image:   extractImage(block),
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
        const parsed = parseFeed(xml, feed.name);
        // A decorate hook may enrich an item or return null to drop it.
        const items = feed.decorate
          ? parsed.map(feed.decorate).filter(Boolean)
          : parsed;
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
