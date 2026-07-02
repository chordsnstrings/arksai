import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoTask, VIDEO_MODELS } from '../src/engines/seedance';
import { compileVideoPrompt } from '../src/agent/videoBrief';

// ---- buildVideoTask (pure): branded models, clamps, draft rules, audio default ----

test('video: branded model mapping — 1.5 default, 2.0 selectable, unknown falls back to 1.5', () => {
  assert.equal(buildVideoTask({ prompt: 'a cat' }).apiModel, VIDEO_MODELS['arksai-video-15'].api);
  assert.equal(buildVideoTask({ prompt: 'a cat', model: 'arksai-video-20' }).apiModel, VIDEO_MODELS['arksai-video-20'].api);
  assert.equal(buildVideoTask({ prompt: 'a cat', model: 'bogus' }).apiModel, VIDEO_MODELS['arksai-video-15'].api);
  assert.equal(VIDEO_MODELS['arksai-video-15'].label, 'ArksAI Video 1.5');
  assert.equal(VIDEO_MODELS['arksai-video-20'].label, 'ArksAI Video 2.0');
});

test('video: duration clamps to the model’s verified range (1.5 = 4–12, 2.0 = 4–15)', () => {
  assert.equal(buildVideoTask({ prompt: 'x', duration: 2 }).duration, 4);
  assert.equal(buildVideoTask({ prompt: 'x', duration: 30 }).duration, 12);
  assert.equal(buildVideoTask({ prompt: 'x', duration: 30, model: 'arksai-video-20' }).duration, 15);
  assert.equal(buildVideoTask({ prompt: 'x' }).duration, 8); // default
});

test('video: a draft is 480p on 1.5; 2.0 never drafts (API rejects draft there)', () => {
  const d = buildVideoTask({ prompt: 'x', draft: true, resolution: '1080p' });
  assert.equal(d.draft, true);
  assert.equal(d.resolution, '480p');
  assert.equal((d.body as any).draft, true);
  const v2 = buildVideoTask({ prompt: 'x', draft: true, model: 'arksai-video-20' });
  assert.equal(v2.draft, false);
  assert.equal((v2.body as any).draft, undefined);
});

test('video: native audio defaults ON; params ride the prompt text; i2v adds first_frame', () => {
  const t = buildVideoTask({ prompt: 'a red apple', aspect: '9:16', duration: 6, imageUrl: 'data:image/png;base64,AAA' });
  assert.equal((t.body as any).generate_audio, true);
  const text = (t.body as any).content[0].text as string;
  assert.match(text, /--ratio 9:16/);
  assert.match(text, /--duration 6/);
  const img = (t.body as any).content[1];
  assert.equal(img.type, 'image_url');
  assert.equal(img.role, 'first_frame');
  assert.equal(buildVideoTask({ prompt: 'x', audio: false }).body.generate_audio, false);
});

test('video: start+end frames and reference images map to the right ModelArk roles', () => {
  const t = buildVideoTask({
    prompt: 'a product spins',
    imageUrl: 'data:image/png;base64,START',
    lastFrameUrl: 'data:image/png;base64,END',
    referenceUrls: ['data:image/png;base64,R1', 'data:image/png;base64,R2'],
  });
  const content = (t.body as any).content as any[];
  const roles = content.filter((c) => c.type === 'image_url').map((c) => c.role);
  assert.deepEqual(roles, ['first_frame', 'last_frame', 'reference_image', 'reference_image']);
  // No image inputs → only the text part, no image content.
  const bare = buildVideoTask({ prompt: 'x' });
  assert.equal((bare.body as any).content.length, 1);
});

test('video: invalid resolution/aspect fall back to safe defaults', () => {
  const t = buildVideoTask({ prompt: 'x', resolution: '9999p', aspect: '3:7' });
  assert.equal(t.resolution, '1080p');
  assert.match((t.body as any).content[0].text, /--ratio 16:9/);
});

// ---- compileVideoPrompt (pure): director-grade defaults, never overrides the author ----

test('videoBrief: adds camera/lighting/style/audio only when missing; dialogue is spoken verbatim', () => {
  const bare = compileVideoPrompt({ brief: 'a barista pours latte art' });
  assert.match(bare, /Camera:/);
  assert.match(bare, /Lighting:/);
  assert.match(bare, /Style:/);
  assert.match(bare, /Audio:/);
  // Exactly ONE camera move is directed (the single-move rule).
  assert.equal((bare.match(/Camera:/g) || []).length, 1);
  // A person in frame → anatomy-stability negatives.
  assert.match(bare, /no warped faces or hands/);

  // Fully-authored brief: the compiler must not fight explicit camera/lighting/style/audio.
  const authored = compileVideoPrompt({ brief: 'Slow push-in on a barista, cinematic 35mm, golden hour light, we hear the espresso machine' });
  assert.doesNotMatch(authored, /Camera: one/);
  assert.doesNotMatch(authored, /Lighting: soft/);
  assert.doesNotMatch(authored, /Style: premium/);
  assert.doesNotMatch(authored, /Audio: natural ambient/);

  // Dialogue is quoted verbatim (the synced-audio signal).
  const talk = compileVideoPrompt({ brief: 'a founder at a desk', dialogue: 'Welcome to TaskForge.' });
  assert.match(talk, /a clear voice says "Welcome to TaskForge\."/);

  // A product hero orbits; a landscape rises; long shots add the no-flicker negative.
  assert.match(compileVideoPrompt({ brief: 'a sleek phone on a pedestal' }), /orbit/);
  assert.match(compileVideoPrompt({ brief: 'a wide mountain valley at dawn' }), /aerial rise/);
  assert.match(compileVideoPrompt({ brief: 'abstract shapes flowing', durationSec: 10 }), /no temporal flicker/);
});
