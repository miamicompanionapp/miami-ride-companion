import { chromium } from 'playwright';
const base='http://127.0.0.1:8788';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:800},geolocation:{latitude:25.8,longitude:-80.19},permissions:['geolocation'],locale:'en-US'});
const page=await ctx.newPage(); await page.goto(base,{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
const audit=(sel)=>page.evaluate((sel)=>{
  const lum=(r,g,b)=>(0.2126*r+0.7152*g+0.0722*b)/255;
  const parse=(c)=>{const m=c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]===undefined?1:+m[4]}:null;};
  const effBg=(el)=>{let n=el;while(n){const p=parse(getComputedStyle(n).backgroundColor);if(p&&p.a>=0.5)return p;n=n.parentElement;}return{r:12,g:26,b:46};};
  const root=document.querySelector(sel); const low=[];
  root.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();if(r.width<8||r.height<8)return;const cs=getComputedStyle(el);const t=(el.textContent||'').trim();if(!t||el.children.length)return;const fg=parse(cs.color);if(!fg||fg.a<0.4)return;const bg=effBg(el);const d=Math.abs(lum(fg.r,fg.g,fg.b)-lum(bg.r,bg.g,bg.b));if(d<0.16)low.push(`${(el.className||el.tagName)} "${t.slice(0,22)}" dL=${d.toFixed(2)}`);});
  return [...new Set(low)];
},sel);
for(const tab of ['guide','weather','games']){await page.evaluate(t=>switchTab(t),tab);await page.waitForTimeout(900);const l=await audit('#page-'+tab);console.log(`[${tab}] low-contrast: ${l.length}`);l.forEach(x=>console.log('   ⚠ '+x));}
await b.close();
