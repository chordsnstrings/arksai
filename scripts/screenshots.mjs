import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const PASSWORD = process.env.APP_PASSWORD || 'testpass';
const OUT = '/tmp/arksai-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('captured', name);
}

// 1) Login screen
await page.goto(BASE);
await page.waitForSelector('.login-card', { timeout: 10000 });
await shot('01-login');

// log in
await page.fill('.login-card input', PASSWORD);
await page.click('.login-card .send-btn');
await page.waitForSelector('.sidebar', { timeout: 10000 });
await page.waitForTimeout(800);
await shot('02-home-empty-or-sessions');

// 3) New session dialog
await page.click('.nav-btn');
await page.waitForSelector('.dialog', { timeout: 5000 });
await page.waitForTimeout(300);
await shot('03-new-session-dialog');
// close dialog
await page.keyboard.press('Escape').catch(() => {});
await page.click('.dialog .cancel').catch(() => {});

// 4) Open the most recent session that has a timeline (pick first in list)
const items = await page.$$('.session-item');
if (items.length > 0) {
  // click the session titled with mutex (chat) if present, else first
  let target = items[0];
  for (const it of items) {
    const t = (await it.getAttribute('title')) || '';
    if (/mutex|hello/i.test(t)) { target = it; break; }
  }
  await target.click();
  await page.waitForTimeout(1200);
  await shot('04-session-conversation');

  // 5) show mode toggle close-up by focusing composer area
  const composer = await page.$('.composer');
  if (composer) {
    await composer.screenshot({ path: `${OUT}/05-composer.png` });
    console.log('captured 05-composer');
  }

  // 6) expand a tool group if present
  const toolHeader = await page.$('.tool-group-header');
  if (toolHeader) {
    await toolHeader.click();
    await page.waitForTimeout(400);
    await shot('06-tool-activity-expanded');
  }
}

await browser.close();
console.log('done ->', OUT);
