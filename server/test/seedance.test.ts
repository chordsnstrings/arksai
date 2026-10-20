import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVideoTask,
  VIDEO_MODELS,
  isRealPersonRejection,
  realPersonFallbackSpec,
  effectiveVideoModel,
  createVideoTask,
  seedanceOn,
  __resetVideoAvailabilityForTest,
} from '../src/engines/seedance';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';
import { config } from '../src/config';
import { compileVideoPrompt, fitDialogue, splitSentences, DIALOGUE_MAX_CHARS } from '../src/agent/videoBrief';

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

test('video: real-person rejection routes to the supported path — 1.5 + first_frame (verified live)', () => {
  // The provider's exact wording (live rejection, 2026-07-02).
  assert.equal(isRealPersonRejection('The request failed because the input image may contain real person. Request id: x'), true);
  assert.equal(isRealPersonRejection('quota exceeded'), false);

  // A lone 2.0 reference (the person photo) becomes 1.5 animate-the-photo — the image IS the
  // declined one, so the likeness claim is true.
  const solo = realPersonFallbackSpec({ prompt: 'p', model: 'arksai-video-20', referenceUrls: ['data:img/REF'] });
  assert.ok(solo);
  assert.equal(solo!.spec.model, 'arksai-video-15');
  assert.equal(solo!.spec.imageUrl, 'data:img/REF');
  assert.deepEqual(solo!.spec.referenceUrls, []);
  assert.equal(solo!.animated, 'reference_image');
  assert.equal(solo!.isPersonImage, true);
  assert.equal(solo!.dropped, 0);
  // A lone start frame: it IS the declined photo → animated as-is, likeness true.
  const ff = realPersonFallbackSpec({ prompt: 'p', model: 'arksai-video-25', imageUrl: 'data:img/FF' });
  assert.equal(ff!.spec.imageUrl, 'data:img/FF');
  assert.equal(ff!.animated, 'first_frame');
  assert.equal(ff!.isPersonImage, true);
  // No start frame but several images: the provider doesn't say which one is the person, so the
  // first reference is animated and REPORTED as such — never claimed as the person (V1).
  const multi = realPersonFallbackSpec({ prompt: 'p', model: 'arksai-video-20', referenceUrls: ['data:img/REF'], lastFrameUrl: 'data:img/END' });
  assert.ok(multi);
  assert.equal(multi!.spec.imageUrl, 'data:img/REF');
  assert.equal(multi!.spec.lastFrameUrl, undefined);
  assert.equal(multi!.animated, 'reference_image');
  assert.equal(multi!.isPersonImage, false);
  assert.equal(multi!.dropped, 1);
  assert.equal(realPersonFallbackSpec({ prompt: 'p', lastFrameUrl: 'data:img/END' })!.animated, 'last_frame');
  // A start frame set ALONGSIDE another image → no reroute (the person may be the other image;
  // animating the start frame would drop them while claiming their likeness) — the caller rethrows.
  assert.equal(realPersonFallbackSpec({ prompt: 'p', imageUrl: 'data:img/FF', referenceUrls: ['data:img/REF'] }), null);
  assert.equal(realPersonFallbackSpec({ prompt: 'p', imageUrl: 'data:img/FF', lastFrameUrl: 'data:img/END' }), null);
  // No image at all → nothing legitimate to retry with.
  assert.equal(realPersonFallbackSpec({ prompt: 'p' }), null);
  assert.equal(realPersonFallbackSpec({ prompt: 'p', referenceUrls: [] }), null);
});

test('video: a 4K final on 2.5 renders on 2.0 (2.5 is only listed at 480p–1080p); drafts and ≤1080p stay on 2.5', () => {
  assert.equal(effectiveVideoModel({ model: 'arksai-video-25', resolution: '4k' }), 'arksai-video-20');
  assert.equal(effectiveVideoModel({ model: 'arksai-video-25', resolution: '4K' }), 'arksai-video-20');
  assert.equal(effectiveVideoModel({ model: 'arksai-video-25', resolution: '1080p' }), 'arksai-video-25');
  assert.equal(effectiveVideoModel({ model: 'arksai-video-25', resolution: '4k', draft: true }), 'arksai-video-25');
  assert.equal(effectiveVideoModel({ model: 'arksai-video-20', resolution: '4k' }), 'arksai-video-20');
  assert.equal(effectiveVideoModel({ model: 'bogus' }), 'arksai-video-15');
  const t = buildVideoTask({ prompt: 'x', model: 'arksai-video-25', resolution: '4k' });
  assert.equal(t.model, 'arksai-video-20');
  assert.equal(t.apiModel, VIDEO_MODELS['arksai-video-20'].api);
  assert.equal(t.resolution, '4k');
  assert.match((t.body as any).content[0].text, /--resolution 4k/);
  const d = buildVideoTask({ prompt: 'x', model: 'arksai-video-25', resolution: '4k', draft: true });
  assert.equal(d.model, 'arksai-video-25');
  assert.equal(d.resolution, '480p');
});

test('createVideoTask: a 2.5 4K final POSTs 2.0 directly and never marks 2.5 unavailable', async () => {
  const realFetch = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    models.push(JSON.parse(init.body).model);
    return new Response(JSON.stringify({ id: `t${models.length}` }), { status: 200 });
  }) as any;
  __setByteplusKeyForTest('ark-test');
  __resetVideoAvailabilityForTest();
  try {
    const four = await createVideoTask({ prompt: 'x', model: 'arksai-video-25', resolution: '4k' }, new AbortController().signal);
    assert.equal(four.built.model, 'arksai-video-20');
    const hd = await createVideoTask({ prompt: 'x', model: 'arksai-video-25', resolution: '1080p' }, new AbortController().signal);
    assert.equal(hd.built.model, 'arksai-video-25', '2.5 is still tried for a 1080p final');
    assert.deepEqual(models, [VIDEO_MODELS['arksai-video-20'].api, VIDEO_MODELS['arksai-video-25'].api]);
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
    __resetVideoAvailabilityForTest();
  }
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

test('videoBrief: over-long dialogue is cut at a sentence, else a word, boundary — flagged, never mid-word', () => {
  // Fits → untouched, not flagged.
  assert.deepEqual(fitDialogue('Welcome to TaskForge.'), { text: 'Welcome to TaskForge.', trimmed: false });
  assert.deepEqual(fitDialogue(undefined), { text: '', trimmed: false });
  // Too long → the whole sentences that fit (the abbreviation "Mr." is not a boundary).
  const s1 = 'Say hi to Mr. Khan, who has baked bread on this corner for thirty years.'; // 72
  const s2 = 'Every loaf is shaped by hand before the sun comes up.'; // 53
  const s3 = 'Come early, because the sourdough is usually gone by nine in the morning.';
  const long = fitDialogue(`${s1} ${s2} ${s3}`);
  assert.equal(long.trimmed, true);
  assert.equal(long.text, `${s1} ${s2}`);
  assert.ok(long.text.length <= DIALOGUE_MAX_CHARS);
  // One sentence longer than the cap → the last WHOLE word that fits, no dangling comma.
  const run = 'We knead, we fold, we proof, we bake, ' + Array.from({ length: 40 }, (_, i) => `loaf${i}`).join(' ') + '.';
  const word = fitDialogue(run);
  assert.equal(word.trimmed, true);
  assert.ok(word.text.length <= DIALOGUE_MAX_CHARS && word.text.length > DIALOGUE_MAX_CHARS - 12, word.text);
  assert.ok(run.startsWith(word.text) && run[word.text.length] === ' ', `cut on a word boundary: ${word.text}`);
  assert.doesNotMatch(word.text, /[,\s]$/);
  // The compiled prompt speaks exactly the fitted line, with the proven Audio phrasing.
  assert.ok(compileVideoPrompt({ brief: 'a baker at dawn', dialogue: `${s1} ${s2} ${s3}` }).includes(`Audio: a clear voice says "${s1} ${s2}", lip-synced, with subtle matching ambience.`));
});

test('videoBrief: an over-cap UNSPACED script (CJK/Thai) is never cut to nothing or a speaker-label stub (V6)', () => {
  // Chinese: no spaces at all — cut at the last full-width full stop that fits.
  const zhSentence = '我们的面包店每天清晨四点开始揉面，每一个面包都是手工制作的，用的是最好的面粉和天然酵母。';
  const zh = fitDialogue(zhSentence.repeat(5));
  assert.equal(zh.trimmed, true);
  assert.ok(zh.text.endsWith('。'), zh.text);
  assert.ok(zh.text.length <= DIALOGUE_MAX_CHARS && zh.text.length > DIALOGUE_MAX_CHARS / 2, zh.text);
  // A speaker label before unspaced text: the only space sits right after the label, so a word
  // cut would voice just "Narrator" — it hard-cuts at the cap instead.
  const lab = fitDialogue(`Narrator: ${'我们的面包店每天清晨四点开始揉面每一个面包都是手工制作的'.repeat(8)}`);
  assert.ok(lab.text.startsWith('Narrator: 我们'), lab.text);
  assert.equal(lab.text.length, DIALOGUE_MAX_CHARS);
  // Thai (no spaces, no full-width stops) behind a lone dash never collapses to ''.
  const th = fitDialogue(`— ${'ขนมปังของเราอบสดใหม่ทุกเช้า'.repeat(12)}`);
  assert.ok(th.text.length > DIALOGUE_MAX_CHARS / 2 && th.text.length <= DIALOGUE_MAX_CHARS, th.text);
  // Astral characters are cut whole — never a lone surrogate.
  const bread = fitDialogue('🥖'.repeat(100));
  assert.ok(bread.text.length <= DIALOGUE_MAX_CHARS && bread.text.length > DIALOGUE_MAX_CHARS - 2);
  assert.ok([...bread.text].every((c) => c === '🥖'), 'no split surrogate pair');
  // 。！？ end sentences for the shared splitter too.
  assert.deepEqual(splitSentences('你好！\n我是小明。 今天天气很好？ 是的。'), ['你好！', '我是小明。', '今天天气很好？', '是的。']);
});

// ---- Video 2.5 (the default) + the activation fallback chain ----

test('video: 2.5 is first-class — 4–15 s, no native draft, labelled, falls back to 2.0', () => {
  const m = VIDEO_MODELS['arksai-video-25'];
  assert.equal(m.label, 'ArksAI Video 2.5');
  assert.equal(m.fallback, 'arksai-video-20');
  const t = buildVideoTask({ prompt: 'x', model: 'arksai-video-25', duration: 30 });
  assert.equal(t.apiModel, m.api);
  assert.equal(t.duration, 15);
  assert.equal(buildVideoTask({ prompt: 'x', model: 'arksai-video-25', duration: 1 }).duration, 4);
  const d = buildVideoTask({ prompt: 'x', model: 'arksai-video-25', draft: true });
  assert.equal(d.draft, false, 'no native draft on 2.x');
  assert.equal((d.body as any).draft, undefined);
  assert.equal(d.resolution, '480p');
});

test('video: every fallback chain points at a real model and terminates (no cycles)', () => {
  for (const start of Object.keys(VIDEO_MODELS)) {
    const seen = new Set<string>([start]);
    let cur = VIDEO_MODELS[start].fallback;
    while (cur) {
      assert.ok(VIDEO_MODELS[cur], `${start}: fallback ${cur} exists`);
      assert.ok(!seen.has(cur), `${start}: fallback cycle at ${cur}`);
      seen.add(cur);
      cur = VIDEO_MODELS[cur].fallback;
    }
    assert.ok(seen.size <= 3, `${start}: createVideoTask hops at most 3 times`);
  }
});

test('createVideoTask: authenticated POST to the general endpoint; both models refused → an honest error', async () => {
  const realFetch = globalThis.fetch;
  const seen: { url: string; auth: string; model: string }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), auth: init.headers.Authorization, model: JSON.parse(init.body).model });
    return new Response(JSON.stringify({ error: { code: 'ModelNotOpen', message: 'Your account has not activated the model' } }), { status: 404 });
  }) as any;
  __setByteplusKeyForTest('ark-test');
  __resetVideoAvailabilityForTest();
  try {
    assert.equal(seedanceOn(), true);
    await assert.rejects(
      () => createVideoTask({ prompt: 'x', model: 'arksai-video-25' }, new AbortController().signal),
      /video task rejected — Your account has not activated the model/,
    );
    assert.deepEqual(seen.map((s) => s.model), [VIDEO_MODELS['arksai-video-25'].api, VIDEO_MODELS['arksai-video-20'].api]);
    for (const s of seen) {
      assert.equal(s.url, `${config.byteplusVideoBaseUrl.replace(/\/$/, '')}/contents/generations/tasks`);
      assert.equal(s.auth, 'Bearer ark-test');
    }
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
    __resetVideoAvailabilityForTest();
  }
  assert.equal(seedanceOn(), false, 'gated on the ModelArk key');
});

test('createVideoTask: a 200 without a task id is a rejection, not a phantom task', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'queued' }), { status: 200 })) as any;
  __setByteplusKeyForTest('ark-test');
  __resetVideoAvailabilityForTest();
  try {
    await assert.rejects(() => createVideoTask({ prompt: 'x', model: 'arksai-video-15' }, new AbortController().signal), /video task rejected — HTTP 200/);
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
});
