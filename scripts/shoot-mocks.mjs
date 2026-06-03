import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mocks = ['home-a-vice', 'home-b-tropics', 'home-c-deco'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
for (const m of mocks) {
  const url = pathToFileURL(join(root, 'mocks', `${m}.html`)).href;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // let webfonts settle
  await page.screenshot({ path: join(root, 'mocks', `${m}.png`) });
  console.log(`${m}.png`);
}
await browser.close();
