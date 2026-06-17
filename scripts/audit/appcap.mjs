import { chromium } from 'playwright';
const base='http://localhost:3000';
const url = base + process.argv[2];
const b = await chromium.launch();
const errs=[];
for (const [label,w,h] of [['desktop',1280,860],['mobile',390,844]]) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1 });
  const p = await ctx.newPage();
  p.on('console', m=>{ if(m.type()==='error') errs.push(label+': '+m.text().slice(0,100)); });
  p.on('pageerror', e=>errs.push(label+': '+String(e).slice(0,100)));
  await p.goto(url,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500);
  await p.screenshot({path:`/tmp/app-${label}.png`, fullPage:false});
  await ctx.close();
}
console.log('captured desktop+mobile;', errs.length, 'console errors'); errs.slice(0,6).forEach(e=>console.log(' !',e));
await b.close();
