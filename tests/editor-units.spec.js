// Unit tests for the driver dashboard's pure/helper logic (public/editor.html).
// editor.spec.js covers the auth gate + panel rendering (E2E); this file pins
// the data-shaping helpers: escaping, date formatting, analytics roll-up,
// the driver-translation flatten/apply roundtrip, and the event mutations —
// each with negative cases.
//
// Tags: @editor @unit  →  `npm run test:editor` covers all dashboard tests.
// Base runner (not ./fixtures): pure-logic assertions, no console-error gate.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Unlock once per test so init() has loaded CONTENT (the default PIN per CLAUDE.md).
async function unlock(page) {
  await page.goto('/editor.html');
  await page.waitForSelector('#auth-screen');
  await page.fill('#auth-input', '1234');
  await page.click('.auth-btn');
  await page.waitForFunction(() => typeof CONTENT !== 'undefined' && !!CONTENT && !!CONTENT.guide);
}

test.describe('Editor units: string + date helpers', { tag: ['@editor', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => unlock(page));

  test('escapeAttr neutralizes the HTML-significant characters', async ({ page }) => {
    const out = await page.evaluate(() => escapeAttr('a & "b" <script>'));
    expect(out).toBe('a &amp; &quot;b&quot; &lt;script&gt;');
  });

  test('@negative escapeAttr escapes & first so it cannot double-encode entities', async ({ page }) => {
    // If & were escaped after <, the result would corrupt to &amp;lt;.
    const out = await page.evaluate(() => escapeAttr('<b> & </b>'));
    expect(out).toBe('&lt;b&gt; &amp; &lt;/b&gt;');
  });

  test('fmtEventDate renders a real date and is empty-safe', async ({ page }) => {
    const out = await page.evaluate(() => ({ real: fmtEventDate('2026-06-21'), empty: fmtEventDate('') }));
    expect(out.real).toContain('2026');
    expect(out.real).toContain('21');
    expect(out.empty).toBe('');
  });

  test('@negative fmtEventDate returns the raw string when it is unparseable', async ({ page }) => {
    expect(await page.evaluate(() => fmtEventDate('not-a-date'))).toBe('not-a-date');
  });

  test('eventTodayStr returns local ISO YYYY-MM-DD', async ({ page }) => {
    const out = await page.evaluate(() => {
      const n = new Date();
      const expected = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
      return { val: eventTodayStr(), expected };
    });
    expect(out.val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.val).toBe(out.expected);
  });

  test('formatDuration formats m + zero-padded seconds', async ({ page }) => {
    const out = await page.evaluate(() => [formatDuration(0), formatDuration(65), formatDuration(3661)]);
    expect(out).toEqual(['0m00s', '1m05s', '61m01s']);
  });
});

test.describe('Editor units: analytics roll-up', { tag: ['@editor', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => unlock(page));

  test('summarizeAnalytics aggregates sessions, duration, QR, tabs, langs, top venues', async ({ page }) => {
    const s = await page.evaluate(() => summarizeAnalytics({
      sessions: [{ duration: 60, lang: 'es' }, { duration: 120, lang: 'en' }],
      taps: [
        { key: 'tab_guide' }, { key: 'tab_games' },
        { key: 'qr_app' },
        { key: 'venue_v1' }, { key: 'venue_v1' },
        { key: 'venue_sheet_v1' }, // sheet-opens are excluded from venue tap counts
      ],
    }));
    expect(s.sessions).toBe(2);
    expect(s.avgDuration).toBe(90);
    expect(s.qrTaps).toBe(1);
    expect(s.tabCounts['City Guide']).toBe(1);
    expect(s.tabCounts.Games).toBe(1);
    expect(s.langCounts).toEqual({ es: 1, en: 1 });
    expect(s.topVenues[0]).toMatchObject({ id: 'v1', taps: 2 });
  });

  test('@negative summarizeAnalytics handles no data without dividing by zero', async ({ page }) => {
    const s = await page.evaluate(() => summarizeAnalytics({ sessions: [], taps: [] }));
    expect(s).toMatchObject({ sessions: 0, avgDuration: 0, qrTaps: 0 });
    expect(s.topVenues).toEqual([]);
  });

  test('venueName resolves a real venue id, falls back to the id otherwise', async ({ page }) => {
    const out = await page.evaluate(() => {
      const first = CONTENT.guide.venues[0];
      return { real: venueName(first.id), realName: first.name, bad: venueName('no-such-id') };
    });
    expect(out.real).toBe(out.realName);
    expect(out.bad).toBe('no-such-id');
  });
});

test.describe('Editor units: driver translation flatten/apply', { tag: ['@editor', '@unit', '@i18n'] }, () => {
  test.beforeEach(async ({ page }) => unlock(page));

  test('buildDriverTranslationInput flattens the English driver fields', async ({ page }) => {
    const out = await page.evaluate(() => {
      const input = buildDriverTranslationInput();
      return { roleKey: input.role, roleEn: (CONTENT.driver.role || {}).en, keyCount: Object.keys(input).length };
    });
    expect(out.keyCount).toBeGreaterThan(0);
    expect(out.roleKey).toBe(out.roleEn);
  });

  test('applyDriverTranslations writes es/pt/fr back and reports the count applied', async ({ page }) => {
    const out = await page.evaluate(() => {
      const input = buildDriverTranslationInput();
      const fake = {};
      Object.keys(input).forEach((k) => { fake[k] = { es: 'ES_' + k, pt: 'PT_' + k, fr: 'FR_' + k }; });
      const applied = applyDriverTranslations(fake);
      return { applied, roleEs: (CONTENT.driver.role || {}).es };
    });
    expect(out.applied).toBeGreaterThan(0);
    expect(out.roleEs).toBe('ES_role');
  });

  test('@negative applyDriverTranslations ignores unknown keys and non-object values', async ({ page }) => {
    const applied = await page.evaluate(() => applyDriverTranslations({ bogus_key: { es: 'x' }, role: 'not-an-object' }));
    expect(applied).toBe(0);
  });
});

test.describe('Editor units: event mutations', { tag: ['@editor', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await page.evaluate(() => showPanel('events'));
  });

  test('addManualEvent appends an event and clears the form', async ({ page }) => {
    const out = await page.evaluate(() => {
      const before = CONTENT.guide.events.length;
      document.getElementById('new-event-title-en').value = 'Test Gala';
      document.getElementById('new-event-date').value = '2099-12-31';
      document.getElementById('new-event-venue').value = 'Test Hall';
      addManualEvent();
      const added = CONTENT.guide.events[CONTENT.guide.events.length - 1];
      return { delta: CONTENT.guide.events.length - before, title: added.title.en, venue: added.venue, cleared: document.getElementById('new-event-title-en').value };
    });
    expect(out.delta).toBe(1);
    expect(out.title).toBe('Test Gala');
    expect(out.venue).toBe('Test Hall');
    expect(out.cleared).toBe('');
  });

  test('@negative addManualEvent refuses when title or date is missing', async ({ page }) => {
    const delta = await page.evaluate(() => {
      const before = CONTENT.guide.events.length;
      document.getElementById('new-event-title-en').value = 'No Date';
      document.getElementById('new-event-date').value = '';
      addManualEvent();
      return CONTENT.guide.events.length - before;
    });
    expect(delta).toBe(0);
  });

  test('removePastEvents drops only past-dated events, keeps today/future/undated', async ({ page }) => {
    const out = await page.evaluate(() => {
      CONTENT.guide.events = [
        { id: 'past', date: '2000-01-01', title: { en: 'Past' }, description: { en: '' } },
        { id: 'future', date: '2099-01-01', title: { en: 'Future' }, description: { en: '' } },
        { id: 'undated', title: { en: 'Undated' }, description: { en: '' } },
      ];
      removePastEvents();
      return CONTENT.guide.events.map((e) => e.id);
    });
    expect(out).not.toContain('past');
    expect(out).toEqual(expect.arrayContaining(['future', 'undated']));
  });
});

test.describe('Editor units: PIN + publish guards', { tag: ['@editor', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => unlock(page));

  test('changePIN persists a new matching PIN to localStorage', async ({ page }) => {
    const stored = await page.evaluate(() => {
      document.getElementById('new-pin').value = '4321';
      document.getElementById('confirm-pin').value = '4321';
      changePIN();
      return localStorage.getItem('editorPIN');
    });
    expect(stored).toBe('4321');
  });

  test('@negative changePIN rejects a mismatch (PIN unchanged)', async ({ page }) => {
    const stored = await page.evaluate(() => {
      localStorage.setItem('editorPIN', '1234');
      document.getElementById('new-pin').value = '5555';
      document.getElementById('confirm-pin').value = '6666';
      changePIN();
      return localStorage.getItem('editorPIN');
    });
    expect(stored).toBe('1234');
  });

  test('@negative publishContent without GitHub settings bounces to the Settings panel', async ({ page }) => {
    await page.evaluate(() => { localStorage.removeItem('githubSettings'); return publishContent(); });
    await expect(page.locator('#panel-settings')).toHaveClass(/active/);
  });
});

test.describe('SW offline fallback page: dashboard opened with no connection', { tag: ['@editor', '@unit'] }, () => {
  test('offline fallback offers both a retry and a way back to the passenger app', () => {
    const swSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
    const match = swSrc.match(/const OFFLINE_EDITOR_HTML = `([\s\S]*?)`;/);
    expect(match).not.toBeNull();
    const html = match[1];
    expect(html).toContain("onclick=\"location.reload()\"");
    expect(html).toContain("onclick=\"location.href='/'\"");
  });
});
