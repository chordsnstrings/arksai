import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { classifyTask, suggestArchitecture } from '../src/agent/taskProfile';
import { designContext, typePacks } from '../src/agent/designSystem';
import { browserSmokeTest, parseDesignVerdict, wfNoteCollisions, WIREFRAME_RUBRIC_PROMPT } from '../src/agent/uiCheck';

const KIT = path.join(__dirname, '../assets/ui-kit');
const FONTS = path.join(__dirname, '../assets/report-fonts');

// ---------------- classification: design-thinking artifacts win over their subjects ----------------

test('wireframe/prototype classify first and stay visual, with no-backend architecture', () => {
  const wf = classifyTask('wireframe the landing page checkout flow', 'code');
  assert.equal(wf.type, 'wireframe', '"wireframe the landing page" is a wireframe, not a landing page');
  assert.equal(wf.isVisual, true);

  const wf2 = classifyTask('a lo-fi mock of the onboarding screens', 'code');
  assert.equal(wf2.type, 'wireframe');

  const pt = classifyTask('a clickable prototype of the analytics dashboard', 'code');
  assert.equal(pt.type, 'prototype', '"prototype of the dashboard" is a prototype, not a dashboard');
  assert.equal(pt.isVisual, true);

  const arch = suggestArchitecture('wireframe the checkout flow', wf)!;
  assert.equal(arch.base, 'create_web_app');
  assert.match(arch.line, /lo-fi HTML board/);
  const archP = suggestArchitecture('a clickable prototype with login screens', pt)!;
  assert.equal(archP.base, 'create_web_app');
  assert.match(archP.line, /no backend/i);

  // Plain asks still classify as before.
  assert.equal(classifyTask('a landing page for my cafe', 'code').type, 'landing');
  assert.equal(classifyTask('an analytics dashboard for sales', 'code').type, 'dashboard');
});

// ---------------- design context: wireframes are exempt from the editorial core ----------------

test('wireframe pack stands alone (no editorial core / palettes); prototype gets the full bar', () => {
  const wf = designContext(classifyTask('wireframe the signup flow', 'code'));
  assert.ok(wf.includes('WIREFRAME BOARD'), 'wireframe pack present');
  assert.ok(!wf.includes('ART DIRECTION FIRST'), 'no editorial design core for wireframes');
  assert.ok(!wf.includes('Palette swatch book'), 'no palette menu for wireframes');
  assert.match(wf, /wf-note/);
  assert.match(wf, /wf-flow/);
  assert.match(wf, /2–4\s+NAMED .wf-variant|NAMED \.wf-variant/, 'concept-variant doctrine present');

  const pt = designContext(classifyTask('a clickable prototype of a booking app', 'code'));
  assert.ok(pt.includes('CLICKABLE PROTOTYPE'), 'prototype pack present');
  assert.ok(pt.includes('ART DIRECTION FIRST'), 'prototype keeps the full editorial core');
  assert.match(pt, /proto\.js/);
  assert.ok(typePacks.wireframe.includes('add_ui_kit'), 'wireframe pack tells the agent to install the kit');
});

// ---------------- kit integrity ----------------

test('wireframe + prototype kit files carry their vocabulary; Caveat is vendored', () => {
  const wf = fs.readFileSync(path.join(KIT, 'wireframe.css'), 'utf8');
  for (const cls of ['.wf-board', '.wf-screen', '.wf-frame', '.wf-note', '.wf-flow', '.wf-variant', '.wf-thesis', '.wf-img', '.wf-text', '.wf-btn', '.wf-input', '.wf-tabbar', '.wf-chart', '.wf-legend'])
    assert.ok(wf.includes(cls), `wireframe.css has ${cls}`);
  assert.match(wf, /repeating-linear-gradient/, 'hatch fill');
  assert.match(wf, /Caveat/, 'handwritten annotation face');
  assert.match(wf, /--wf-note: #c2402a/, 'the single annotation red');

  const proto = fs.readFileSync(path.join(KIT, 'proto.css'), 'utf8');
  for (const cls of ['.proto-switcher', '.proto-frame', '.proto-hotspot']) assert.ok(proto.includes(cls), `proto.css has ${cls}`);
  assert.match(proto, /prefers-reduced-motion/);

  const js = fs.readFileSync(path.join(KIT, 'proto.js'), 'utf8');
  assert.match(js, /data-screens/);
  assert.match(js, /ArrowRight/);

  const fontsCss = fs.readFileSync(path.join(FONTS, 'fonts.css'), 'utf8');
  assert.match(fontsCss, /font-family:'Caveat'/);
  assert.ok(fs.statSync(path.join(FONTS, 'caveat-600.woff2')).size > 10_000, 'caveat woff2 vendored');
});

// ---------------- rubric ----------------

test('wireframe rubric: lo-fi bar, hi-fi creep is the defect; verdict format parses', () => {
  assert.match(WIREFRAME_RUBRIC_PROMPT, /hi-fi creep/i);
  assert.match(WIREFRAME_RUBRIC_PROMPT, /never on visual polish/);
  assert.match(WIREFRAME_RUBRIC_PROMPT, /VERDICT: PASS/);
  const v = parseDesignVerdict('VERDICT: REVISE\n- brand blue used on buttons — strip to greyscale\n- screen 3 unlabeled');
  assert.equal(v.verdict, 'revise');
  assert.equal(v.defects.length, 2);
});

// ---------------- annotation-collision geometry (pure) ----------------

test('wfNoteCollisions: notes on text hard-fail, brushes and empty-paper notes pass', () => {
  const note = { label: 'weekly time shown', x: 100, y: 100, w: 120, h: 24 };
  const row = { label: '~130 min/wk', x: 110, y: 105, w: 80, h: 16 }; // fully under the note
  const hits = wfNoteCollisions([note], [row]);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /sits ON TOP of "~130 min\/wk"/);
  assert.match(hits[0], /empty paper/);

  // A 10%-of-area brush (handwriting grazing padding) is tolerated.
  const graze = { label: 'Skip', x: 214, y: 118, w: 40, h: 14 };
  assert.equal(wfNoteCollisions([note], [graze]).length, 0);

  // Clear paper: no overlap at all.
  assert.equal(wfNoteCollisions([note], [{ label: 'NEXT', x: 400, y: 400, w: 90, h: 30 }]).length, 0);

  // Note-on-note pileups are also defects.
  const twin = { label: 'reduces overcommit', x: 110, y: 108, w: 120, h: 24 };
  assert.match(wfNoteCollisions([note, twin], [])[0], /overlap each other/);

  // Capped so a broken board doesn't flood the gate.
  const many = Array.from({ length: 9 }, (_, i) => ({ label: `n${i}`, x: 0, y: 0, w: 50, h: 50 }));
  assert.ok(wfNoteCollisions(many, [{ label: 't', x: 0, y: 0, w: 50, h: 50 }]).length <= 5);
});

// ---------------- real render: a fixture board through the actual browser gate ----------------

test('a 3-screen wireframe board renders clean through browserSmokeTest (no hard fail, no overflow)', { timeout: 120_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-wf-'));
  fs.mkdirSync(path.join(dir, 'ui-kit'));
  for (const f of ['wireframe.css']) fs.copyFileSync(path.join(KIT, f), path.join(dir, 'ui-kit', f));
  // fonts.css references woff2 files relatively; copy the two faces the kit uses.
  let fontsCss = fs.readFileSync(path.join(FONTS, 'fonts.css'), 'utf8');
  fs.writeFileSync(path.join(dir, 'ui-kit', 'fonts.css'), fontsCss);
  for (const f of ['caveat-600.woff2', 'inter-400.woff2', 'space-grotesk-700.woff2'])
    fs.copyFileSync(path.join(FONTS, f), path.join(dir, 'ui-kit', f));

  const board = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="ui-kit/fonts.css"><link rel="stylesheet" href="ui-kit/wireframe.css"><title>Checkout flow</title></head>
<body class="wf">
<header class="wf-head"><h1>Checkout flow</h1><p>3 screens · v1 <span class="wf-note-inline">guest-first bet</span></p></header>
<div class="wf-board">
  <section class="wf-screen phone"><div class="wf-title"><span class="wf-step">1</span> Cart</div>
    <div class="wf-frame">
      <div class="wf-nav"><div class="wf-logo"></div><i></i><i></i></div>
      <div class="wf-card"><div class="wf-img" style="width:48px;min-height:48px"></div><div class="wf-text head"><i></i><i></i></div></div>
      <div class="wf-text"><i></i><i></i></div>
      <div class="wf-btn primary">Checkout</div>
      <div class="wf-note" style="--nx:55%;--ny:78%">price updates live</div>
    </div>
  </section>
  <div class="wf-flow"><span>on checkout</span></div>
  <section class="wf-screen phone"><div class="wf-title"><span class="wf-step">2</span> Details</div>
    <div class="wf-frame">
      <div class="wf-input" data-label="Email"></div>
      <div class="wf-input" data-label="Address"></div>
      <div class="wf-btn primary">Pay now</div>
      <div class="wf-note below" style="--nx:20%;--ny:30%">guest checkout default</div>
      <div class="wf-tabbar"><i class="on"></i><i></i><i></i></div>
    </div>
  </section>
  <div class="wf-flow"><span>on pay</span></div>
  <section class="wf-screen phone"><div class="wf-title"><span class="wf-step">3</span> Done</div>
    <div class="wf-frame"><div class="wf-img tall"></div><div class="wf-text head"><i></i><i></i></div><div class="wf-btn">Track order</div></div>
  </section>
</div>
<div class="wf-legend"><span class="wf-note-inline">open: do we need saved cards?</span><span>v1 · checkout</span></div>
</body></html>`;
  fs.writeFileSync(path.join(dir, 'index.html'), board);

  // The same board with annotations breaking the placement rule: one note parked ON the
  // primary button's text, plus two notes stacked on the same spot — both classes of
  // collision the live fitness board shipped with. The geometry audit must hard-fail it.
  const colliding = board.replace(
    '<div class="wf-note" style="--nx:55%;--ny:78%">price updates live</div>',
    // Pinned coordinates so the overlap is deterministic regardless of flow layout.
    '<div style="position:absolute;left:12%;top:150px;font-size:13px">Cart — 3 items</div>' +
      '<div class="wf-note" style="left:12%;top:148px;transform:none">price updates live</div>' +
      '<div class="wf-note" style="left:13%;top:150px;transform:none">tax added at pay</div>',
  );
  fs.writeFileSync(path.join(dir, 'collide.html'), colliding);

  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '') || 'index.html');
    try {
      const body = fs.readFileSync(p);
      res.setHeader('Content-Type', p.endsWith('.css') ? 'text/css' : p.endsWith('.woff2') ? 'font/woff2' : 'text/html');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('nope');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const ac = new AbortController();
    const res = await browserSmokeTest(`http://127.0.0.1:${port}/index.html`, ac.signal, { wireframe: true });
    if (!res.ran) {
      t.skip('Chromium unavailable in this environment');
      return;
    }
    assert.equal(res.hardFail, false, `board renders clean: ${res.detail}`);
    assert.ok(!/horizontal overflow/i.test(res.detail), 'no mobile overflow');

    // The same board with a note parked on frame text (and a note-on-note pileup)
    // must be caught DETERMINISTICALLY — no vision key involved.
    const bad = await browserSmokeTest(`http://127.0.0.1:${port}/collide.html`, ac.signal, { wireframe: true });
    assert.equal(bad.hardFail, true, 'colliding annotations hard-fail the gate');
    assert.match(bad.detail, /Wireframe geometry audit/);
    assert.match(bad.detail, /empty paper/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
