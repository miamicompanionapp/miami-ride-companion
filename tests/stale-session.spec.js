// A sleeping/backgrounded tab pauses setTimeout/setInterval (no Wake Lock), so
// the ~2min idle→attractor→modal→reset chain can miss its whole window and a
// session silently absorbs the entire sleep/background gap. Found via a real
// analytics export (2026-07-04) showing a 49-minute silent gap inside one
// session. Fix: force-close a stale session on tab wake instead of letting the
// next tap quietly re-arm the idle timer over it.
//
// Base runner (not ./fixtures): these assertions are about internal timer state,
// not the rendered page, so an unrelated background resource blip (e.g. a blocked
// third-party image fetch on the content cards) shouldn't fail them.
// Tags: @index @unit
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
  await page.goto('/index.html');
  await page.waitForFunction(
    () => typeof logTap === 'function' && CONTENT !== null && db !== null
  );
});

test.describe('Stale session recovery on tab wake', { tag: ['@index', '@unit'] }, () => {
  test('a session idle far longer than STALE_SESSION_MS is force-closed on visibilitychange', async ({ page }) => {
    // Start a session and move off the home view so we can prove the reset happens.
    await page.evaluate(() => { switchTab('weather'); setFilter('nightlife'); logTap('tab_weather'); });
    expect(await page.evaluate(() => sessionStart !== null)).toBe(true);

    // Simulate the tab having been asleep/backgrounded for 11 minutes: back-date
    // lastActivityTime past STALE_SESSION_MS, then fire the wake event.
    await page.evaluate(() => {
      lastActivityTime = Date.now() - (STALE_SESSION_MS + 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const state = await page.evaluate(() => ({
      sessionStart,
      tab: currentTab,
      filter: currentFilter,
    }));
    expect(state.sessionStart, 'stale session should be force-closed').toBeNull();
    expect(state.tab).toBe('guide');
    expect(state.filter).toBe('featured');
  });

  test('a session idle for less than STALE_SESSION_MS is left alone on visibilitychange', async ({ page }) => {
    await page.evaluate(() => { switchTab('weather'); logTap('tab_weather'); });
    expect(await page.evaluate(() => sessionStart !== null)).toBe(true);

    await page.evaluate(() => {
      lastActivityTime = Date.now() - 60_000; // 1 min ago — well under the threshold
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const state = await page.evaluate(() => ({ sessionStart, tab: currentTab }));
    expect(state.sessionStart, 'recent session should not be closed').not.toBeNull();
    expect(state.tab).toBe('weather');
  });

  test('endSession records the distinct stale_gap endType', async ({ page }) => {
    await page.evaluate(() => { logTap('tab_games'); });
    expect(await page.evaluate(() => sessionStart !== null)).toBe(true);

    await page.evaluate(() => {
      lastActivityTime = Date.now() - (STALE_SESSION_MS + 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const lastSession = await page.evaluate(async () => {
      return new Promise(resolve => {
        const req = indexedDB.open('MiamiRideAnalytics', ANALYTICS_DB_VERSION);
        req.onsuccess = e => {
          const all = [];
          const store = e.target.result.transaction('sessions', 'readonly').objectStore('sessions');
          store.openCursor().onsuccess = ev => {
            const c = ev.target.result;
            if (c) { all.push(c.value); c.continue(); }
            else resolve(all.length ? all[all.length - 1] : null);
          };
        };
      });
    });
    expect(lastSession).not.toBeNull();
    expect(lastSession.endType).toBe('stale_gap');
  });
});
