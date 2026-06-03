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

const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({path:join(out,`v-${name}.png`)}); console.log(name); };
const closeGame = async () => { await page.evaluate(()=>{ try{window.closeGame&&closeGame();}catch(e){} }); await page.waitForTimeout(300); };
const open = async (key) => { await page.evaluate(k=>openGame(k), key); await page.waitForTimeout(700); };
// click first visible button matching any of the given texts
const clickText = async (txt) => { try { await page.getByText(txt,{exact:false}).first().click({timeout:1500}); } catch(e){} await page.waitForTimeout(600); };

await page.evaluate(()=>switchTab('games')); await page.waitForTimeout(400);

// Solo games
await open('tap');   await shot('game-tap');                 await closeGame();
await open('word');  await shot('game-word');                await closeGame();
await open('spin');  await clickText('Spin'); await shot('game-spin'); await closeGame();
await open('image'); await clickText('Start'); await shot('game-image'); await closeGame();

// Multiplayer — advance into the actual board/zones via the start fns
await open('ttt');   await page.evaluate(()=>tttStart());  await page.waitForTimeout(600); await shot('game-ttt');    await closeGame();
await open('duel');  await page.evaluate(()=>duelStart()); await page.waitForTimeout(600); await shot('game-duel');   await closeGame();
await open('buzzer');await page.evaluate(()=>buzzStart()); await page.waitForTimeout(600); await shot('game-buzzer'); await closeGame();

// Special screens
await page.evaluate(()=>switchTab('guide')); await page.waitForTimeout(300);
await page.evaluate(()=>showInactivityModal()); await shot('inactivity');
await page.evaluate(()=>{ try{dismissInactivity();}catch(e){} });
await page.evaluate(()=>showThanks()); await shot('thanks');
await page.evaluate(()=>{ document.getElementById('thanks-screen').classList.remove('visible'); });
await page.evaluate(()=>enterRest()); await page.waitForTimeout(900); await shot('rest');

await browser.close();
