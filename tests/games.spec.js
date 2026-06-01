// E2E: game translations (Trivia, Facts Spinner, Guess the Image).
// Added 2026-05-31 — these games were hardcoded English and never wired into the
// i18n system; this guards both the data (every translatable field has ES/PT/FR)
// and the behavior (open games re-render when the rider switches language).
// NOTE: Tap Frenzy + Word Puzzle are intentionally out of scope (see backlog).
const { test, expect } = require('./fixtures');

test.describe('Game translations', { tag: ['@games', '@i18n'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof TRIVIA_QUESTIONS !== 'undefined' && typeof GAME_UI !== 'undefined');
  });

  test('all translatable game content has ES / PT / FR (proper nouns may stay plain)', async ({ page }) => {
    const gaps = await page.evaluate(() => {
      const langs = ['es', 'pt', 'fr'];
      const out = [];
      // Only {en,...} objects are "translatable"; plain strings are intentional
      // proper nouns (Big Ben, Petra, Pitbull…) that read the same in every language.
      const check = (v, path) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.en === 'string') {
          const miss = langs.filter((l) => !v[l] || !String(v[l]).trim());
          if (miss.length) out.push(`${path} [${miss.join(',')}]`);
        }
      };
      Object.entries(GAME_UI).forEach(([k, v]) => check(v, `GAME_UI.${k}`));
      IMG_END_MSGS.forEach((m, i) => check(m.msg, `IMG_END_MSGS[${i}]`));
      TRIVIA_QUESTIONS.forEach((q, i) => { check(q.q, `TRIVIA[${i}].q`); q.opts.forEach((o, j) => check(o, `TRIVIA[${i}].opts[${j}]`)); });
      SPIN_FACTS.forEach((f, i) => { check(f.cat, `SPIN[${i}].cat`); check(f.fact, `SPIN[${i}].fact`); });
      IMG_ROUNDS.forEach((r, i) => { check(r.hint, `IMG[${i}].hint`); check(r.explain, `IMG[${i}].explain`); r.opts.forEach((o, j) => check(o, `IMG[${i}].opts[${j}]`)); });
      return out;
    });
    expect(gaps, `untranslated game fields:\n${gaps.join('\n')}`).toEqual([]);
  });

  test('trivia question + buttons re-render in Spanish on language switch', async ({ page }) => {
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('trivia'); triviaNext(); }); // start → show Q1 (EN)
    await page.evaluate(() => setLang('es'));
    const shown = await page.locator('#trivia-question').textContent();
    const expected = await page.evaluate(() => `1. ${TRIVIA_QUESTIONS[0].q.es}`);
    expect(shown).toBe(expected);
    // Answering reveals the "next" button — it must be localized, not English.
    await page.locator('#trivia-opts .trivia-opt').first().click();
    const nextTxt = await page.locator('#trivia-next').textContent();
    const expectNext = await page.evaluate(() => GAME_UI.nextQuestion.es);
    expect(nextTxt).toBe(expectNext);
  });

  test('spinner fact re-renders in Portuguese on language switch', async ({ page }) => {
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('spin'); doSpin(); });
    // doSpin populates spinCurrent after a fade-in timeout — wait for it
    // deterministically rather than a fixed sleep (the sleep raced under load).
    await page.waitForFunction(() => typeof spinCurrent !== 'undefined' && spinCurrent && spinCurrent.fact);
    await page.evaluate(() => setLang('pt'));
    const fact = await page.locator('#spin-fact').textContent();
    const expected = await page.evaluate(() => spinCurrent.fact.pt);
    expect(fact).toBe(expected);
  });

  test('image hint re-renders in French on language switch', async ({ page }) => {
    await page.locator('#nav-games').click();
    await page.evaluate(() => openGame('image'));
    await page.evaluate(() => setLang('fr'));
    const hint = await page.locator('#img-hint').textContent();
    const expected = await page.evaluate(() => `💡 ${imgCurrent.hint.fr}`);
    expect(hint).toBe(expected);
  });
});
