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

    await use(page);

    base.expect(errors, 'page emitted no console/page errors').toEqual([]);
  },
});

module.exports = { test, expect: base.expect };
