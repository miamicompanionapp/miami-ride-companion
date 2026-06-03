import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'mocks');
const base = 'http://127.0.0.1:8788';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1280,height:800}, deviceScaleFactor:2,
  geolocation:{latitude:25.8001,longitude:-80.1991}, permissions:['geolocation'], locale:'en-US' });
const page = await ctx.newPage();
await page.goto(base,{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
await page.evaluate(()=>{ document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); document.getElementById('page-driver').classList.add('active'); }); await page.waitForTimeout(900);
await page.screenshot({path:join(out,'app-driver.png'), fullPage:true}); console.log('driver');
await page.evaluate(()=>switchTab('games')); await page.waitForTimeout(500);
await page.evaluate(()=>openGame('trivia')); await page.waitForTimeout(900);
// start the quiz to reveal a real question + options
await page.getByText('Start Trivia', { exact: false }).click().catch(()=>{});
await page.waitForTimeout(900);
await page.screenshot({path:join(out,'app-trivia.png')}); console.log('trivia');
await page.evaluate(()=>{ if(window.closeGame) closeGame(); switchTab('guide'); }); await page.waitForTimeout(500);
await page.evaluate(()=>openQR('app')); await page.waitForTimeout(700);
await page.screenshot({path:join(out,'app-qr.png')}); console.log('qr');
await browser.close();
