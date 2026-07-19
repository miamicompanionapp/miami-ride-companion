// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8123;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // Cap parallel Chromium workers — unset defaults to one per CPU core, which
  // was pegging the laptop (each worker is a full browser instance).
  workers: process.env.CI ? '50%' : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Block Service Worker registration in every test context.
    //
    // Root cause of a long-standing flaky test run (repeated `npm test` on
    // 2026-07-19 failed 20 tests, then 27, almost entirely different tests
    // each time): the app's prewarmEventImages() (public/index.html) fetches
    // every event image (all hosted on soulofmiami.org) in an unawaited
    // background loop on every page load. Once registerSW() (public/index.html)
    // installs the Service Worker (public/sw.js), its blanket `fetch` handler
    // ("Everything else: Cache first, fall back to network") takes over ALL
    // page fetches, including those — and the SW's *own*
    // `fetch(event.request)` call to soulofmiami.org fails inside the Service
    // Worker's execution context, logging a raw
    // `console.error: Failed to load resource: net::ERR_FAILED` that
    // tests/fixtures.js's strict console-error gate treats as a hard failure.
    // Because the failure fires async and unawaited, it lands on whatever
    // test happens to be running at that moment — hence the shuffling set of
    // "random" failures.
    // A Service Worker's execution context is a separate thread invisible to
    // page-level `page.route()` — routes registered on `page` only intercept
    // requests the page/frame itself makes, not requests a Service Worker
    // makes on its own. Confirmed by probing: neither `page.route(/soulofmiami\.org/, …)`
    // (tried with both `route.abort()` and `route.fulfill()` + CORS headers)
    // nor `page.route('**/sw.js', …)` (to stop registration at the source)
    // ever fired — a throwaway probe test logging every `requestfailed` event
    // showed 0 hits on the route handler even as the failures kept appearing,
    // and `navigator.serviceWorker.getRegistrations()` showed an active SW
    // despite the route being in place.
    // `serviceWorkers: 'block'` is Playwright's purpose-built context option
    // for this — it stops the SW from ever installing, at the browser-context
    // level, before any of the above interception attempts are even relevant.
    // Whether the underlying soulofmiami.org fetch would succeed on a normal
    // (non-sandboxed) machine is a separate question — curl reaches it fine
    // from this same machine, so this reads as an environment/proxy quirk
    // specific to the headless Chromium process here, not a real outage.
    // Safe to do suite-wide: nothing here exercises live SW/offline behavior.
    // The one SW-related test (editor-units.spec.js, "SW offline fallback
    // page") only reads sw.js as a text file — it never registers a real one.
    // If a future test needs a genuinely active SW (e.g. testing offline
    // fallback in a live browser), override with `test.use({ serviceWorkers: 'allow' })`
    // in that file/describe block.
    serviceWorkers: 'block',
  },

  // The kiosk runs landscape on a tablet — test at that shape by default.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
  ],

  // Auto-start the static server; reuse one already running locally (e.g. if you
  // have `npm run dev` going, set reuseExistingServer + a matching url).
  webServer: {
    command: `node tests/static-server.js ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
