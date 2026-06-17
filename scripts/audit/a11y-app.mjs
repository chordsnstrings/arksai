// Systematic accessibility + console-error sweep across EVERY authenticated UI surface
// (launchpad, dept screen, chat, and every dialog) — not just the published dashboard.
// Usage: node scripts/audit/a11y-app.mjs
import { chromium } from 'playwright';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const pw = (env.match(/APP_PASSWORD=(.+)/) || [])[1]?.trim();
const base = 'http://localhost:3000';

const errors = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
p.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 160)));

// a11y probe run inside the page for the CURRENTLY visible UI (scoped to a root selector)
const probe = (rootSel) => p.evaluate((rootSel) => {
  const root = (rootSel && document.querySelector(rootSel)) || document.body;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const out = {};
  // controls without an accessible name
  const ctrls = [...root.querySelectorAll('button,a[href],[role=button]')].filter(vis);
  out.ctrlsTotal = ctrls.length;
  out.ctrlsNoName = ctrls.filter(b => !(
    (b.textContent || '').trim() ||
    b.getAttribute('aria-label') || b.getAttribute('title') ||
    b.querySelector('img[alt]') ||
    (b.getAttribute('aria-labelledby') && document.getElementById(b.getAttribute('aria-labelledby')))
  )).map(b => (b.className || b.tagName).toString().slice(0, 40));
  // form controls without a label/aria-label/placeholder
  const inputs = [...root.querySelectorAll('input,select,textarea')].filter(vis).filter(i => i.type !== 'hidden');
  out.inputsTotal = inputs.length;
  out.inputsNoLabel = inputs.filter(i => !(
    i.getAttribute('aria-label') || i.labels?.length || i.closest('label') ||
    i.getAttribute('placeholder') || i.getAttribute('aria-labelledby') || i.getAttribute('title')
  )).map(i => (i.name || i.type || i.tagName));
  // images without alt
  const imgs = [...root.querySelectorAll('img')].filter(vis);
  out.imgsTotal = imgs.length;
  out.imgsNoAlt = imgs.filter(i => !i.hasAttribute('alt')).length;
  // headings present at all in this surface
  out.headings = root.querySelectorAll('h1,h2,h3,h4,[role=heading]').length;
  return out;
}, rootSel);

const results = [];
async function surface(name, opener, rootSel = null) {
  const before = errors.length;
  if (opener) await opener();
  await p.waitForTimeout(700);
  let a = {};
  try { a = await probe(rootSel); } catch (e) { a = { error: String(e).slice(0, 80) }; }
  results.push({ name, ...a, newErrors: errors.length - before });
}

// global page-level checks (once)
await p.request.post(base + '/api/auth/login', { data: { password: pw } });
await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
// suppress the What's-New modal (its backdrop intercepts clicks) — set the exact current key
await p.evaluate(() => localStorage.setItem('arksai_whatsnew_2026-06-17.9', 'x'));
await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
// belt-and-braces: dismiss it if a future version bump made the key stale
await p.locator('.dialog.wn button:has-text("Got it")').first().click().catch(() => {});
await p.waitForTimeout(300);

const page = await p.evaluate(() => ({
  lang: document.documentElement.getAttribute('lang') || '(none)',
  title: document.title || '(none)',
  viewport: !!document.querySelector('meta[name=viewport]'),
  h1: document.querySelectorAll('h1').length,
}));

await surface('launchpad (teams)', null);
await surface('dept screen', async () => { await p.locator('.dept-tile').first().click().catch(() => {}); });
// back to launchpad for dialogs
await p.goto(base + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
for (const label of ['New project', 'Scheduled', 'Admin', 'Analytics', 'Memory', 'Commands']) {
  const btn = p.locator(`button:has-text("${label}")`).first();
  if (await btn.isVisible().catch(() => false)) {
    await surface('dialog: ' + label, async () => { await btn.click().catch(() => {}); }, '.dialog, [class*="dialog"], .an-console');
    await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(300);
  } else {
    results.push({ name: 'dialog: ' + label, missing: true });
  }
}
// chat view
const list = await p.request.get(base + '/api/sessions').then(r => r.json()).catch(() => []);
if (Array.isArray(list) && list.length) {
  await surface('chat view', async () => { await p.goto(base + '/s/' + list[0].id, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500); });
}

console.log('PAGE:', JSON.stringify(page));
console.log('SURFACES:');
for (const r of results) console.log('  ' + JSON.stringify(r));
console.log('TOTAL ERRORS:', errors.length);
[...new Set(errors)].slice(0, 15).forEach(e => console.log('  ! ' + e));
await b.close();
