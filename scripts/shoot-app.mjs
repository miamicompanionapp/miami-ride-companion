import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'mocks');
const base = 'http://127.0.0.1:8788';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  geolocation: { latitude: 25.8001, longitude: -80.1991 }, // Wynwood-ish
  permissions: ['geolocation'],
  locale: 'en-US',
});
const page = await ctx.newPage();
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const shots = [
  ['guide', '#nav-guide'],
  ['weather', '#nav-weather'],
  ['games', '#nav-games'],
];
for (const [name, sel] of shots) {
  await page.click(sel).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, `app-${name}.png`) });
  console.log(`app-${name}.png`);
}
await browser.close();
