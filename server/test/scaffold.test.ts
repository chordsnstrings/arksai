import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listModules,
  readModule,
  resolveModules,
  generateApiJs,
  generateModulesJs,
  generateVerifyManifest,
  scaffoldAppTool,
} from '../src/agent/tools/scaffold';
import { auditCssCascade, auditProductionSeams } from '../src/agent/webHygiene';

const ctx = (dir: string) => ({ repoDir: dir, addCost: () => {}, signal: new AbortController().signal }) as any;

test('scaffold: every shipped module parses, deps resolve, and dep order is stable', () => {
  const mods = listModules();
  assert.ok(mods.length >= 7, `expected the module library, got: ${mods.join(', ')}`);
  for (const m of mods) {
    const meta = readModule(m)!;
    assert.equal(meta.name, m);
    const { order, unknown } = resolveModules([m]);
    assert.equal(unknown.length, 0, `${m} has unknown deps`);
    assert.equal(order[order.length - 1], m); // deps come first
  }
  // dashboard depends on crud → crud is auto-added before it
  assert.deepEqual(resolveModules(['dashboard']).order, ['crud', 'dashboard']);
  // unknown module is reported, not silently dropped
  assert.deepEqual(resolveModules(['nope']).unknown, ['nope']);
});

test('scaffold: generated api.js and modules.gen.js are valid JS with correct guards', () => {
  const mods = listModules().map((m) => readModule(m)!);
  const api = generateApiJs(mods);
  // org-scoped mounts carry BOTH guards in order; plain auth mounts carry requireAuth.
  assert.match(api, /app\.use\('\/api\/orgs\/:slug\/members', requireAuth, withOrg, r\d+\);/);
  assert.match(api, /app\.use\('\/api\/items', requireAuth, r\d+\);/);
  // public mounts have no guard
  assert.match(api, /app\.use\('\/api\/submit', r\d+\);/);
  // both generated files must PARSE (they're executed at boot / bundled)
  new Function(api.replace(/^import .*$/gm, '').replace(/^export /gm, ''));
  const pages = generateModulesJs(mods);
  assert.match(pages, /key: 'items'/);
  assert.match(pages, /key: 'members'/);
});

test('scaffold: full assembly — every module at once produces a complete, placeholder-free app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scafall-'));
  const msg = await scaffoldAppTool.run({ name: 'Everything App', modules: listModules() }, ctx(dir));
  assert.match(msg, /^Scaffolded/);
  // Key files exist
  for (const f of ['server.js', 'server/api.js', 'server/db.js', 'client/src/modules.gen.js', '.arksai/CONTRACT.md', '.arksai/verify.json', 'package.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} missing`);
  }
  // No placeholder survived in any text file
  const walk = (d: string): string[] => fs.readdirSync(d).flatMap((f) => {
    const p2 = path.join(d, f);
    return fs.statSync(p2).isDirectory() ? walk(p2) : [p2];
  });
  for (const f of walk(dir)) {
    if (!/\.(js|jsx|json|html|css|md|sql)$/.test(f)) continue;
    assert.ok(!fs.readFileSync(f, 'utf8').includes('__APP_'), `unreplaced placeholder in ${f}`);
  }
  // The manifest declares the demo login + at least the health route + SSE + isolation
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.arksai', 'verify.json'), 'utf8'));
  assert.equal(manifest.demo.email, 'demo@everything-app.app');
  assert.ok(manifest.routes.length >= 4);
  assert.equal(manifest.sse, '/api/live/events');
  // extraDeps merged (uploads brings multer)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.multer);
  // The skeleton's own stylesheet passes the cascade lint (media rules after base rules)
  assert.deepEqual(auditCssCascade(fs.readFileSync(path.join(dir, 'client/src/styles/app.css'), 'utf8')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scaffold: brownfield guard — an existing project is never clobbered', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scafbrown-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const msg = await scaffoldAppTool.run({ name: 'X' }, ctx(dir));
  assert.match(msg, /^Error: the workspace already contains a project/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scaffold: verify manifest replaces the demo-org placeholder', () => {
  const orgs = readModule('orgs')!;
  const m: any = generateVerifyManifest('acme', [orgs]);
  assert.equal(m.isolation.orgRoute, '/api/orgs/demo/members');
});

test('scaffold: production bar — a fresh scaffold is flagged as demo-grade until the domain work is done', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaf-prod-'));
  try {
    const out = await scaffoldAppTool.run({ name: 'LedgerPro', modules: ['crud'] }, ctx(dir));
    assert.match(String(out), /PRODUCTION-COMPLETE/i);

    // The base ships production hardening: rate-limited auth, account routes, security headers.
    const auth = fs.readFileSync(path.join(dir, 'server', 'routes', 'auth.js'), 'utf8');
    assert.match(auth, /rateLimit\(/);
    assert.match(auth, /r\.post\('\/password'/);
    assert.match(auth, /r\.patch\('\/me'/);
    assert.ok(fs.existsSync(path.join(dir, 'server', 'lib', 'rateLimit.js')));
    assert.match(fs.readFileSync(path.join(dir, 'server.js'), 'utf8'), /X-Content-Type-Options/);
    // …and a working Account page wired into the nav.
    assert.ok(fs.existsSync(path.join(dir, 'client', 'src', 'pages', 'Account.jsx')));
    assert.match(fs.readFileSync(path.join(dir, 'client', 'src', 'modules.gen.js'), 'utf8'), /key: 'account'/);
    // The manifest asserts the authed identity route (login provably works end-to-end).
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.arksai', 'verify.json'), 'utf8'));
    assert.ok(manifest.routes.some((r: any) => r.path === '/api/auth/me' && r.auth === true));
    // The contract states the bar.
    assert.match(fs.readFileSync(path.join(dir, '.arksai', 'CONTRACT.md'), 'utf8'), /PRODUCTION-COMPLETE, NOT A DEMO/);

    // Untouched scaffold → the seam audit flags BOTH fingerprints (home stub + Items exemplar).
    const before = auditProductionSeams(dir);
    assert.ok(before.some((d) => /scaffold home-page placeholder/.test(d)), before.join(' | '));
    assert.ok(before.some((d) => /untouched generic "Items"/.test(d)), before.join(' | '));

    // Simulate the model doing the domain work: real home + the exemplar cloned into Invoices.
    fs.writeFileSync(
      path.join(dir, 'client', 'src', 'pages', 'Home.jsx'),
      "export default function Home(){return <div className=\"page\"><h1>Overview</h1><p>Open invoices and this month's totals.</p></div>;}",
    );
    const items = path.join(dir, 'client', 'src', 'pages', 'Items.jsx');
    fs.writeFileSync(items, fs.readFileSync(items, 'utf8').replace('EXEMPLAR list/create/toggle/delete page — clone + rename per real entity.', 'Invoices').replaceAll('<h1>Items</h1>', '<h1>Invoices</h1>'));
    assert.deepEqual(auditProductionSeams(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scaffold: commerce/booking/content modules — engines correct, guards and manifests right', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaf-b2c-'));
  try {
    await scaffoldAppTool.run({ name: 'StudioFront', modules: ['catalog', 'booking', 'cms-lite'] }, ctx(dir));

    // The pure slots engine (from the SCAFFOLDED tree) — half-open overlap + conflict rules.
    const slots = await import(path.join(dir, 'server', 'lib', 'slots.js'));
    assert.equal(slots.overlaps(60, 120, 120, 180), false); // back-to-back is NOT a conflict
    assert.equal(slots.overlaps(60, 120, 90, 150), true);
    const resource = { open_min: 540, close_min: 720, slot_minutes: 60 };
    const free = slots.slotsForDay(resource, []);
    assert.deepEqual(free.map((s) => s.startMin), [540, 600, 660]);
    const taken = slots.slotsForDay(resource, [{ start_min: 600, end_min: 660, status: 'booked' }, { start_min: 660, end_min: 720, status: 'cancelled' }]);
    assert.deepEqual(taken.map((s) => s.free), [true, false, true]); // cancelled frees the slot

    // Mount guards: public storefront/checkout/content, authed orders/admin/booking.
    const api = fs.readFileSync(path.join(dir, 'server', 'api.js'), 'utf8');
    assert.match(api, /app\.use\('\/api\/products', r\d+\);/);
    assert.match(api, /app\.use\('\/api\/checkout', r\d+\);/);
    assert.match(api, /app\.use\('\/api\/orders', requireAuth, r\d+\);/);
    assert.match(api, /app\.use\('\/api\/booking', requireAuth, r\d+\);/);
    assert.match(api, /app\.use\('\/api\/content', r\d+\);/);
    assert.match(api, /app\.use\('\/api\/content-admin', requireAuth, r\d+\);/);

    // The manifest declares the new checks (public 200s, validation 400s, authed 200s).
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.arksai', 'verify.json'), 'utf8'));
    const has = (m: string, p: string, e: number) => manifest.routes.some((r: any) => r.method === m && r.path === p && r.expect === e);
    assert.ok(has('GET', '/api/products', 200) && has('POST', '/api/checkout', 400) && has('GET', '/api/orders', 200));
    assert.ok(has('GET', '/api/booking/resources', 200) && has('POST', '/api/booking/reservations', 400));
    assert.ok(has('GET', '/api/content', 200) && has('GET', '/api/content-admin', 200));

    // Pages wired into the nav registry.
    const gen = fs.readFileSync(path.join(dir, 'client', 'src', 'modules.gen.js'), 'utf8');
    for (const k of ['shop', 'products', 'orders', 'booking', 'content']) assert.match(gen, new RegExp(`key: '${k}'`));

    // The safe markdown renderer: escapes HTML, renders the trusted subset, no javascript: links.
    const md = await import(path.join(dir, 'client', 'src', 'lib', 'markdown.js'));
    const html = md.renderMarkdown('# Title\n\n**bold** and <script>alert(1)</script>\n\n- a\n- b\n\n[x](javascript:alert(1)) [ok](https://example.com)');
    assert.match(html, /<h2>Title<\/h2>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.ok(!html.includes('<script>'), 'raw HTML must be escaped');
    assert.ok(!/href="javascript:/i.test(html), 'a javascript: URL must never become a link'); // it stays inert text
    assert.match(html, /<a href="https:\/\/example\.com"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
