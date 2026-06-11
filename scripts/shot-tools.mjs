import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const PASSWORD = process.env.APP_PASSWORD || 'testpass';
const OUT = '/tmp/arksai-shots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(BASE);
await page.waitForSelector('.login-card');
await page.fill('.login-card input', PASSWORD);
await page.click('.login-card .send-btn');
await page.waitForSelector('.sidebar');
await page.waitForTimeout(600);

// open the hello.ts session (has tool groups)
const items = await page.$$('.session-item');
for (const it of items) {
  const t = (await it.getAttribute('title')) || '';
  if (/hello/i.test(t)) { await it.click(); break; }
}
await page.waitForTimeout(1000);

// expand all tool groups
for (const h of await page.$$('.tool-group-header')) {
  await h.click();
  await page.waitForTimeout(150);
}
// expand first few tool rows to reveal output
const rows = await page.$$('.tool-row .head');
for (const r of rows.slice(0, 3)) { await r.click(); await page.waitForTimeout(150); }
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/06-tool-activity-expanded.png`, fullPage: true });
console.log('captured 06-tool-activity-expanded');

await browser.close();
