import { chromium } from 'playwright';
import fs from 'fs';
const env = fs.readFileSync('.env','utf8');
const pw = (env.match(/APP_PASSWORD=(.+)/)||[])[1]?.trim();
const base='http://localhost:3000';
const errors = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1280,height:900} });
const p = await ctx.newPage();
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text().slice(0,140)); });
p.on('pageerror', e => errors.push('pageerror: '+String(e).slice(0,140)));
await p.request.post(base+'/api/auth/login',{data:{password:pw}});
await p.goto(base+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(()=>localStorage.setItem('arksai_whatsnew_2026-06-17.8','x'));
await p.goto(base+'/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1500);
const mark = (s)=>`[${errors.length} errs] ${s}`;
const surfaces = [];
surfaces.push(mark('launchpad (teams)'));
// open each sidebar dialog by button text
for (const [label, sel] of [['New project','New project'],['Scheduled','Scheduled'],['Admin','Admin'],['Analytics','Analytics']]) {
  const before = errors.length;
  const btn = p.locator(`button:has-text("${sel}")`).first();
  if (await btn.isVisible().catch(()=>false)) {
    await btn.click().catch(()=>{}); await p.waitForTimeout(900);
    const dlgVisible = await p.locator('.dialog, .an-console, [class*="dialog"]').first().isVisible().catch(()=>false);
    surfaces.push(`${label}: opened=${dlgVisible} errs+${errors.length-before}`);
    await p.keyboard.press('Escape').catch(()=>{}); await p.waitForTimeout(400);
  } else surfaces.push(`${label}: BUTTON NOT FOUND`);
}
// pick a department on the launchpad
const dept = p.locator('.dept-tile').first();
if (await dept.isVisible().catch(()=>false)) { await dept.click(); await p.waitForTimeout(800); surfaces.push(mark('dept screen (plays + input)')); }
// open a recent/existing session
const list = await p.request.get(base+'/api/sessions').then(r=>r.json()).catch(()=>[]);
if (Array.isArray(list)&&list.length){ await p.goto(base+'/s/'+list[0].id,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1800); surfaces.push(mark('chat view (session '+list[0].title.slice(0,20)+')')); }
console.log('SURFACES:'); surfaces.forEach(s=>console.log('  '+s));
console.log('TOTAL CONSOLE/PAGE ERRORS:', errors.length);
errors.slice(0,12).forEach(e=>console.log('  ! '+e));
await b.close();
