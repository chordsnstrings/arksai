import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { addHeroFxTool, FX_EFFECTS } from '../src/agent/tools/hero-fx';

const ctx = (ws: string): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'code',
  signal: new AbortController().signal,
  addCost: () => {},
});

const KIT = path.join(__dirname, '..', 'assets', 'ui-kit');
const js = () => fs.readFileSync(path.join(KIT, 'hero-fx.js'), 'utf8');
const css = () => fs.readFileSync(path.join(KIT, 'hero-fx.css'), 'utf8');

test('add_hero_fx self-hosts the runtime into ui-kit/ and returns fallback-first markup', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-fx-'));
  const out = await addHeroFxTool.run({}, ctx(ws));
  assert.ok(fs.existsSync(path.join(ws, 'ui-kit', 'hero-fx.css')), 'css copied');
  assert.ok(fs.existsSync(path.join(ws, 'ui-kit', 'hero-fx.js')), 'js copied');
  // the returned markup is the correct-by-construction pattern
  assert.match(out, /class="fx-hero"/);
  assert.match(out, /data-fx="aurora"/);
  assert.match(out, /class="fx-canvas"/);
  assert.match(out, /--fx-bg:/);
  assert.match(out, /class="fx-content"/);
  // it is code-mode only + gated in the description
  assert.deepEqual(addHeroFxTool.modes, ['code']);
});

test('respects a custom serve dir (public/ui-kit)', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-fx2-'));
  const out = await addHeroFxTool.run({ dest: 'public/ui-kit' }, ctx(ws));
  assert.ok(fs.existsSync(path.join(ws, 'public', 'ui-kit', 'hero-fx.js')));
  assert.match(out, /public\/ui-kit/);
});

test('the runtime is fully self-contained (no CDN / external URL)', () => {
  const src = js() + '\n' + css();
  assert.doesNotMatch(src, /https?:\/\//, 'no external http(s) URL anywhere in the bundle');
  assert.doesNotMatch(js(), /\bimport\b|\brequire\(/, 'no module import — plain IIFE, drop-in');
});

test('the runtime is fallback-first, reduced-motion-safe and perf-budgeted', () => {
  const src = js();
  // reduced motion → hide the canvas so the solid fallback shows
  assert.match(src, /prefers-reduced-motion/);
  assert.match(src, /canvas\.style\.display\s*=\s*'none'/);
  // Canvas 2D, never WebGL (WebGL blanks under headless/software rendering)
  assert.match(src, /getContext\('2d'\)/);
  assert.doesNotMatch(src, /getContext\(\s*['"]webgl|WebGLRenderingContext/i, 'no WebGL API — Canvas 2D only');
  // perf budget: capped DPR + a hard particle cap + offscreen/tab-hidden pause
  assert.match(src, /Math\.min\(W\.devicePixelRatio/);
  assert.match(src, /IntersectionObserver/);
  assert.match(src, /visibilitychange/);
  // error-guarded so it can never crash the page (would trip the pageerror gate)
  assert.match(src, /try\s*{[\s\S]*getContext/, 'context acquisition is guarded');
  assert.match(src, /catch/);
});

test('the CSS makes --fx-bg the load-bearing fallback the gate measures', () => {
  const src = css();
  // .fx-hero carries a SOLID fallback colour (what the contrast gate measures + no-JS fallback)
  assert.match(src, /\.fx-hero\s*{[\s\S]*background:\s*var\(--fx-bg/);
  // content sits above the canvas; the canvas never eats clicks
  assert.match(src, /\.fx-content\s*{[\s\S]*z-index:\s*2/);
  assert.match(src, /\.fx-canvas\s*{[\s\S]*pointer-events:\s*none/);
  // belt-and-braces reduced-motion canvas hide in CSS too
  assert.match(src, /prefers-reduced-motion[\s\S]*\.fx-canvas[\s\S]*display:\s*none/);
});

test('every catalog effect is a real dispatch branch in the runtime', () => {
  const src = js();
  const ids = FX_EFFECTS.map((e) => e.id).sort();
  assert.deepEqual(ids, ['aurora', 'particles', 'waves']);
  for (const e of FX_EFFECTS) {
    // each id is handled (either as an explicit kind branch or the aurora default)
    assert.match(src, new RegExp(`'${e.id}'`), `runtime references the ${e.id} effect`);
  }
  // the three draw routines exist
  assert.match(src, /function drawAurora/);
  assert.match(src, /function drawParticles/);
  assert.match(src, /function drawWaves/);
});
