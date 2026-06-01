// Unit tests for the games' scoring + state logic (public/index.html).
// games.spec.js covers translations and passenger.spec.js covers open/close;
// this file pins the actual SCORING and the answer/guess guards — including the
// "can't answer twice" guards that protect the score.
//
// Tags: @games @unit  →  `npm run test:games` covers all game tests.
//
// Base runner (not ./fixtures): pure scoring assertions shouldn't fail on an
// unrelated background resource blip.
const { test, expect } = require('@playwright/test');

test.describe('Trivia scoring', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof TRIVIA_QUESTIONS !== 'undefined');
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('trivia'); triviaNext(); }); // start → show Q1
  });

  test('a correct answer increments the score and marks the right option', async ({ page }) => {
    const res = await page.evaluate(() => {
      const correct = triviaCurrent.a;
      answerTrivia(correct, correct);
      const btns = [...document.querySelectorAll('.trivia-opt')];
      return { score: triviaScore, scoreTxt: document.getElementById('trivia-score').textContent, marked: btns[correct].classList.contains('correct'), nextShown: document.getElementById('trivia-next').classList.contains('show') };
    });
    expect(res.score).toBe(1);
    expect(res.scoreTxt).toBe('1');
    expect(res.marked).toBe(true);
    expect(res.nextShown).toBe(true);
  });

  test('a wrong answer leaves the score at 0 and marks chosen + correct', async ({ page }) => {
    const res = await page.evaluate(() => {
      const correct = triviaCurrent.a;
      const wrong = (correct + 1) % triviaCurrent.opts.length;
      answerTrivia(wrong, correct);
      const btns = [...document.querySelectorAll('.trivia-opt')];
      return { score: triviaScore, wrongMarked: btns[wrong].classList.contains('wrong'), correctMarked: btns[correct].classList.contains('correct') };
    });
    expect(res.score).toBe(0);
    expect(res.wrongMarked).toBe(true);
    expect(res.correctMarked).toBe(true);
  });

  test('@negative answering twice does not double-count (answered guard)', async ({ page }) => {
    const score = await page.evaluate(() => {
      const correct = triviaCurrent.a;
      answerTrivia(correct, correct);
      answerTrivia(correct, correct); // ignored — triviaAnswered is set
      return triviaScore;
    });
    expect(score).toBe(1);
  });
});

test.describe('Guess-the-Image scoring', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof IMG_ROUNDS !== 'undefined' && typeof openGame === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => openGame('image'));
    await page.waitForSelector('#img-opts .img-opt');
  });

  test('a correct guess increments the score and reveals Next', async ({ page }) => {
    const res = await page.evaluate(() => {
      const c = imgCurrent.a;
      answerImg(c, c, imgCurrent.explain);
      return { score: imgScore, scoreTxt: document.getElementById('img-score').textContent, nextShown: document.getElementById('img-next').classList.contains('show') };
    });
    expect(res.score).toBe(1);
    expect(res.scoreTxt).toBe('1');
    expect(res.nextShown).toBe(true);
  });

  test('a wrong guess leaves the score at 0', async ({ page }) => {
    const score = await page.evaluate(() => {
      const c = imgCurrent.a;
      const wrong = (c + 1) % document.querySelectorAll('.img-opt').length;
      answerImg(wrong, c, imgCurrent.explain);
      return imgScore;
    });
    expect(score).toBe(0);
  });

  test('@negative answering twice does not double-count', async ({ page }) => {
    const score = await page.evaluate(() => {
      const c = imgCurrent.a;
      answerImg(c, c, imgCurrent.explain);
      answerImg(c, c, imgCurrent.explain);
      return imgScore;
    });
    expect(score).toBe(1);
  });
});

test.describe('Word puzzle', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof WORD_LIST !== 'undefined' && typeof openGame === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('word'); wordCurrent = WORD_LIST[0]; wordHinted = []; renderWordLetters(); });
  });

  test('a correct guess increments solved and shows the win feedback', async ({ page }) => {
    const res = await page.evaluate(() => {
      const before = wordSolved;
      document.getElementById('word-input').value = WORD_LIST[0].word.toLowerCase(); // case-insensitive
      checkWord();
      return { delta: wordSolved - before, fb: document.getElementById('word-feedback').className };
    });
    expect(res.delta).toBe(1);
    expect(res.fb).toContain('ok');
  });

  test('a wrong guess does not increment solved and shows the retry feedback', async ({ page }) => {
    const res = await page.evaluate(() => {
      const before = wordSolved;
      document.getElementById('word-input').value = 'WRONGGUESS';
      checkWord();
      return { delta: wordSolved - before, fb: document.getElementById('word-feedback').className };
    });
    expect(res.delta).toBe(0);
    expect(res.fb).toContain('no');
  });

  test('@negative an empty guess is a no-op (no feedback shown)', async ({ page }) => {
    const res = await page.evaluate(() => {
      const before = wordSolved;
      document.getElementById('word-input').value = '   ';
      checkWord();
      return { delta: wordSolved - before, shown: document.getElementById('word-feedback').className.includes('show') };
    });
    expect(res.delta).toBe(0);
    expect(res.shown).toBe(false);
  });

  test('a hint reveals exactly one more letter; exhausted hints are a no-op', async ({ page }) => {
    const res = await page.evaluate(() => {
      const start = wordHinted.length;
      wordHint();
      const afterOne = wordHinted.length;
      // Reveal everything, then one extra hint must not over-fill.
      for (let i = 0; i < WORD_LIST[0].word.length + 2; i++) wordHint();
      return { start, afterOne, capped: wordHinted.length };
    });
    expect(res.start).toBe(0);
    expect(res.afterOne).toBe(1);
    expect(res.capped).toBe(await page.evaluate(() => WORD_LIST[0].word.length));
  });
});

test.describe('Tap Frenzy guards', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof openGame === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => openGame('tap'));
  });

  test('@negative tapping before Start does not count', async ({ page }) => {
    const count = await page.evaluate(() => { doTap(); doTap(); return tapCount; });
    expect(count).toBe(0);
  });

  test('Start enables tapping and taps register; a second Start is ignored', async ({ page }) => {
    const res = await page.evaluate(() => {
      startTap();
      const running1 = tapRunning;
      doTap(); doTap(); doTap();
      startTap(); // already running → ignored, must not reset the count
      return { running1, count: tapCount, stillRunning: tapRunning };
    });
    expect(res.running1).toBe(true);
    expect(res.count).toBe(3);
    expect(res.stillRunning).toBe(true);
  });
});
