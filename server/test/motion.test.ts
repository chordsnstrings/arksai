import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { framesToVideoCmd, frameCount, frameName, pickFps, DIMENSION_PRESETS } from '../src/agent/motion/encode';
import { auditSceneHtml } from '../src/agent/motion/capture';
import { searchAssets, libraryStats, assetSource } from '../src/agent/assets/library';
import { materializeAssets, buildAssetSvg } from '../src/agent/assets/materialize';

// ---------------- encode: pure command builders ----------------

test('encode: frames→video with narration re-encodes uniformly (aac 44.1k stereo, h264 yuv420p)', () => {
  const cmd = framesToVideoCmd('/w/videos/motion-1/frames-1', 30, '/w/videos/motion-1/scene-1.mp4', {
    audioIn: '/w/videos/motion-1/scene-1.mp3',
    durationS: 6.2,
  });
  assert.match(cmd, /-framerate 30/);
  assert.match(cmd, /frame%05d\.jpg/);
  assert.match(cmd, /-c:v libx264/);
  assert.match(cmd, /-pix_fmt yuv420p/);
  assert.match(cmd, /-c:a aac -b:a 160k -ar 44100 -ac 2/);
  assert.match(cmd, /-shortest/);
});

test('encode: a silent scene gets a generated silence track (concat needs uniform streams)', () => {
  const cmd = framesToVideoCmd('/w/f', 24, '/w/out.mp4', { durationS: 3 });
  assert.match(cmd, /anullsrc=r=44100:cl=stereo/);
  assert.match(cmd, /-t 3\.000/);
  assert.doesNotMatch(cmd, /-shortest/);
});

test('encode: frame math + fps policy (30 short / 24 past 2 minutes) + presets', () => {
  assert.equal(frameCount(1000, 30), 30);
  assert.equal(frameCount(6500, 24), 156);
  assert.equal(frameName(7), 'frame00007.jpg');
  assert.equal(pickFps(60_000), 30);
  assert.equal(pickFps(121_000), 24);
  assert.deepEqual(DIMENSION_PRESETS['9:16'], { w: 1080, h: 1920 });
});

// ---------------- capture: deterministic scene audit ----------------

test('audit: catches a missing runtime, external refs, and wall-clock JS', () => {
  const bad = `<html><head><link href="https://fonts.googleapis.com/x.css"></head>
    <body><script>setInterval(()=>{},16)</script></body></html>`;
  const problems = auditSceneHtml(bad);
  assert.ok(problems.some((p) => p.includes('motion.js')), 'missing runtime flagged');
  assert.ok(problems.some((p) => p.includes('external')), 'external ref flagged');
  assert.ok(problems.some((p) => p.includes('wall-clock')), 'wall-clock flagged');
  const good = `<html><head><link rel="stylesheet" href="motion-kit/motion.css"></head>
    <body><script src="motion-kit/motion.js"></script></body></html>`;
  assert.deepEqual(auditSceneHtml(good), []);
});

// ---------------- asset library ----------------

test('assets: the vendored library is substantial and search is deterministic + on-point', () => {
  const s = libraryStats();
  assert.ok(s.total > 12_000, `expected >12k assets, got ${s.total}`);
  assert.ok(s.logos > 3_000, `expected >3k brand logos, got ${s.logos}`);

  // Concept queries hit the right assets (the explainer use-case).
  const chol = searchAssets('cholesterol', { limit: 5 }).map((h) => h.id);
  assert.ok(chol.some((id) => id.includes('blood') || id.includes('heart')), `cholesterol → ${chol.join(',')}`);
  const brand = searchAssets('stripe logo', { limit: 3 });
  assert.equal(brand[0].id, 'brand:stripe', 'filler "logo" biases to the real brand mark');
  // deterministic: same query → same order
  assert.deepEqual(searchAssets('exercise', { limit: 4 }), searchAssets('exercise', { limit: 4 }));
  // kind filter
  assert.ok(searchAssets('whatsapp', { kind: 'logo', limit: 3 }).every((h) => h.kind === 'logo'));
});

test('assets: materialization writes recolorable SVGs + attribution, and fails soft on unknown ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-assets-'));
  const r = materializeAssets(dir, ['lucide:heart-pulse', 'brand:stripe', 'nope:x'], { color: '#0a7d5b', size: 120 });
  assert.equal(r.written.length, 2);
  assert.deepEqual(r.unknown, ['nope:x']);
  const icon = fs.readFileSync(path.join(dir, 'assets/lucide-heart-pulse.svg'), 'utf8');
  assert.match(icon, /style="color:#0a7d5b"/);
  assert.match(icon, /viewBox="0 0 24 24"/);
  const logo = fs.readFileSync(path.join(dir, 'assets/brand-stripe.svg'), 'utf8');
  assert.match(logo, /fill="#0a7d5b"/); // explicit color overrides the brand hex
  assert.ok(fs.existsSync(path.join(dir, 'assets/ATTRIBUTIONS.md')), 'license attribution ships with the assets');
  // default: a brand mark keeps its OFFICIAL color
  const def = buildAssetSvg('brand:stripe');
  assert.match(def!.svg, /fill="#635BFF"/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assets: every indexed id resolves to a real source (no dangling manifest entries)', () => {
  // spot-check a sample across sets rather than all 15k (keeps the suite fast)
  for (const q of ['heart', 'salad', 'shield', 'blood', 'chart']) {
    for (const h of searchAssets(q, { limit: 6 })) {
      assert.ok(assetSource(h.id), `assetSource(${h.id}) resolved`);
    }
  }
});
