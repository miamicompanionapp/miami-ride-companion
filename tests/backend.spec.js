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
const mbcc = require('../functions/api/mbcc-fetch.js');
const proxy = require('../functions/api/claude-proxy.js');
const beachAdvisories = require('../functions/api/beach-advisories-fetch.js');
const worker = require('../src/index.js');

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

  test('derives category from the Ticketmaster segment/genre instead of guessing', () => {
    expect(tm.mapEvent(fullEvent).category).toBe('music');
    expect(tm.mapEvent({
      ...fullEvent,
      classifications: [{ segment: { name: 'Arts & Theatre' }, genre: { name: 'Comedy' } }],
    }).category).toBe('comedy');
    expect(tm.mapEvent({
      ...fullEvent,
      classifications: [{ segment: { name: 'Sports' } }],
    }).category).toBe('sports');
    expect(tm.mapEvent({
      ...fullEvent,
      classifications: [{ segment: { name: 'Arts & Theatre' } }],
    }).category).toBe('arts');
  });

  test('@negative leaves category unset for an unclassified/miscellaneous event rather than guessing', () => {
    expect(tm.mapEvent({ ...fullEvent, classifications: [{ segment: { name: 'Miscellaneous' } }] }).category).toBeUndefined();
    expect(tm.mapEvent({ ...fullEvent, classifications: [] }).category).toBeUndefined();
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

test.describe('Backend: mbcc-fetch — parseMbccPage', { tag: ['@backend'] }, () => {
  // Trimmed real markup from https://www.miamibeachconvention.com/events (2026-07-13):
  // one real event card, one non-event "mega-menu" article that must be skipped.
  const pageHtml = `
    <article data-history-node-id="3" class="entity--type-node node--mega-menu-teaser node--landing-page--mega-menu-teaser node--landing-page node--promoted">
      <div><a href="/plan">Plan an Event</a></div>
    </article>
    <article data-history-node-id="7476" data-dename="Florida Supercon 2026" data-detrackingid="" data-detype="event" data-decity="" data-deregion="" class="entity--type-node node--teaser node--event--teaser node--listing--teaser node--event node--promoted">
      <div class="node__content">
        <div class="date-summary"><div class="start-date"><span class="dayofweek">Friday</span><span class="date">07/10/2026</span></div><span class="hr"></span><div class="end-date"><span class="dayofweek">Sunday</span><span class="date">07/12/2026</span></div></div>
        <div class="info">
          <div class="field field--name-field-display-title field--type-string field--label-hidden field__item"><div><a href="/events/florida-supercon-2026" hreflang="en">Florida Supercon 2026</a></div></div>
          <div class="field field--name-body field--type-text-with-summary field--label-hidden field__item">  <p>Florida Supercon is an annual 3-day pop culture and comic convention in Miami Beach, FL &amp; more...</p></div>
          <div class="more"><a href="/events/florida-supercon-2026" aria-label="Read more about Florida Supercon 2026" class="arrow-cta">Learn More</a></div>
        </div>
        <div class="img"><div class="field field--name-field-listing-main-image-media field--type-entity-reference field--label-hidden field__item"><img loading="lazy" src="/sites/default/files/styles/events_calendar_teaser/public/2026-06/supercon.png.webp?itok=GmahViwc" width="300" height="200" alt="supercon" /></div></div>
      </div>
    </article>
  `;

  test('extracts only real event cards, skipping mega-menu teasers', () => {
    const events = mbcc.parseMbccPage(pageHtml);
    expect(events).toHaveLength(1);
  });

  test('maps title, ISO start date, absolute url/image, and the fixed venue', () => {
    const [ev] = mbcc.parseMbccPage(pageHtml);
    expect(ev).toMatchObject({
      title: 'Florida Supercon 2026',
      date: '2026-07-10',
      url: 'https://www.miamibeachconvention.com/events/florida-supercon-2026',
      venue: 'Miami Beach Convention Center',
      address: '1901 Convention Center Drive, Miami Beach, FL 33139',
      source: 'Miami Beach Convention Center',
      free: false,
    });
    expect(ev.image).toBe('https://www.miamibeachconvention.com/sites/default/files/styles/events_calendar_teaser/public/2026-06/supercon.png.webp?itok=GmahViwc');
    expect(ev.description).toContain('Florida Supercon is an annual 3-day pop culture and comic convention');
    expect(typeof ev.lat).toBe('number');
    expect(typeof ev.lng).toBe('number');
  });

  test('@negative returns an empty array for markup with no event articles', () => {
    expect(mbcc.parseMbccPage('<html><body>no events here</body></html>')).toEqual([]);
    expect(mbcc.parseMbccPage('')).toEqual([]);
  });
});

test.describe('Backend: mbcc-fetch — dropPastEvents / miamiToday', { tag: ['@backend'] }, () => {
  test('dropPastEvents removes past dates, keeps today/future/undated', () => {
    const events = [
      { id: 'past', date: '2026-05-01' },
      { id: 'today', date: '2026-06-01' },
      { id: 'future', date: '2026-12-25' },
      { id: 'undated' },
    ];
    const kept = mbcc.dropPastEvents(events, '2026-06-01').map((e) => e.id);
    expect(kept).toEqual(['today', 'future', 'undated']);
  });

  test('miamiToday returns an ISO YYYY-MM-DD string', () => {
    expect(mbcc.miamiToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

test.describe('Backend: beach-advisories-fetch — parseBeachAdvisories', { tag: ['@backend'] }, () => {
  // Trimmed real __NEXT_DATA__ shape from https://www.floridahealthybeaches.com/county/dade
  // (2026-07-13): one beach under an active advisory, one clean, one with no
  // samples yet (empty data array — must not throw).
  const pageHtml = (beaches) => `<!DOCTYPE html><html><head></head><body>
    <script id="__NEXT_DATA__" type="application/json">
      ${JSON.stringify({ props: { pageProps: { county: { name: 'Dade', slug: 'dade', beaches } } } })}
    </script>
  </body></html>`;

  const barkBeach = {
    id: '4c6ca404-e285-4dd8-bbf0-485cf5574d99',
    name: 'BARK BEACH',
    slug: 'bark-beach',
    data: [{
      updatedAt: '2026-07-11T06:00:46.519798+00:00',
      sampleDate: '7/8/2026',
      enterococcusValue: '300',
      enterococcusStatus: 'Good',
      advisoryStatus: 'Yes',
      latitude: '25.86425',
      longitude: '-80.11905',
    }],
  };
  const cleanBeach = {
    id: '84c24bef-28ba-40fc-bb5f-db084028d790',
    name: '53RD ST - MIAMI BEACH',
    slug: '53rd-st-miami-beach',
    data: [{
      updatedAt: '2026-07-10T06:00:38.961622+00:00',
      sampleDate: '7/7/2026',
      enterococcusValue: '22',
      enterococcusStatus: 'Good',
      advisoryStatus: 'No',
      latitude: '25.83100573',
      longitude: '-80.11923913',
    }],
  };
  const unsampledBeach = { id: 'x', name: 'NEW BEACH', slug: 'new-beach', data: [] };

  test('maps advisoryStatus (not enterococcusStatus) to status: advisory/good', () => {
    const beaches = beachAdvisories.parseBeachAdvisories(pageHtml([barkBeach, cleanBeach]));
    expect(beaches).toHaveLength(2);
    const bark = beaches.find(b => b.name === 'BARK BEACH');
    expect(bark).toMatchObject({
      status: 'advisory',
      value: 300,
      sampleDate: '2026-07-08',
      url: 'https://www.floridahealthybeaches.com/county/dade/beach/bark-beach',
    });
    expect(bark.lat).toBeCloseTo(25.86425);
    expect(bark.lng).toBeCloseTo(-80.11905);
    const clean = beaches.find(b => b.name === '53RD ST - MIAMI BEACH');
    expect(clean.status).toBe('good');
  });

  test('a beach with no samples yet gets status "good" and null value, not a throw', () => {
    const beaches = beachAdvisories.parseBeachAdvisories(pageHtml([unsampledBeach]));
    expect(beaches).toEqual([expect.objectContaining({ name: 'NEW BEACH', status: 'good', value: null, sampleDate: '' })]);
  });

  test('@negative returns an empty array when __NEXT_DATA__ is missing or unparsable', () => {
    expect(beachAdvisories.parseBeachAdvisories('<html><body>no data here</body></html>')).toEqual([]);
    expect(beachAdvisories.parseBeachAdvisories('')).toEqual([]);
    expect(beachAdvisories.parseBeachAdvisories('<script id="__NEXT_DATA__">not json</script>')).toEqual([]);
  });
});

test.describe('Backend: beach-advisories-fetch — parseSampleDate', { tag: ['@backend'] }, () => {
  test('converts M/D/YYYY to ISO YYYY-MM-DD, zero-padded', () => {
    expect(beachAdvisories.parseSampleDate('7/8/2026')).toBe('2026-07-08');
    expect(beachAdvisories.parseSampleDate('12/25/2026')).toBe('2026-12-25');
  });

  test('@negative returns empty string for missing/malformed input', () => {
    expect(beachAdvisories.parseSampleDate('')).toBe('');
    expect(beachAdvisories.parseSampleDate(undefined)).toBe('');
    expect(beachAdvisories.parseSampleDate('not-a-date')).toBe('');
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

test.describe('Backend: /qr redirect — resolveQrDestination', { tag: ['@backend'] }, () => {
  const ORIGIN = 'https://miami-ride.example.com';
  const content = {
    guide: {
      venues: [
        { id: 'v001', website: 'https://versaillesrestaurant.com', address: '3555 SW 8th St, Miami, FL' },
        { id: 'v002', website: '', address: '100 Ocean Dr, Miami, FL' },
      ],
      events: [{ id: 'e1', url: 'https://tickets.example.com/e1' }, { id: 'e2' }],
    },
    advisories: { items: [{ id: 'a1', sourceUrl: 'https://healthybeaches.example.com/a1' }] },
    driver: { thumbtack: { url: 'https://www.thumbtack.com/pro/123' } },
  };

  test('app type redirects to the app origin itself, no content.json needed', () => {
    expect(worker.resolveQrDestination('app', null, null, ORIGIN)).toBe(ORIGIN);
  });

  test('the three hardcoded My Apps QR types resolve without content.json', () => {
    expect(worker.resolveQrDestination('app-soflo', null, null, ORIGIN)).toBe('https://soflo-vegan-eateries.miamivegan2026.workers.dev/');
    expect(worker.resolveQrDestination('app-lifeos', null, null, ORIGIN)).toBe('https://unalplanner.netlify.app/');
    expect(worker.resolveQrDestination('app-tend', null, null, ORIGIN)).toBe('https://tend-dma.pages.dev/');
  });

  test('venue type prefers the venue website', () => {
    expect(worker.resolveQrDestination('venue', 'v001', content, ORIGIN)).toBe('https://versaillesrestaurant.com');
  });

  test('venue type falls back to a Google Maps search when there is no website', () => {
    const dest = worker.resolveQrDestination('venue', 'v002', content, ORIGIN);
    expect(dest).toBe('https://maps.google.com/?q=' + encodeURIComponent('100 Ocean Dr, Miami, FL'));
  });

  test('event, advisory, and driver-thumbtack types resolve their respective URLs', () => {
    expect(worker.resolveQrDestination('event', 'e1', content, ORIGIN)).toBe('https://tickets.example.com/e1');
    expect(worker.resolveQrDestination('advisory', 'a1', content, ORIGIN)).toBe('https://healthybeaches.example.com/a1');
    expect(worker.resolveQrDestination('driver-thumbtack', null, content, ORIGIN)).toBe('https://www.thumbtack.com/pro/123');
  });

  test('@negative returns null for an unknown id, missing url, or unrecognized type', () => {
    expect(worker.resolveQrDestination('venue', 'v999', content, ORIGIN)).toBeNull();
    expect(worker.resolveQrDestination('event', 'e2', content, ORIGIN)).toBeNull();
    expect(worker.resolveQrDestination('driver-phone', null, content, ORIGIN)).toBeNull();
  });

  test('@negative returns null (not a throw) when content.json failed to load', () => {
    expect(worker.resolveQrDestination('venue', 'v001', null, ORIGIN)).toBeNull();
    expect(worker.resolveQrDestination('advisory', 'a1', null, ORIGIN)).toBeNull();
  });
});

// In-memory KV stub for trackClick/trackQrScan — real increment() is get-then-put,
// no need for a live namespace to verify which keys get bumped.
function makeMockKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, val) { store.set(key, val); },
  };
}

test.describe('Backend: trackClick / trackQrScan — day + hour buckets', { tag: ['@backend'] }, () => {
  test('trackClick increments total, source, day, and hour:day:HH', async () => {
    const kv = makeMockKv();
    await worker.trackClick(kv, 'card');
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const hour = now.slice(11, 13);
    expect(kv.store.get('total')).toBe('1');
    expect(kv.store.get('src:card')).toBe('1');
    expect(kv.store.get('day:' + day)).toBe('1');
    expect(kv.store.get('hour:' + day + ':' + hour)).toBe('1');
  });

  test('trackQrScan increments qr:total, qr:type, qr:day, qr:hour:day:HH, and qr:id when id given', async () => {
    const kv = makeMockKv();
    await worker.trackQrScan(kv, 'venue', 'v009');
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const hour = now.slice(11, 13);
    expect(kv.store.get('qr:total')).toBe('1');
    expect(kv.store.get('qr:type:venue')).toBe('1');
    expect(kv.store.get('qr:day:' + day)).toBe('1');
    expect(kv.store.get('qr:hour:' + day + ':' + hour)).toBe('1');
    expect(kv.store.get('qr:id:venue:v009')).toBe('1');
  });

  test('@negative trackQrScan skips qr:id when id is null', async () => {
    const kv = makeMockKv();
    await worker.trackQrScan(kv, 'app', null);
    expect(kv.store.get('qr:total')).toBe('1');
    expect([...kv.store.keys()].some((k) => k.startsWith('qr:id:'))).toBe(false);
  });

  test('repeated calls accumulate the same hour bucket', async () => {
    const kv = makeMockKv();
    await worker.trackClick(kv, 'card');
    await worker.trackClick(kv, 'card');
    const day = new Date().toISOString().slice(0, 10);
    const hour = new Date().toISOString().slice(11, 13);
    expect(kv.store.get('hour:' + day + ':' + hour)).toBe('2');
    expect(kv.store.get('total')).toBe('2');
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
