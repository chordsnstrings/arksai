// Capture key UI surfaces for an aesthetic eyeball after the a11y/markup edits.
import { chromium } from 'playwright';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const pw = (env.match(/APP_PASSWORD=(.+)/) || [])[1]?.trim();
const base = 'http://localhost:3000';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.request.post(base + '/api/auth/login', { data: { password: pw } });
await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.setItem('arksai_whatsnew_2026-06-17.10', 'x'));
await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
fs.mkdirSync('scripts/audit/out', { recursive: true });
await p.screenshot({ path: 'scripts/audit/out/launchpad.png' });
// open New project dialog (the one whose selects I edited)
const btn = p.locator('button:has-text("New project")').first();
if (await btn.isVisible().catch(() => false)) {
  await btn.click(); await p.waitForTimeout(700);
  await p.screenshot({ path: 'scripts/audit/out/dialog-newproject.png' });
}
await b.close();
console.log('shots saved');
