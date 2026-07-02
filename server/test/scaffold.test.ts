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
