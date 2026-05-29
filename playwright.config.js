// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8123;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
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
