import { chromium } from 'playwright';
import fs from 'fs';
const env = fs.readFileSync('.env','utf8');
const pw = (env.match(/APP_PASSWORD=(.+)/)||[])[1]?.trim();
const base='http://localhost:3000';
// usage: cap.mjs <sessionId> <docview|files|preview> <pathOrPort> <out.png> [w] [h]
const [sid, kind, target, out, w='1000', h='1300'] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport:{width:+w,height:+h}, deviceScaleFactor:2 });
const p = await ctx.newPage();
await p.request.post(base+'/api/auth/login',{data:{password:pw}});
let url;
if (kind==='docview') url=`${base}/api/sessions/${sid}/docview/${target.split('/').map(encodeURIComponent).join('/')}`;
else if (kind==='files') url=`${base}/api/sessions/${sid}/files/${target.split('/').map(encodeURIComponent).join('/')}?inline=1`;
else if (kind==='preview') url=`${base}/api/sessions/${sid}/preview/${target}/`;
await p.goto(url, {waitUntil:'domcontentloaded'});
await p.waitForTimeout(2000);
await p.screenshot({path:out, fullPage: kind!=='preview'});
console.log('captured', out, '<-', url);
await b.close();
