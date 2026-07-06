// Unit tests for the Cloudflare Functions (functions/api/*) — the server-side
// event parsing/mapping and the claude-proxy origin allowlist. These exercise
// the PURE logic only (no live network): the modules export their helpers for
// testing; Playwright's loader transpiles their ESM `export` to CJS so we can
// require them directly here, with no browser/page involved.
//
// Tag: @backend  →  run with `npm run test:backend` (or `--grep @backend`).
//
// NB: uses the base @playwright/test runner, NOT ./fixtures — there's no page,
// so the console-error fixture would have nothing to attach to.
const { test, expect } = require('@playwright/test');

const rss = require('../functions/api/rss-fetch.js');
const tm = require('../functions/api/ticketmaster-fetch.js');
const proxy = require('../functions/api/claude-proxy.js');

// A realistic Soul of Miami intro line — date, time range, venue + address,
// "Website Cost: <x>", then the real blurb, then the "Read More" teaser tail.
const soulItem = (over = {}) => ({
  title: 'Beach Cleanup',
  description:
    'Beach Cleanup Sunday, 06/21/2026-, 02:00 pm- Segafredos 1040 Lincoln Road, ' +
    'Miami Beach, Florida, 33139 Website Cost: Free After 26 years of doing this ' +
    'great community event it continues to grow every season. Read More',
  date: '2026-06-02', // the feed's pubDate (post date) — should be overridden
  free: false,
  ...over,
});

test.describe('Backend: rss-fetch — Soul of Miami decoration', { tag: ['@backend'] }, () => {
  test('extracts the real M/D/YYYY event date, overriding the post date', () => {
    const out = rss.decorateSoulOfMiami(soulItem());
    expect(out).not.toBeNull();
    expect(out.date).toBe('2026-06-21'); // not the 2026-06-02 pubDate
  });

  test('lifts venue + street address out of the intro prose', () => {
    const out = rss.decorateSoulOfMiami(soulItem());
    expect(out.venue).toBe('Segafredos');
    expect(out.address).toBe('1040 Lincoln Road, Miami Beach, Florida, 33139');
  });

  test('reads a free cost line', () => {
    expect(rss.decorateSoulOfMiami(soulItem()).free).toBe(true);
  });

  test('reads a paid cost line into a rounded "$N" price', () => {
    const desc =
      'Concert Friday, 07/04/2026, 08:00 pm- Arena 100 Main St, Miami, FL, 33101 ' +
      'Website Cost: $39.19 A great show you will love for sure. Read More';
    const out = rss.decorateSoulOfMiami(soulItem({ description: desc }));
    expect(out.free).toBe(false);
    expect(out.price).toBe('$39');
  });

  test('handles a "Cost FREE" line with no colon', () => {
    const desc =
      'Fair Saturday, 08/15/2026, 10:00 am- Park 5 Park Ave, Miami, FL, 33101 ' +
      'Website Cost FREE Come on down for a full day of family fun. Read More';
    expect(rss.decorateSoulOfMiami(soulItem({ description: desc })).free).toBe(true);
  });

  test('replaces the description with the clean blurb after the cost line', () => {
    const out = rss.decorateSoulOfMiami(soulItem());
    expect(out.description).toContain('After 26 years');
    expect(out.description).not.toContain('Website Cost'); // structured prefix stripped
    expect(out.description).not.toContain('Read More'); // teaser tail stripped
  });

  // ── Negative / bug #19 guard ──────────────────────────────────────────────
  test('@negative drops "Front Page" digest posts (returns null)', () => {
    const out = rss.decorateSoulOfMiami(soulItem({ title: 'Front Page for June 1, 2026' }));
    expect(out).toBeNull();
  });

  test('@negative drops items with no parseable event date (bug #19 masquerade)', () => {
    // No M/D/YYYY anywhere → we can't trust the post date → drop, never let it
    // inherit "today" and surface as a current event.
    const desc = 'Weekly meetup every Tuesday at the park. Website Cost: Free Join us. Read More';
    const out = rss.decorateSoulOfMiami(soulItem({ description: desc, title: 'Meetup' }));
    expect(out).toBeNull();
  });
});

test.describe('Backend: rss-fetch — parsing helpers', { tag: ['@backend'] }, () => {
  test('stripHtml removes tags, decodes named + numeric entities, collapses whitespace', () => {
    const out = rss.stripHtml('<p>Hello &amp;  <b>bye</b>  &#8217;s &#x2122;</p>');
    expect(out).toBe('Hello & bye ’s ™');
  });

  test('extractField reads both CDATA and plain text', () => {
    expect(rss.extractField('<title><![CDATA[A & B]]></title>', 'title')).toBe('A & B');
    expect(rss.extractField('<title>Plain Title</title>', 'title')).toBe('Plain Title');
  });

  test('extractImage prefers media:thumbnail over inline images', () => {
    const block = '<media:thumbnail url="https://img.com/thumb.jpg"/><img src="https://img.com/body.jpg">';
    expect(rss.extractImage(block)).toBe('https://img.com/thumb.jpg');
  });

  test('@negative extractImage skips emoji/tracking-pixel junk images', () => {
    const block = '<img src="https://s.w.org/images/core/emoji/2.png"><img src="https://cdn.com/real.jpg">';
    expect(rss.extractImage(block)).toBe('https://cdn.com/real.jpg');
    // Junk-only block yields nothing (card falls back to its gradient).
    expect(rss.extractImage('<img src="https://stats.wp.com/pixel.gif">')).toBe('');
  });

  test('extractAtomLink prefers rel="alternate" and skips rel="self"', () => {
    const block = '<link rel="self" href="https://feed/self"/><link rel="alternate" href="https://post/123"/>';
    expect(rss.extractAtomLink(block)).toBe('https://post/123');
  });

  test('parseFeed reads RSS 2.0 <item>s', () => {
    const xml = `<rss><channel>
      <item><title>One</title><link>https://e/1</link><description>First</description><pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate></item>
      <item><title>Two</title><link>https://e/2</link><description>Second</description><pubDate>Tue, 02 Jun 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const items = rss.parseFeed(xml, 'Test');
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ title: 'One', url: 'https://e/1', date: '2026-06-01', source: 'Test' });
  });

  test('parseFeed auto-detects Atom <entry>s and their attribute links', () => {
    const xml = `<feed><entry><title>Atom One</title>
      <link rel="alternate" href="https://atom/1"/>
      <summary>Body</summary><published>2026-06-03T12:00:00Z</published></entry></feed>`;
    const items = rss.parseFeed(xml, 'AtomSrc');
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({ title: 'Atom One', url: 'https://atom/1', date: '2026-06-03' });
  });

  test('@negative parseFeed skips items with no title and caps at 6 per feed', () => {
    const withTitle = (n) => `<item><title>T${n}</title><link>https://e/${n}</link></item>`;
    const xml = `<rss><channel>
      <item><link>https://e/notitle</link></item>
      ${[1, 2, 3, 4, 5, 6, 7, 8].map(withTitle).join('')}
    </channel></rss>`;
    const items = rss.parseFeed(xml, 'Test');
    expect(items.length).toBe(6); // titleless dropped, then capped at 6
    expect(items.every((i) => i.title)).toBe(true);
  });
});

test.describe('Backend: rss-fetch — past-event guard', { tag: ['@backend'] }, () => {
  test('dropPastEvents removes past dates, keeps today/future/undated', () => {
    const events = [
      { id: 'past', date: '2026-05-01' },
      { id: 'today', date: '2026-06-01' },
      { id: 'future', date: '2026-12-25' },
      { id: 'undated' },
    ];
    const kept = rss.dropPastEvents(events, '2026-06-01').map((e) => e.id);
    expect(kept).toEqual(['today', 'future', 'undated']);
  });

  test('dropPastEvents tolerates null/empty input', () => {
    expect(rss.dropPastEvents(null, '2026-06-01')).toEqual([]);
    expect(rss.dropPastEvents([], '2026-06-01')).toEqual([]);
  });

  test('miamiToday returns an ISO YYYY-MM-DD string', () => {
    expect(rss.miamiToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

test.describe('Backend: ticketmaster-fetch — mapEvent', { tag: ['@backend'] }, () => {
  const fullEvent = {
    name: 'Rick Ross Live',
    url: 'https://tm.com/e1',
    dates: { start: { localDate: '2026-07-01', localTime: '20:00:00' } },
    _embedded: {
      venues: [{
        name: 'Kaseya Center',
        address: { line1: '601 Biscayne Blvd' },
        city: { name: 'Miami' },
        state: { stateCode: 'FL' },
        location: { latitude: '25.781', longitude: '-80.187' },
      }],
    },
    classifications: [{ segment: { name: 'Music' }, genre: { name: 'Hip-Hop' } }],
    priceRanges: [{ min: 50 }, { min: 35 }],
    images: [{ url: 'https://i/wide.jpg', ratio: '16_9', width: 640 }],
  };

  test('maps the core fields, address, and venue coordinates', () => {
    const ev = tm.mapEvent(fullEvent);
    expect(ev).toMatchObject({
      title: 'Rick Ross Live',
      url: 'https://tm.com/e1',
      date: '2026-07-01',
      venue: 'Kaseya Center',
      address: '601 Biscayne Blvd, Miami, FL',
      source: 'Ticketmaster',
      lat: 25.781,
      lng: -80.187,
    });
  });

  test('builds a description from classification, start time, and venue', () => {
    const ev = tm.mapEvent(fullEvent);
    expect(ev.description).toBe('Music · Hip-Hop · Starts 20:00 · Kaseya Center');
  });

  test('takes the lowest price range as a rounded "$N"', () => {
    expect(tm.mapEvent(fullEvent).price).toBe('$35');
    expect(tm.mapEvent(fullEvent).free).toBe(false);
  });

  test('marks an event free when a $0 minimum is reported', () => {
    const ev = tm.mapEvent({ ...fullEvent, priceRanges: [{ min: 0 }] });
    expect(ev.free).toBe(true);
    expect(ev.price).toBe('');
  });

  test('trims trailing whitespace from venue name', () => {
    const ev = tm.mapEvent({
      ...fullEvent,
      _embedded: { venues: [{ ...fullEvent._embedded.venues[0], name: 'Amerant Bank Arena ' }] },
    });
    expect(ev.venue).toBe('Amerant Bank Arena');
  });

  test('@negative degrades gracefully on a near-empty event (no throw, blank fields)', () => {
    const ev = tm.mapEvent({});
    expect(ev).toMatchObject({ title: '', date: '', venue: '', address: '', price: '', free: false, description: '' });
    expect(ev.lat).toBeUndefined();
    expect(ev.lng).toBeUndefined();
  });
});

test.describe('Backend: ticketmaster-fetch — pickImage', { tag: ['@backend'] }, () => {
  test('prefers the 16:9 image closest to ~640px wide', () => {
    const images = [
      { url: 'near', ratio: '16_9', width: 640 },
      { url: 'small', ratio: '16_9', width: 205 },
      { url: 'huge', ratio: '16_9', width: 2048 },
    ];
    expect(tm.pickImage(images)).toBe('near');
  });

  test('falls back to the widest image when none is 16:9', () => {
    const images = [
      { url: 'small', ratio: '3_2', width: 100 },
      { url: 'big', ratio: '3_2', width: 1000 },
    ];
    expect(tm.pickImage(images)).toBe('big');
  });

  test('@negative returns empty string for missing/empty image arrays', () => {
    expect(tm.pickImage([])).toBe('');
    expect(tm.pickImage(undefined)).toBe('');
    expect(tm.pickImage(null)).toBe('');
  });
});

test.describe('Backend: claude-proxy — origin allowlist', { tag: ['@backend'] }, () => {
  const SELF = 'https://miami-ride.example.com';

  test('allows a same-origin request (editor calling its own Worker)', () => {
    expect(proxy.isAllowedOrigin(SELF, {}, SELF)).toBe(true);
    // Same-origin covers preview hosts too — the editor and proxy share a host.
    expect(proxy.isAllowedOrigin('https://miami-ride.pages.dev', {}, 'https://miami-ride.pages.dev')).toBe(true);
  });

  test('allows any loopback origin/port (Wrangler dev)', () => {
    expect(proxy.isAllowedOrigin('http://localhost:8788', {}, SELF)).toBe(true);
    expect(proxy.isAllowedOrigin('http://127.0.0.1:5500', {}, SELF)).toBe(true);
    expect(proxy.isAllowedOrigin('http://[::1]:3000', {}, SELF)).toBe(true);
  });

  test('honors an explicit ALLOWED_ORIGIN from env', () => {
    expect(proxy.isAllowedOrigin('https://my.app', { ALLOWED_ORIGIN: 'https://my.app' }, SELF)).toBe(true);
  });

  test('@negative denies a missing Origin (non-browser client / curl)', () => {
    // The old proxy allowed empty Origin, which let any non-browser client in.
    expect(proxy.isAllowedOrigin('', {}, SELF)).toBe(false);
  });

  test('@negative denies cross-site, unrelated CDN, and malformed origins', () => {
    expect(proxy.isAllowedOrigin('https://evil.com', {}, SELF)).toBe(false);
    // A page an attacker hosts on their own *.pages.dev must NOT be allowed —
    // it is not same-origin with our Worker.
    expect(proxy.isAllowedOrigin('https://attacker.pages.dev', {}, SELF)).toBe(false);
    expect(proxy.isAllowedOrigin('https://notpages.dev.evil.com', {}, SELF)).toBe(false);
    expect(proxy.isAllowedOrigin('not-a-url', {}, SELF)).toBe(false);
  });
});

test.describe('Backend: claude-proxy — prompt size guard', { tag: ['@backend'] }, () => {
  test('counts string and structured message content', () => {
    expect(proxy.promptChars([{ role: 'user', content: 'hello' }])).toBe(5);
    expect(proxy.promptChars([
      { role: 'user', content: [{ type: 'text', text: 'ab' }, { type: 'text', text: 'cde' }] },
    ])).toBe(5);
  });

  test('@negative treats a non-array as unbounded (rejected upstream)', () => {
    expect(proxy.promptChars('nope')).toBe(Infinity);
    expect(proxy.promptChars(undefined)).toBe(Infinity);
  });
});
