// ArksAI — browser-level deployment check (the "does the Canvas actually render the app?" test).
// The curl check (deploy-check.sh) verifies serving/assets/headers; THIS verifies the real
// in-browser render of a published app AND that it loads inside an iframe (how the Canvas shows it)
// — capturing console errors, failed requests, and mixed-content blocks that only appear in a browser.
//
// Run where Playwright/Chromium is available (the arksai container has it):
//   BASE=https://arksai.studio APP_PASSWORD=... node scripts/deploy-check-browser.mjs
//   # in the container:  docker compose -f docker-compose.tls.yml exec -T arksai \
//   #     sh -c 'BASE=https://arksai.studio APP_PASSWORD=$APP_PASSWORD node /app/scripts/deploy-check-browser.mjs'
// Writes /tmp/deploy-check-*.png screenshots for eyeballing.

const BASE = process.env.BASE || 'https://arksai.studio';
const PW = process.env.APP_PASSWORD || '';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('Playwright not available here — run inside the arksai container (it has Chromium).'); process.exit(2); }

const log = (s) => console.log(s);
let fails = 0;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

// 1) authenticate (so /api/deployments is readable)
let slug = '';
try {
  const r = await page.request.post(`${BASE}/api/auth/login`, { data: { password: PW } });
  log(r.ok() ? '  ✓ operator login' : `  ✗ login → ${r.status()}`);
  const deps = await (await page.request.get(`${BASE}/api/deployments`)).json().catch(() => ({}));
  const arr = Array.isArray(deps) ? deps : deps.deployments || [];
  slug = (arr.find((d) => /live|running/i.test(d.status)) || arr[0] || {}).slug || '';
} catch (e) { log(`  ✗ auth/deployments: ${String(e).slice(0, 100)}`); fails++; }

if (!slug) { log('  ! no deployment to test — publish an app then re-run'); await browser.close(); process.exit(fails ? 1 : 0); }
const appUrl = `${BASE}/apps/${slug}/`;
log(`  testing published app: /apps/${slug}/`);

// 2) load the published app directly — capture console + network failures (the real Canvas content)
const errs = [], failed = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 140)));
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 140)));
page.on('requestfailed', (rq) => failed.push(`${rq.failure()?.errorText} ${rq.url().slice(0, 90)}`));
try {
  const resp = await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({ text: (document.body?.innerText || '').trim().length, nodes: document.body?.querySelectorAll('*').length || 0 }));
  log(`  ${resp && resp.ok() ? '✓' : '✗'} GET ${appUrl} → ${resp ? resp.status() : 'no response'}`);
  if (!resp || !resp.ok()) fails++;
  if (info.text > 20 || info.nodes > 15) log(`  ✓ app renders content (${info.nodes} DOM nodes, ${info.text} chars)`);
  else { log(`  ✗ app rendered BLANK (${info.nodes} nodes, ${info.text} chars) — broken on the deployment`); fails++; }
  if (failed.length) { log(`  ✗ ${failed.length} asset/request(s) FAILED to load (blank/broken app):`); failed.slice(0, 6).forEach((f) => log(`      - ${f}`)); fails++; }
  else log('  ✓ no failed asset/network requests');
  if (errs.length) { log(`  ! ${errs.length} console error(s):`); [...new Set(errs)].slice(0, 5).forEach((e) => log(`      - ${e}`)); }
  else log('  ✓ no console errors');
  await page.screenshot({ path: '/tmp/deploy-check-app.png' }).catch(() => {});
} catch (e) { log(`  ✗ failed to load the app: ${String(e).slice(0, 120)}`); fails++; }

// 3) load it INSIDE an iframe (how the Canvas shows it) — confirms it frames + renders
try {
  const host = await ctx.newPage();
  await host.setContent(`<!doctype html><iframe id="f" src="${appUrl}" style="width:1200px;height:800px;border:0"></iframe>`);
  await host.waitForTimeout(3500);
  const framed = await host.evaluate(() => {
    const f = document.getElementById('f');
    try { const d = f.contentDocument; return { reachable: !!d, nodes: d ? d.body?.querySelectorAll('*').length || 0 : 0 }; }
    catch (e) { return { reachable: false, nodes: 0, err: String(e).slice(0, 80) }; }
  });
  if (framed.reachable && framed.nodes > 15) log(`  ✓ app renders INSIDE an iframe (${framed.nodes} nodes) — the Canvas can show it`);
  else { log(`  ✗ app does NOT render in an iframe (${JSON.stringify(framed)}) — THIS is the "Canvas won't load the published app" symptom`); fails++; }
  await host.screenshot({ path: '/tmp/deploy-check-iframe.png' }).catch(() => {});
} catch (e) { log(`  ! iframe test skipped: ${String(e).slice(0, 100)}`); }

await browser.close();
log(fails ? `\n  ✗ ${fails} browser-level failure(s) — screenshots in /tmp/deploy-check-*.png` : '\n  ✓ published app renders correctly in-browser and in an iframe');
process.exit(fails ? 1 : 0);
