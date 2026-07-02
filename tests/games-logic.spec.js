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

// Bypass the PWA install gate — this file uses @playwright/test directly
// (no fixtures.js) so each test gets a fresh page without the bypass initScript.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
});

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

  test('a guess with wrong length shows the letter count hint', async ({ page }) => {
    const text = await page.evaluate(() => {
      const word = WORD_LIST[0].word; // e.g. "SUNSCREEN"
      document.getElementById('word-input').value = word.slice(0, -1); // one letter short
      checkWord();
      return document.getElementById('word-feedback').textContent;
    });
    expect(text).toContain(`${await page.evaluate(() => WORD_LIST[0].word.length)} letters`);
  });

  test('a same-length guess 1 letter off shows "just 1 letter off"', async ({ page }) => {
    const text = await page.evaluate(() => {
      const word = WORD_LIST[0].word;
      // Flip the first character to something different
      const close = (word[0] === 'A' ? 'B' : 'A') + word.slice(1);
      document.getElementById('word-input').value = close;
      checkWord();
      return document.getElementById('word-feedback').textContent;
    });
    expect(text).toContain('1 letter off');
  });

  test('a same-length guess multiple letters off shows the count', async ({ page }) => {
    const text = await page.evaluate(() => {
      const word = WORD_LIST[0].word;
      // Flip first two characters
      const c0 = word[0] === 'A' ? 'B' : 'A';
      const c1 = word[1] === 'A' ? 'B' : 'A';
      const off2 = c0 + c1 + word.slice(2);
      document.getElementById('word-input').value = off2;
      checkWord();
      return document.getElementById('word-feedback').textContent;
    });
    // Should say "X letters off" (not the length hint)
    expect(text).toMatch(/\d+ letters off/);
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

test.describe('Connect Four (#30d)', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof c4Drop === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('c4'); c4Start(); }); // intro → live board
  });

  test('P1 starts, turns alternate, piece lands in lowest empty row', async ({ page }) => {
    const res = await page.evaluate(() => {
      const first = c4Turn;        // P1 opens
      c4Drop(0);                   // P1 drops in col 0 → row 5
      const afterP1 = c4Turn;
      c4Drop(0);                   // P2 drops in col 0 → row 4
      return { first, afterP1, afterP2: c4Turn, row5: c4Board[5][0], row4: c4Board[4][0] };
    });
    expect(res.first).toBe(1);
    expect(res.afterP1).toBe(2);
    expect(res.afterP2).toBe(1);
    expect(res.row5).toBe(1);
    expect(res.row4).toBe(2);
  });

  test('horizontal win is detected and tallied; loser opens next round', async ({ page }) => {
    const res = await page.evaluate(() => {
      // P1: cols 0,1,2,3 wins; P2: cols 4,5,6 (interspersed)
      c4Drop(0); c4Drop(4); c4Drop(1); c4Drop(5); c4Drop(2); c4Drop(6); c4Drop(3);
      return { over: c4Over, p1Wins: c4Wins[1], hasCells: c4WinCells !== null,
               banner: document.getElementById('c4-banner').textContent };
    });
    expect(res.over).toBe(true);
    expect(res.p1Wins).toBe(1);
    expect(res.hasCells).toBe(true);
    expect(res.banner).toContain('🎉');
  });

  test('loser opens next round after a win', async ({ page }) => {
    const starter = await page.evaluate(() => {
      // P1 wins: cols 0,1,2,3; P2: cols 4,5,6
      c4Drop(0); c4Drop(4); c4Drop(1); c4Drop(5); c4Drop(2); c4Drop(6); c4Drop(3);
      c4NewRound();
      return c4Turn; // loser (P2) should open
    });
    expect(starter).toBe(2);
  });

  test('@negative cannot drop into a full column', async ({ page }) => {
    const res = await page.evaluate(() => {
      // Fill column 0 (6 discs alternating without triggering a vertical win):
      // P1: rows 5,3,1; P2: rows 4,2,0
      for (let i = 0; i < 6; i++) {
        // Alternate with col 1 to avoid vertical win in col 0
        c4Drop(0); c4Drop(1);
      }
      // Clear game-over state to re-test the column-full guard
      c4Over = false; c4WinCells = null; c4Turn = 1;
      const topBefore = c4Board[0][0];
      c4Drop(0); // col 0 is full (row 0 !== 0) — should be ignored
      return { topBefore, topAfter: c4Board[0][0] };
    });
    // Whether it's 1 or 2, the cell should remain unchanged after the extra drop
    expect(res.topAfter).toBe(res.topBefore);
  });

  test('@negative cannot move after game over', async ({ page }) => {
    const res = await page.evaluate(() => {
      c4Drop(0); c4Drop(4); c4Drop(1); c4Drop(5); c4Drop(2); c4Drop(6); c4Drop(3);
      const winsAfterEnd = c4Wins[1];
      c4Drop(3); // game already over → ignored
      return { over: c4Over, winsStill: c4Wins[1] === winsAfterEnd };
    });
    expect(res.over).toBe(true);
    expect(res.winsStill).toBe(true);
  });
});

test.describe('Biscayne Dash (Frogger) logic', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof initFrogger === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => openGame('frogger'));
  });

  test('frog starts at bottom-center, score 0, 3 lives', async ({ page }) => {
    const res = await page.evaluate(() => ({
      row: frogRow, col: frogCol,
      score: froggerScore, lives: froggerLives,
      running: froggerRunning,
      expectedRow: FROG_ROWS - 1,
      expectedCol: Math.floor(FROG_COLS / 2),
    }));
    expect(res.row).toBe(res.expectedRow);
    expect(res.col).toBe(res.expectedCol);
    expect(res.score).toBe(0);
    expect(res.lives).toBe(3);
    expect(res.running).toBe(true);
  });

  test('frogMove up/down/left/right adjusts position by 1 cell', async ({ page }) => {
    const res = await page.evaluate(() => {
      const startRow = frogRow, startCol = frogCol;
      frogMove('up');    const afterUp   = { row: frogRow, col: frogCol };
      frogMove('down');  const afterDown = { row: frogRow, col: frogCol };
      frogMove('left');  const afterLeft = { row: frogRow, col: frogCol };
      frogMove('right'); const afterRight= { row: frogRow, col: frogCol };
      return { startRow, startCol, afterUp, afterDown, afterLeft, afterRight };
    });
    expect(res.afterUp.row).toBe(res.startRow - 1);
    expect(res.afterDown.row).toBe(res.startRow);      // back to start
    expect(res.afterLeft.col).toBe(res.startCol - 1);
    expect(res.afterRight.col).toBe(res.startCol);     // back to start
  });

  test('reaching row 0 adds 10 to score and triggers celebration', async ({ page }) => {
    const res = await page.evaluate(() => {
      // Teleport frog to row 1 then step up to goal
      frogRow = 1;
      frogMove('up');   // frogRow === 0 → celebrate
      return { score: froggerScore, celebrating: froggerCelebrating, scoreTxt: document.getElementById('frogger-score').textContent };
    });
    expect(res.score).toBe(10);
    expect(res.scoreTxt).toBe('10');
    expect(res.celebrating).toBe(true);
  });

  test('frogMove is blocked during celebration', async ({ page }) => {
    const res = await page.evaluate(() => {
      frogRow = 1; frogMove('up'); // triggers celebration
      const celebrating = froggerCelebrating;
      const rowDuringCeleb = frogRow; // row 0, frog frozen at goal
      frogMove('up'); frogMove('left'); // blocked — should not change row/col
      return { celebrating, rowDuringCeleb, rowAfterBlocked: frogRow };
    });
    expect(res.celebrating).toBe(true);
    expect(res.rowAfterBlocked).toBe(res.rowDuringCeleb);
  });

  test('frogKill decrements lives and sets dead state', async ({ page }) => {
    const res = await page.evaluate(() => {
      const before = froggerLives;
      frogKill();
      return { before, after: froggerLives, dead: froggerDead, livesEl: document.getElementById('frogger-lives').textContent };
    });
    expect(res.before).toBe(3);
    expect(res.after).toBe(2);
    expect(res.dead).toBe(true);
    expect(res.livesEl).toContain('🐸');
  });

  test('three deaths set froggerOver and show 💀 in lives', async ({ page }) => {
    const res = await page.evaluate(() => {
      frogKill(); frogKill(); frogKill();
      return { over: froggerOver, lives: froggerLives, livesEl: document.getElementById('frogger-lives').textContent };
    });
    expect(res.lives).toBe(0);
    expect(res.over).toBe(true);
    expect(res.livesEl).toBe('💀');
  });

  test('@negative frogMove blocked while dead', async ({ page }) => {
    const res = await page.evaluate(() => {
      frogKill();
      const rowBefore = frogRow;
      frogMove('up');
      return { rowBefore, rowAfter: frogRow };
    });
    expect(res.rowAfter).toBe(res.rowBefore);
  });

  test('@negative frogMove restarts game when froggerOver', async ({ page }) => {
    const res = await page.evaluate(() => {
      froggerScore = 30; froggerOver = true; froggerRunning = false;
      frogMove('up'); // should restart
      return { score: froggerScore, running: froggerRunning, over: froggerOver };
    });
    expect(res.score).toBe(0);
    expect(res.running).toBe(true);
    expect(res.over).toBe(false);
  });
});

test.describe('Miami Wordle hints', { tag: ['@games', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof initWordle === 'function');
    await page.locator('#nav-games').click();
    await page.evaluate(() => { openGame('wordle'); wStartGame(); });
  });

  test('hint button reveals one letter from the answer at a valid position', async ({ page }) => {
    const res = await page.evaluate(() => {
      const answer = wSession[wRound].word;
      wRevealHint();
      return { used: wHintUsed, pos: wHintPos, letter: wHintLetter, correctLetter: answer[wHintPos] };
    });
    expect(res.used).toBe(true);
    expect(res.pos).toBeGreaterThanOrEqual(0);
    expect(res.pos).toBeLessThan(5);
    expect(res.letter).toBe(res.correctLetter);
  });

  test('@negative calling wRevealHint twice is a no-op on the second call', async ({ page }) => {
    const res = await page.evaluate(() => {
      wRevealHint();
      const pos1 = wHintPos;
      wRevealHint(); // second call — should be ignored
      return { pos1, pos2: wHintPos };
    });
    expect(res.pos1).toBe(res.pos2);
  });

  test('hint penalty: solving with hint used deducts 2 pts from the round score', async ({ page }) => {
    const res = await page.evaluate(() => {
      wRevealHint(); // use the hint
      const answer = wSession[wRound].word;
      // type the correct answer and submit
      for (const ch of answer) wType(ch);
      wEnter();
      // pts = max(0, 7 - 1 guesses - 2 hint penalty) = 4
      return { totalScore: wTotalScore };
    });
    // 1 guess → 7-1=6, minus 2 for hint → 4
    expect(res.totalScore).toBe(4);
  });

  test('extra hint (hint2) auto-shows after the 3rd wrong guess', async ({ page }) => {
    const res = await page.evaluate(() => {
      // submit 3 wrong guesses (using a word that is definitely wrong)
      const wrong = 'ZZZZZ';
      for (let i = 0; i < 3; i++) {
        wCurrentInput = wrong;
        wEnter();
      }
      const hint2El = document.getElementById('wordle-hint2');
      return { shown: hint2El.style.display !== 'none', flag: wHint2Shown };
    });
    expect(res.shown).toBe(true);
    expect(res.flag).toBe(true);
  });

  test('@negative extra hint does not show before the 3rd wrong guess', async ({ page }) => {
    const res = await page.evaluate(() => {
      wCurrentInput = 'ZZZZZ';
      wEnter(); // 1 wrong guess
      const hint2El = document.getElementById('wordle-hint2');
      return { shown: hint2El.style.display !== 'none' };
    });
    expect(res.shown).toBe(false);
  });

  test('skip awards 0 pts and shows the word-result card', async ({ page }) => {
    const res = await page.evaluate(() => {
      const answer = wSession[wRound].word;
      wSkip();
      const resultEl = document.getElementById('wordle-word-result');
      return {
        roundDone: wRoundDone,
        totalScore: wTotalScore,
        resultVisible: resultEl.style.display !== 'none',
        resultText: document.getElementById('wl-result-text').textContent,
        kbdHidden: document.getElementById('wordle-kbd').style.display === 'none',
        skipHidden: document.getElementById('wl-skip-btn').style.display === 'none',
        answer,
      };
    });
    expect(res.roundDone).toBe(true);
    expect(res.totalScore).toBe(0);
    expect(res.resultVisible).toBe(true);
    expect(res.resultText).toContain(res.answer);
    expect(res.kbdHidden).toBe(true);
    expect(res.skipHidden).toBe(true);
  });

  test('@negative skip is a no-op when the round is already done', async ({ page }) => {
    const res = await page.evaluate(() => {
      wSkip(); // first skip — valid
      const scoreAfterFirst = wTotalScore;
      wSkip(); // second skip — should be ignored
      return { score: wTotalScore, sameScore: wTotalScore === scoreAfterFirst };
    });
    expect(res.sameScore).toBe(true);
  });

  test('all WL_POOL words have a hint2 field in all 4 languages', async ({ page }) => {
    const missing = await page.evaluate(() =>
      WL_POOL.filter(w => !w.hint2 || !w.hint2.en || !w.hint2.es || !w.hint2.pt || !w.hint2.fr)
              .map(w => w.word)
    );
    expect(missing).toEqual([]);
  });
});
