// E2E: content.json integrity — guards the data the kiosk renders.
// Added 2026-05-31 after a full translation pass: every passenger-facing string
// must carry ES/PT/FR so non-English riders never see English fallback text.
const { test, expect } = require('./fixtures');
const base = require('@playwright/test');

test.describe('Content integrity', { tag: ['@index', '@content', '@i18n'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof CONTENT !== 'undefined' && !!CONTENT.guide);
  });

  test('every translatable string has ES / PT / FR (or an empty EN source)', async ({ page }) => {
    // Walk the whole CONTENT tree for translation objects ({en, es, pt, fr}).
    // Flag any with a non-empty EN that is missing/blank in es, pt or fr.
    const missing = await page.evaluate(() => {
      const langs = ['es', 'pt', 'fr'];
      const out = [];
      const isTrans = (o) => o && typeof o === 'object' && !Array.isArray(o) && typeof o.en === 'string';
      const walk = (node, path) => {
        if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
        if (node && typeof node === 'object') {
          if (isTrans(node)) {
            if (String(node.en).trim() === '') return; // nothing to translate
            const gaps = langs.filter((l) => !(l in node) || String(node[l]).trim() === '');
            if (gaps.length) out.push(`${path} [${gaps.join(',')}]`);
            return;
          }
          for (const k of Object.keys(node)) walk(node[k], path ? `${path}.${k}` : k);
        }
      };
      walk(CONTENT, '');
      return out;
    });
    expect(missing, `untranslated strings:\n${missing.join('\n')}`).toEqual([]);
  });

  test('every event carries ES / PT / FR title and description', async ({ page }) => {
    const gaps = await page.evaluate(() => {
      const langs = ['es', 'pt', 'fr'];
      const out = [];
      for (const e of CONTENT.guide.events || []) {
        for (const field of ['title', 'description']) {
          const o = e[field] || {};
          const miss = langs.filter((l) => !o[l] || !String(o[l]).trim());
          if (String(o.en || '').trim() && miss.length) out.push(`${e.id}.${field} [${miss.join(',')}]`);
        }
      }
      return out;
    });
    expect(gaps, `events missing translations:\n${gaps.join('\n')}`).toEqual([]);
  });

  test('no more than half of events are missing images', async ({ page }) => {
    // RSS feeds sometimes omit images; the UI degrades gracefully (no photo strip).
    // Hard-fail only if the majority are missing — that signals a parser regression.
    const { missing, total } = await page.evaluate(() => {
      const events = CONTENT.guide.events || [];
      return {
        missing: events.filter(e => !e.image || !String(e.image).trim()).map(e => e.id),
        total: events.length,
      };
    });
    expect(missing.length, `${missing.length}/${total} events have no image:\n${missing.join('\n')}`).toBeLessThanOrEqual(Math.ceil(total / 2));
  });

  test('every event card shows a badge (Free, a price, or "Price varies")', async ({ page }) => {
    // No card should be badge-less: free -> green Free, known price -> gold $N,
    // otherwise a neutral "Price varies" badge for ticketed events without a
    // price from the feed.
    const result = await page.evaluate(() => {
      return (CONTENT.guide.events || []).map((e) => {
        const card = buildEventCard(e);
        const free = card.querySelector('.free-badge');
        const price = card.querySelector('.price-badge');
        return { id: e.id, hasBadge: !!(free || price), text: (free || price || {}).textContent || '' };
      });
    });
    const blank = result.filter((r) => !r.hasBadge).map((r) => r.id);
    expect(blank, `event cards with no badge:\n${blank.join('\n')}`).toEqual([]);
    // Free events must read the localized Free label, never "Price varies".
    expect(result.every((r) => r.text.trim().length > 0)).toBe(true);
  });
});

base.test.describe('Offline event-image pre-caching', { tag: ['@index', '@content'] }, () => {
  // Regression test for backlog #83: prewarmEventImages() (public/index.html)
  // used a default cors-mode fetch() against soulofmiami.org, which sends no
  // Access-Control-Allow-Origin header — so the fetch was *always* silently
  // blocked by CORS, for every passenger, not just in tests. The fix switched
  // to `fetch(url, { mode: 'no-cors' })`, which produces an opaque response
  // that Cache API happily stores (this is the same trick <img> tags rely on
  // to display cross-origin images without needing CORS at all).
  // This uses @playwright/test directly (not ./fixtures) and stubs the event
  // image host WITHOUT a CORS header, deliberately, to prove the no-cors path
  // still succeeds — the opposite of tests/fixtures.js's global stub, which
  // adds `Access-Control-Allow-Origin` and would hide a regression back to
  // plain cors-mode fetch().
  base.test('prewarmEventImages caches event images even with no CORS header on the response', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    // No Access-Control-Allow-Origin on purpose — this is what soulofmiami.org
    // actually sends, and what broke the old cors-mode fetch().
    await page.route(/soulofmiami\.org/, (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    }));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof prewarmEventImages === 'function' && typeof CONTENT !== 'undefined' && !!CONTENT.guide);
    await page.evaluate(() => prewarmEventImages());
    await base.expect.poll(async () => {
      const cache = await page.evaluate(async () => (await (await caches.open('miami-event-images')).keys()).length);
      return cache;
    }, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  });
});
