import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8788';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1280,height:800},
  geolocation:{latitude:25.8,longitude:-80.19}, permissions:['geolocation'], locale:'en-US' });
const page = await ctx.newPage();
await page.goto(base,{waitUntil:'networkidle'}); await page.waitForTimeout(1000);

const audit = (rootSel)=> page.evaluate((rootSel)=>{
  const lum=(r,g,b)=>(0.2126*r+0.7152*g+0.0722*b)/255;
  const parse=(c)=>{const m=c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]===undefined?1:+m[4]}:null;};
  const root=document.querySelector(rootSel); if(!root) return {rootSel,err:'not found'};
  const lightBg=[], lowContrast=[];
  // effective bg = walk up to first opaque-ish bg
  const effBg=(el)=>{let n=el;while(n){const p=parse(getComputedStyle(n).backgroundColor);if(p&&p.a>=0.5)return p;n=n.parentElement;}return {r:12,g:26,b:46,a:1};};
  root.querySelectorAll('*').forEach(el=>{
    const r=el.getBoundingClientRect(); if(r.width<8||r.height<8) return;
    const cs=getComputedStyle(el); const bgp=parse(cs.backgroundColor);
    if(bgp&&bgp.a>=0.5&&lum(bgp.r,bgp.g,bgp.b)>0.7) lightBg.push((el.className||el.tagName)+' :: '+cs.backgroundColor);
    const txt=(el.textContent||'').trim();
    if(txt && el.children.length===0){
      const fg=parse(cs.color); if(!fg||fg.a<0.4) return;
      const bg=effBg(el);
      const d=Math.abs(lum(fg.r,fg.g,fg.b)-lum(bg.r,bg.g,bg.b));
      if(d<0.18) lowContrast.push(`${(el.className||el.tagName)} "${txt.slice(0,24)}" fg=${cs.color} dL=${d.toFixed(2)}`);
    }
  });
  return {rootSel, lightBg:[...new Set(lightBg)], lowContrast:[...new Set(lowContrast)]};
}, rootSel);

const out=[];
await page.evaluate(()=>showInactivityModal()); await page.waitForTimeout(500); out.push(await audit('#inactivity-overlay')); await page.evaluate(()=>{try{dismissInactivity()}catch(e){}});
await page.evaluate(()=>showThanks()); await page.waitForTimeout(500); out.push(await audit('#thanks-screen')); await page.evaluate(()=>document.getElementById('thanks-screen').classList.remove('visible'));
await page.evaluate(()=>enterRest()); await page.waitForTimeout(800); out.push(await audit('#rest-screen'));

for(const r of out){
  console.log(`\n[${r.rootSel}] ${r.err||''}`);
  console.log('  light backgrounds:', r.lightBg?.length||0); (r.lightBg||[]).forEach(h=>console.log('     ⚠ '+h));
  console.log('  low-contrast text:', r.lowContrast?.length||0); (r.lowContrast||[]).forEach(h=>console.log('     ⚠ '+h));
}
await browser.close();
