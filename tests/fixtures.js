// Shared test fixture: every test automatically fails if the page logged a
// console error or threw an uncaught error. This is what catches the silent
// "broken functionality" the smoke test was built to find.
const base = require('@playwright/test');

const test = base.test.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    // Bypass the PWA install gate so tests run in a normal browser context.
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    // Stub soulofmiami.org (event image host) responses.
    //
    // The app's prewarmEventImages() (public/index.html) fetches every event
    // image (all hosted on soulofmiami.org, per content.json) in an unawaited
    // background loop on every page load, to cache them for offline use. That
    // fetch() always fails: soulofmiami.org sends no
    // `Access-Control-Allow-Origin` header, so the browser blocks it as a
    // cross-origin CORS violation — logging
    // `console.error: Access to fetch at '…' … has been blocked by CORS
    // policy` (and a follow-on `net::ERR_FAILED`) before the app's own
    // try/catch can swallow it. This is NOT a sandbox/environment artifact —
    // it reproduces the same way in any browser, including production, since
    // the CORS policy is soulofmiami.org's, not this machine's (confirmed via
    // `playwright.config.js`'s `serviceWorkers: 'block'` comment — the
    // Service Worker was masking this by intercepting the fetch itself and
    // hiding the real console output behind a generic net::ERR_FAILED that
    // looked environment-specific). This is a real, pre-existing product bug
    // (offline image pre-caching silently never works for any passenger,
    // though it fails gracefully — see backlog.txt), tracked separately from
    // this test fix.
    // Because the fetch loop is async and unawaited, the console error lands
    // on whatever test happens to be running when it fires — hence the
    // shuffling set of "random" test failures across `npm test` runs
    // (confirmed 2026-07-19: 20, then 27, almost entirely different tests
    // each run). Fulfilling the route (not aborting — `route.abort()` logs
    // the identical `net::ERR_FAILED` line itself) with a stub image and a
    // permissive CORS header removes the error at its source.
    await page.route(/soulofmiami\.org/, (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      // 1x1 transparent PNG, base64-encoded.
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    }));

    await use(page);

    base.expect(errors, 'page emitted no console/page errors').toEqual([]);
  },
});

module.exports = { test, expect: base.expect };
