import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8788';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1280,height:800},
  geolocation:{latitude:25.8,longitude:-80.19}, permissions:['geolocation'], locale:'en-US' });
const page = await ctx.newPage();
await page.goto(base,{waitUntil:'networkidle'}); await page.waitForTimeout(1000);

// Returns any visible element whose own background is a light/near-white solid.
const scanLight = (label) => page.evaluate((label)=>{
  const lum = (r,g,b)=> (0.2126*r+0.7152*g+0.0722*b)/255;
  const hits=[];
  document.querySelectorAll('.game-screen.open *').forEach(el=>{
    const r=el.getBoundingClientRect(); if(r.width<8||r.height<8) return;
    const cs=getComputedStyle(el); const bg=cs.backgroundColor;
    const m=bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if(!m) return; const a=m[4]===undefined?1:parseFloat(m[4]); if(a<0.5) return;
    const L=lum(+m[1],+m[2],+m[3]);
    if(L>0.7){ hits.push((el.className||el.tagName)+' :: '+bg); }
  });
  return {label, hits:[...new Set(hits)]};
}, label);

const open = async (k)=>{ await page.evaluate(x=>openGame(x),k); await page.waitForTimeout(500); };
const close = async ()=>{ await page.evaluate(()=>{try{closeGame()}catch(e){}}); await page.waitForTimeout(200); };

await page.evaluate(()=>switchTab('games')); await page.waitForTimeout(300);
const results=[];
await open('ttt');   await page.evaluate(()=>tttStart());  await page.waitForTimeout(500); results.push(await scanLight('ttt'));    await close();
await open('duel');  await page.evaluate(()=>duelStart()); await page.waitForTimeout(500); results.push(await scanLight('duel'));   await close();
await open('buzzer');await page.evaluate(()=>buzzStart()); await page.waitForTimeout(500); results.push(await scanLight('buzzer')); await close();
await open('trivia');await page.getByText('Start',{exact:false}).first().click().catch(()=>{}); await page.waitForTimeout(500); results.push(await scanLight('trivia')); await close();

for(const r of results){
  console.log(`\n[${r.label}] light-background elements: ${r.hits.length}`);
  r.hits.forEach(h=>console.log('   ⚠ '+h));
}
await browser.close();
