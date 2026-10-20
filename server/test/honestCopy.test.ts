import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// User-facing copy must describe what actually works today (ModelArk migration): no TTS-only
// promises while ttsAvailable() is false, and admin pointers name the real Admin tab.

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('features page: motion-graphic explainers are marked as coming back, not offered as live', () => {
  const src = read('client/src/components/FeaturesPage.tsx');
  const card = src.match(/title: 'Motion-graphic explainers[^']*', body: '([^']*)'/);
  assert.ok(card, 'motion-explainer card present');
  assert.match(card![0], /back soon/i, 'the card title says it is coming back');
  assert.match(card![1], /coming back soon/i);
  // the render_motion_video pitch (pennies per video, any length) is off while TTS is off
  assert.doesNotMatch(src, /pennies per video|any length/i);
  // …and it points at what works now: Seedance clips with native sound + natively-voiced story films
  assert.match(card![1], /native sound/);
  assert.match(card![1], /narration voiced scene by scene/);
  assert.doesNotMatch(src, /narrated motion-graphic/i);
});

test('voice chat: the stop tooltip only promises "send" when Conversation mode is on', () => {
  const src = read('client/src/components/VoiceChat.tsx');
  const title = src.match(/title=\{\s*recording\s*\?\s*convo\s*\?\s*'Tap to stop & send'\s*:\s*'([^']+)'/);
  assert.ok(title, 'recording tooltip is conditional on convo');
  assert.match(title![1], /go in the box/);
  assert.doesNotMatch(src, /recording \? 'Tap to stop & send'/, 'no unconditional "send" promise');
});

test('admin pointers name the real tab: Admin → Keys (never the non-existent "Providers" tab)', () => {
  const dialog = read('client/src/components/AdminDialog.tsx');
  assert.match(dialog, /setTab\('keys'\)\}>\s*Keys\s*</, 'the AdminDialog tab is labelled Keys');
  // Files owned by a concurrent change (their copy is fixed there) — drop from this set once updated.
  const PENDING = new Set<string>();
  const offenders: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist') walk(r);
      } else if (/\.(ts|tsx|mjs|sh)$/.test(e.name) && !PENDING.has(r)) {
        if (fs.readFileSync(path.join(ROOT, r), 'utf8').includes('Admin → Providers')) offenders.push(r);
      }
    }
  };
  for (const dir of ['server/src', 'client/src', 'scripts']) walk(dir);
  assert.deepEqual(offenders, []);
  for (const rel of ['server/src/index.ts', 'server/src/routes/builds.ts', 'scripts/deploy-check.sh']) {
    assert.match(read(rel), /Admin → Keys/, `${rel} points at Admin → Keys`);
  }
});
