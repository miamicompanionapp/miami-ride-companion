// E2E: content.json integrity — guards the data the kiosk renders.
// Added 2026-05-31 after a full translation pass: every passenger-facing string
// must carry ES/PT/FR so non-English riders never see English fallback text.
const { test, expect } = require('./fixtures');

test.describe('Content integrity', () => {
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
});
