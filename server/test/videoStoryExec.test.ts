import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dependentScenes,
  buildScenePrompt,
  compositePage,
  mergeScenes,
  saveManifest,
  loadManifest,
  latestStoryId,
  storyDirName,
  type StoryManifest,
} from '../src/agent/videoStoryExec';
import { normalizeStoryPlan } from '../src/agent/videoStory';
import { generateVideoStoryTool } from '../src/agent/tools/videoStoryTool';
import { ALL_TOOLS } from '../src/agent/tools';

const plan4 = () =>
  normalizeStoryPlan({
    scenes: [
      { what: 'walk', prompt: 'a man walks the desert', mechanism: 't2v', durationS: 6, audioDirection: 'wind' },
      { what: 'phone', prompt: 'close on the phone', mechanism: 'i2v-composited', compositeHtml: '<div>Pick up by ecosine</div>', durationS: 4, audioDirection: 'tap' },
      { what: 'car drop', prompt: 'a helicopter lowers a car', mechanism: 'frame-chain', durationS: 6, audioDirection: 'rotor' },
      { what: 'driver', prompt: 'a suited driver opens the door', mechanism: 'extend', durationS: 5, audioDirection: 'door' },
    ],
  });

// ── pure helpers ──────────────────────────────────────────────────────────────

test('dependentScenes: a retake re-chains the contiguous dependent run', () => {
  const plan = plan4();
  // scene 2 is composited (independent) → retaking 1 pulls only 1... but 3 chains off 2, not 1.
  assert.deepEqual(dependentScenes(plan, 1), [1]);
  // retaking 2 pulls 3 (frame-chain) and 4 (extend) — the whole downstream chain.
  assert.deepEqual(dependentScenes(plan, 2), [2, 3, 4]);
  assert.deepEqual(dependentScenes(plan, 4), [4]);
  assert.deepEqual(dependentScenes(plan, 99), [99]);
});

test('buildScenePrompt: scene + shared style + audio compile through the video compiler', () => {
  const p = buildScenePrompt(plan4().scenes[0], 'Style: cinematic photoreal, warm light.', undefined);
  assert.match(p, /a man walks the desert/);
  assert.match(p, /cinematic photoreal/);
  assert.match(p, /Audio: wind/);
  const retake = buildScenePrompt(plan4().scenes[0], 'Style: x.', 'make him walk slower');
  assert.match(retake, /walk slower/);
});

test('compositePage: fragments get wrapped and sized; full documents pass through', () => {
  const w = compositePage('<div>BTN</div>', 720, 1280);
  assert.match(w, /width:720px;height:1280px/);
  assert.match(w, /BTN/);
  const full = compositePage('<html><body>x</body></html>', 100, 100);
  assert.ok(!full.includes('width:100px'), 'full documents are not re-wrapped');
});

test('mergeScenes: fresh results override by id, order restored', () => {
  const merged = mergeScenes(
    [
      { id: 1, what: 'a', mechanismPlanned: 't2v', mechanismUsed: 't2v', status: 'ok', file: 'old1' },
      { id: 2, what: 'b', mechanismPlanned: 't2v', mechanismUsed: 't2v', status: 'failed' },
    ],
    [{ id: 2, what: 'b', mechanismPlanned: 't2v', mechanismUsed: 't2v', status: 'ok', file: 'new2' }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[1].file, 'new2');
  assert.equal(merged[1].status, 'ok');
});

// ── manifest round-trip ───────────────────────────────────────────────────────

test('manifest: save/load/latest round-trip', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  const m: StoryManifest = {
    id: '1111',
    createdAt: 1,
    story: 's',
    aspect: '16:9',
    audio: true,
    transition: 'cut',
    plan: plan4(),
    pass: 'draft',
    scenes: [],
    totalTokens: 0,
    costUsd: 0,
  };
  saveManifest(repo, m);
  const loaded = loadManifest(repo, '1111');
  assert.equal(loaded?.plan.scenes.length, 4);
  const m2 = { ...m, id: '2222' };
  saveManifest(repo, m2);
  assert.equal(latestStoryId(repo), '2222');
  assert.equal(loadManifest(repo, 'nope'), null);
  assert.match(storyDirName('1111'), /^videos\/story-1111$/);
  fs.rmSync(repo, { recursive: true, force: true });
});

// ── tool registration + steering surface ─────────────────────────────────────

test('generate_video_story: registered, gated like generate_video, schema sane', () => {
  const tool = ALL_TOOLS.find((t) => t.name === 'generate_video_story');
  assert.ok(tool, 'registered in ALL_TOOLS');
  assert.deepEqual(tool!.modes, ['chat', 'code']);
  const props = (tool!.parameters as any).properties;
  for (const k of ['story', 'final', 'retake_scene', 'retake_note', 'story_id', 'cast_images', 'transition']) {
    assert.ok(props[k], `param ${k}`);
  }
  assert.match(tool!.description, /SEQUENCE/);
  assert.equal(generateVideoStoryTool.summarize({ retake_scene: 2 }), 'retake scene 2');
});

test('generate_video_story: follow-up without an existing story fails plainly', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  const out = await generateVideoStoryTool.run(
    { final: true },
    { repoDir: repo, signal: new AbortController().signal, addCost: () => {}, session: {} as any, mode: 'chat' } as any,
  );
  assert.match(out, /no existing story/i);
  fs.rmSync(repo, { recursive: true, force: true });
});
