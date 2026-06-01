// E2E: the "Still browsing?" inactivity popup must not leak the dismissing tap
// into the game underneath, and games must never be re-shown with a stale board.
// Added 2026-06-01 after a rider reported the Guess-the-Image board breaking
// (dead first tap, wrong answers marked green) right after dismissing the popup.
const { test, expect } = require('./fixtures');

test.describe('Inactivity popup tap handling', { tag: ['@index', '@games'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(
      () => typeof openGame === 'function' && typeof IMG_ROUNDS !== 'undefined'
    );
    await page.locator('#nav-games').click();
  });

  // The exact reported bug: popup is showing over a still-open game, rider taps
  // an option to dismiss it — that tap must ONLY dismiss the popup. We model the
  // real tablet sequence: the tap's touchstart dismisses the popup, then the
  // browser delivers a click which (pre-fix) fell through to the answer button.
  test('tapping to dismiss does not register as a game answer', async ({ page }) => {
    await page.evaluate(() => openGame('image'));
    await page.waitForSelector('#img-opts .img-opt');

    const result = await page.evaluate(() => {
      const overlay = document.getElementById('inactivity-overlay');
      overlay.classList.add('visible'); // popup is up over a live board
      const btn = document.querySelector('#img-opts .img-opt');

      overlay.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      return { answered: imgAnswered, stillVisible: overlay.classList.contains('visible') };
    });

    expect(result.answered, 'dismiss tap must not answer the question').toBe(false);
    expect(result.stillVisible, 'tap should dismiss the popup').toBe(false);
  });

  test('image game is fresh after close + reopen (no stale answered board)', async ({ page }) => {
    await page.evaluate(() => openGame('image'));
    await page.waitForSelector('#img-opts .img-opt');
    await page.evaluate(() => answerImg(imgCurrent.a, imgCurrent.a, imgCurrent.explain));
    expect(await page.evaluate(() => imgAnswered)).toBe(true);

    await page.evaluate(() => { closeGame(); openGame('image'); });
    await page.waitForSelector('#img-opts .img-opt');

    const state = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('#img-opts .img-opt')];
      return {
        answered: imgAnswered,
        marked: opts.some(b => b.classList.contains('correct') || b.classList.contains('wrong') || b.disabled),
        nextShown: document.getElementById('img-next').classList.contains('show'),
        score: document.getElementById('img-score').textContent,
      };
    });
    expect(state.answered).toBe(false);
    expect(state.marked, 'no leftover correct/wrong/disabled buttons').toBe(false);
    expect(state.nextShown, 'Next button hidden on a fresh round').toBe(false);
    expect(state.score).toBe('0');
  });

  test('tap game resets and its timer is stopped on close', async ({ page }) => {
    await page.evaluate(() => { openGame('tap'); startTap(); doTap(); doTap(); });
    expect(await page.evaluate(() => tapCount)).toBe(2);
    expect(await page.evaluate(() => tapRunning)).toBe(true);

    await page.evaluate(() => closeGame());
    expect(await page.evaluate(() => tapRunning), 'countdown stopped on close').toBe(false);

    await page.evaluate(() => openGame('tap'));
    const st = await page.evaluate(() => ({
      count: tapCount,
      countTxt: document.getElementById('tap-count').textContent,
      circleDisabled: document.getElementById('tap-circle').disabled,
      startDisabled: document.getElementById('tap-start-btn').disabled,
    }));
    expect(st.count).toBe(0);
    expect(st.countTxt).toBe('0');
    expect(st.circleDisabled, 'tap circle disabled until Start').toBe(true);
    expect(st.startDisabled, 'Start button enabled').toBe(false);
  });

  test('spinner resets its spin count on close + reopen', async ({ page }) => {
    await page.evaluate(() => { openGame('spin'); doSpin(); doSpin(); });
    expect(await page.evaluate(() => spinCount)).toBe(2);

    await page.evaluate(() => { closeGame(); openGame('spin'); });
    expect(await page.evaluate(() => spinCount)).toBe(0);
    expect(await page.evaluate(() => document.getElementById('spin-count').textContent)).toBe('0');
  });

  // Issue 3: a late image load from a previous round must not paint over the
  // current round. The load token bumps every round, which is what gates it.
  test('image load token advances each round', async ({ page }) => {
    await page.evaluate(() => openGame('image'));
    const t1 = await page.evaluate(() => imgLoadToken);
    await page.evaluate(() => { imgRound++; loadImgRound(); });
    const t2 = await page.evaluate(() => imgLoadToken);
    expect(t2).toBeGreaterThan(t1);
  });
});
