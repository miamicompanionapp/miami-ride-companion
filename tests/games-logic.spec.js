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

test.describe('Tic-Tac-Toe (2P hot-seat)', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof tttMove === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('ttt'); tttStart(); }); // intro → live board
  });

  test('alternates X/O and X starts the first round', async ({ page }) => {
    const res = await page.evaluate(() => {
      const first = tttTurn;        // round 1 opener
      tttMove(0);                   // X plays
      const afterX = tttTurn;
      tttMove(1);                   // O plays
      return { first, afterX, afterO: tttTurn, b0: tttBoard[0], b1: tttBoard[1] };
    });
    expect(res.first).toBe('X');
    expect(res.afterX).toBe('O');
    expect(res.afterO).toBe('X');
    expect(res.b0).toBe('X');
    expect(res.b1).toBe('O');
  });

  test('a top-row win is detected, tallied, and highlights the line', async ({ page }) => {
    const res = await page.evaluate(() => {
      // X: 0,1,2  O: 3,4  → X wins top row
      tttMove(0); tttMove(3); tttMove(1); tttMove(4); tttMove(2);
      const cells = [...document.querySelectorAll('.ttt-cell')];
      return {
        over: tttOver,
        xWins: tttWins.X,
        line: tttWinningLine(),
        winCells: cells.filter(c => c.classList.contains('win')).length,
        banner: document.getElementById('ttt-banner').textContent,
      };
    });
    expect(res.over).toBe(true);
    expect(res.xWins).toBe(1);
    expect(res.line).toEqual([0, 1, 2]);
    expect(res.winCells).toBe(3);
    expect(res.banner).toContain('🎉');
  });

  test('@negative cannot play a taken cell or move after the game is over', async ({ page }) => {
    const res = await page.evaluate(() => {
      tttMove(0);            // X
      tttMove(0);            // taken → ignored
      const stillX_O = tttBoard[0];
      const turnAfterDupe = tttTurn; // should have advanced only once (now O)
      // Now finish a win and try to keep playing.
      tttMove(3); tttMove(1); tttMove(4); tttMove(2); // X wins
      const winsBefore = tttWins.X;
      tttMove(5);            // game over → ignored
      return { stillX_O, turnAfterDupe, winsBefore, winsAfter: tttWins.X, b5: tttBoard[5] };
    });
    expect(res.stillX_O).toBe('X');
    expect(res.turnAfterDupe).toBe('O');
    expect(res.winsAfter).toBe(res.winsBefore);
    expect(res.b5).toBe('');
  });

  test('loser goes first: the loser of a round opens the next one', async ({ page }) => {
    const starter = await page.evaluate(() => {
      // O wins this round: X 0,1 / O 3,4,5
      tttMove(0); tttMove(3); tttMove(1); tttMove(4); tttMove(8); tttMove(5);
      tttPlayAgain();        // next round
      return tttTurn;        // loser (X) should open
    });
    expect(starter).toBe('X');
  });

  test('a full board with no line is a draw (no win tallied)', async ({ page }) => {
    const res = await page.evaluate(() => {
      // Draw layout (X O X / X O O / O X X), ordered so no line forms early.
      [0,1,2,4,3,5,7,6,8].forEach(i => tttMove(i));
      return { over: tttOver, line: tttWinningLine(), wins: tttWins, banner: document.getElementById('ttt-banner').textContent };
    });
    expect(res.over).toBe(true);
    expect(res.line).toBe(null);
    expect(res.wins).toEqual({ X: 0, O: 0 });
    expect(res.banner).toContain('🤝');
  });
});

test.describe('Tap Duel (reaction race, 2-3P)', { tag: ['@games', '@unit'] }, () => {
  // Start the game, then kill the random "go green" timer so the test drives the
  // arming → green flip deterministically via duelGo().
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof duelTap === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('duel'); duelStart(); clearDuelTimer(); });
  });

  test('a tap after the zones go green wins the round and tallies it', async ({ page }) => {
    const res = await page.evaluate(() => {
      duelGo();          // arming → green
      duelTap(0);        // P1 taps first
      return { phase: duelPhase, winner: duelWinner, wins: duelWins.slice(0, 2),
               zones: document.querySelectorAll('#duel-zones .duel-zone').length,
               banner: document.getElementById('duel-banner').textContent };
    });
    expect(res.phase).toBe('done');
    expect(res.winner).toBe(0);
    expect(res.wins).toEqual([1, 0]);
    expect(res.zones).toBe(2);
    expect(res.banner).toContain('🎉');
  });

  test('@negative a tap while still red is a false start — round void, no tally', async ({ page }) => {
    const res = await page.evaluate(() => {
      duelTap(1);        // tapped during arming (red)
      return { phase: duelPhase, winner: duelWinner, falseStarter: duelFalse, wins: duelWins.slice(0, 2) };
    });
    expect(res.phase).toBe('done');
    expect(res.winner).toBe(null);
    expect(res.falseStarter).toBe(1);
    expect(res.wins).toEqual([0, 0]);   // nobody scores on a false start
  });

  test('@negative once a round is decided, further taps are ignored', async ({ page }) => {
    const wins = await page.evaluate(() => {
      duelGo();
      duelTap(0);        // P1 wins
      duelTap(1);        // late tap — must not count
      duelTap(0);        // double tap — must not double-count
      return duelWins.slice(0, 2);
    });
    expect(wins).toEqual([1, 0]);
  });

  test('the player-count picker drives how many zones are built', async ({ page }) => {
    const res = await page.evaluate(() => {
      // reopen with 3 players selected
      openGame('duel'); pgSetCount('duel-count', 3); duelStart(); clearDuelTimer();
      duelGo(); duelTap(2);    // P3 can win
      return { count: duelCount, zones: document.querySelectorAll('#duel-zones .duel-zone').length, winner: duelWinner, wins: duelWins.slice(0, 3) };
    });
    expect(res.count).toBe(3);
    expect(res.zones).toBe(3);
    expect(res.winner).toBe(2);
    expect(res.wins).toEqual([0, 0, 1]);
  });
});

test.describe('Trivia Buzzer (2-3P buzz-in)', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof buzzIn === 'function' && typeof TRIVIA_QUESTIONS !== 'undefined');
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('buzzer'); buzzStart(); }); // 2 players, Q1
  });

  test('buzz in, then a correct answer scores and reveals Next', async ({ page }) => {
    const res = await page.evaluate(() => {
      buzzIn(0);
      buzzAnswer(buzzCurrent.a);
      return { phase: buzzPhase, wins: buzzWins.slice(0, 2), solvedBy: buzzSolvedBy,
               nextShown: document.getElementById('buzz-next').classList.contains('show') };
    });
    expect(res.phase).toBe('revealed');
    expect(res.wins).toEqual([1, 0]);
    expect(res.solvedBy).toBe(0);
    expect(res.nextShown).toBe(true);
  });

  test('a wrong answer locks that player out but lets the others keep buzzing', async ({ page }) => {
    const res = await page.evaluate(() => {
      const wrong = (buzzCurrent.a + 1) % buzzCurrent.opts.length;
      buzzIn(0);
      buzzAnswer(wrong);
      const afterWrong = { phase: buzzPhase, locked0: buzzLocked[0], active: buzzActive, wins: buzzWins.slice(0, 2) };
      buzzIn(0);                 // locked → ignored
      const lockedIgnored = buzzActive;
      buzzIn(1);                 // P2 can still buzz
      return { afterWrong, lockedIgnored, activeAfterP2: buzzActive, phaseAfterP2: buzzPhase };
    });
    expect(res.afterWrong.phase).toBe('buzzing');
    expect(res.afterWrong.locked0).toBe(true);
    expect(res.afterWrong.active).toBe(null);
    expect(res.afterWrong.wins).toEqual([0, 0]);
    expect(res.lockedIgnored).toBe(null);   // locked-out buzz did nothing
    expect(res.activeAfterP2).toBe(1);
    expect(res.phaseAfterP2).toBe('answering');
  });

  test('@negative answering before anyone buzzes is a no-op', async ({ page }) => {
    const res = await page.evaluate(() => {
      buzzAnswer(buzzCurrent.a);  // nobody buzzed → ignored
      return { phase: buzzPhase, wins: buzzWins.slice(0, 2) };
    });
    expect(res.phase).toBe('buzzing');
    expect(res.wins).toEqual([0, 0]);
  });

  test('buzzing in starts a 5-second answer countdown', async ({ page }) => {
    const res = await page.evaluate(() => {
      buzzIn(0);
      clearBuzzTimer();           // freeze it; we only assert the initial state
      return { remaining: buzzRemaining, secs: BUZZ_SECONDS,
               timerShown: document.getElementById('buzz-timer').style.display !== 'none' };
    });
    expect(res.remaining).toBe(res.secs);
    expect(res.secs).toBe(5);
    expect(res.timerShown).toBe(true);
  });

  test('running out of time costs the buzzer a point and reopens the buzz', async ({ page }) => {
    const res = await page.evaluate(() => {
      buzzIn(0);
      buzzTimeout();              // simulate the countdown reaching zero
      return { phase: buzzPhase, wins: buzzWins.slice(0, 2), locked0: buzzLocked[0],
               active: buzzActive, solvedBy: buzzSolvedBy };
    });
    expect(res.wins).toEqual([-1, 0]);   // P1 lost a point; scores may go negative
    expect(res.locked0).toBe(true);
    expect(res.phase).toBe('buzzing');   // P2 can still rescue the question
    expect(res.active).toBe(null);
  });

  test('a wrong answer does NOT cost a point (only timeouts do)', async ({ page }) => {
    const wins = await page.evaluate(() => {
      const wrong = (buzzCurrent.a + 1) % buzzCurrent.opts.length;
      buzzIn(0); buzzAnswer(wrong);
      return buzzWins.slice(0, 2);
    });
    expect(wins).toEqual([0, 0]);
  });

  test('if everyone times out, the question is revealed with no winner and all are penalized', async ({ page }) => {
    const res = await page.evaluate(() => {
      buzzIn(0); buzzTimeout();
      buzzIn(1); buzzTimeout();
      return { phase: buzzPhase, wins: buzzWins.slice(0, 2), solvedBy: buzzSolvedBy,
               nextShown: document.getElementById('buzz-next').classList.contains('show') };
    });
    expect(res.phase).toBe('revealed');
    expect(res.wins).toEqual([-1, -1]);
    expect(res.solvedBy).toBe(null);
    expect(res.nextShown).toBe(true);
  });

  test('when every player answers wrong, the question is revealed with no winner', async ({ page }) => {
    const res = await page.evaluate(() => {
      const wrong = (buzzCurrent.a + 1) % buzzCurrent.opts.length;
      buzzIn(0); buzzAnswer(wrong);
      buzzIn(1); buzzAnswer(wrong);
      return { phase: buzzPhase, solvedBy: buzzSolvedBy, nextShown: document.getElementById('buzz-next').classList.contains('show') };
    });
    expect(res.phase).toBe('revealed');
    expect(res.solvedBy).toBe(null);
    expect(res.nextShown).toBe(true);
  });

  test('finishing the last question shows the end screen with the lead player as winner', async ({ page }) => {
    const res = await page.evaluate(() => {
      buzzWins = [3, 1, 0]; buzzCount = 2;
      buzzQ = TRIVIA_QUESTIONS.length - 1;
      buzzNext();                // advances past the last question → end screen
      return { endVisible: document.getElementById('buzz-end').style.display !== 'none',
               title: document.getElementById('buzz-end-title').textContent };
    });
    expect(res.endVisible).toBe(true);
    expect(res.title).toContain('🏆');
    expect(res.title).toContain('1');   // "Player 1 wins!"
  });
});
