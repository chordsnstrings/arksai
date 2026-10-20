import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateVideoTool, generateImageTool, videoModelFor, videoModelArg, videoPromptFor } from '../src/agent/tools/media';
import { DIALOGUE_MAX_CHARS } from '../src/agent/videoBrief';
import { VIDEO_MODELS, videoCostEstimate, __resetVideoAvailabilityForTest } from '../src/engines/seedance';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';
import { config } from '../src/config';

// Seedance (ArksAI Video) parameter + billing coverage for the generate_video TOOL — the engine's
// pure builder and the 2.5→2.0 activation fallback are covered in seedance/modelark tests.
// Hermetic: fetch is stubbed (create task → poll → download) and the 5 s poll timer is mocked.

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---- videoModelFor: the tool's `model` arg → branded Seedance model ----

test('videoModelFor: auto/empty/unknown → ArksAI Video 2.5 (the default)', () => {
  for (const a of [undefined, null, '', 'auto', 'AUTO', 'video-2.5', 'arksai-video-25', 'best', 'hailuo']) {
    assert.equal(videoModelFor(a), 'arksai-video-25', `arg ${String(a)}`);
  }
});

test('videoModelFor: 2.0 and 1.5 map in every spelling the model tends to emit', () => {
  for (const a of ['video-2.0', 'video2.0', 'video-20', 'VIDEO-2.0', 'arksai-video-20', 'arksai-video-2.0']) {
    assert.equal(videoModelFor(a), 'arksai-video-20', a);
  }
  for (const a of ['video-1.5', 'video1.5', 'video-15', 'arksai-video-15', 'ArksAI-Video-1.5']) {
    assert.equal(videoModelFor(a), 'arksai-video-15', a);
  }
  // Every mapped id is a real Seedance model entry.
  for (const id of ['arksai-video-25', 'arksai-video-20', 'arksai-video-15']) assert.ok(VIDEO_MODELS[id], id);
});

test('videoModelFor: version digits in ANY spelling win; cost words pick the cheapest (never silently 2.5)', () => {
  for (const a of ['1.5', 'v1.5', 'seedance-1.5', 'Seedance 1.5 Pro', 'seedance-1-5-pro-251215', '1']) {
    assert.equal(videoModelFor(a), 'arksai-video-15', a);
  }
  for (const a of ['2.0', '2', 'v2', 'seedance-2.0', 'Seedance 2', 'dreamina-seedance-2-0-fast-260128', 'video 2.0 1080p']) {
    assert.equal(videoModelFor(a), 'arksai-video-20', a);
  }
  for (const a of ['2.5', 'v2.5', 'seedance-2.5', 'dreamina-seedance-2-5-260628']) {
    assert.equal(videoModelFor(a), 'arksai-video-25', a);
  }
  for (const a of ['fast', 'cheapest', 'cheap', 'Fastest', 'budget']) {
    assert.equal(videoModelFor(a), 'arksai-video-15', a);
  }
  // Resolutions / dates are never read as a model version.
  assert.equal(videoModelFor('1080p'), 'arksai-video-25');
});

test('videoModelArg: branded model → the exact tool arg that pins it (round-trips through videoModelFor)', () => {
  assert.equal(videoModelArg('arksai-video-25'), 'video-2.5');
  assert.equal(videoModelArg('arksai-video-20'), 'video-2.0');
  assert.equal(videoModelArg('arksai-video-20-fast'), 'video-2.0');
  assert.equal(videoModelArg('arksai-video-15'), 'video-1.5');
  for (const m of ['arksai-video-25', 'arksai-video-20', 'arksai-video-15']) assert.equal(videoModelFor(videoModelArg(m)), m);
});

test('generate_image: an unconfigured key points the admin at the Keys tab', async () => {
  __setByteplusKeyForTest('');
  const out = await generateImageTool.run({ prompt: 'a mug' }, { repoDir: os.tmpdir(), signal: new AbortController().signal, addCost: () => {} } as any);
  assert.match(out, /Admin → Keys/);
  assert.doesNotMatch(out, /Providers/);
});

// ---- videoCostEstimate (pure): official per-second table × output seconds ----

test('videoCostEstimate: per-model × resolution table, case-insensitive, safe fallbacks', () => {
  const t = config.seedanceCostPerSec;
  assert.ok(close(videoCostEstimate('arksai-video-25', '480p', 8), t['arksai-video-25']['480p'] * 8));
  assert.ok(close(videoCostEstimate('arksai-video-25', '1080P', 10), t['arksai-video-25']['1080p'] * 10));
  assert.ok(close(videoCostEstimate('arksai-video-20', '720p', 5), t['arksai-video-20']['720p'] * 5));
  // No model → the 1.5 table; unknown model/resolution → the flat final rate.
  assert.ok(close(videoCostEstimate(undefined, '480p', 4), t['arksai-video-15']['480p'] * 4));
  assert.ok(close(videoCostEstimate('nope', '480p', 4), config.seedanceFinalCostPerSec * 4));
  assert.ok(close(videoCostEstimate('arksai-video-15', '8k', 4), config.seedanceFinalCostPerSec * 4));
  // Never negative / NaN.
  assert.equal(videoCostEstimate('arksai-video-25', '480p', -3), 0);
  assert.equal(videoCostEstimate('arksai-video-25', '480p', NaN), 0);
  // A draft (480p) is always cheaper than the 1080p final on the same model.
  for (const m of ['arksai-video-25', 'arksai-video-20', 'arksai-video-15']) {
    assert.ok(videoCostEstimate(m, '480p', 8) < videoCostEstimate(m, '1080p', 8), m);
  }
});

test('videoCostEstimate: a known resolution with no price row is estimated by PIXEL RATIO from the top listed tier', () => {
  const t = config.seedanceCostPerSec;
  // Synthetic model listed only to 720p: 1080p = (1080/720)² = 2.25× its 720p rate; 4K = 9×.
  t['arksai-test-model'] = { '480p': 0.01, '720p': 0.02 };
  try {
    assert.ok(close(videoCostEstimate('arksai-test-model', '1080p', 2), 0.02 * 2.25 * 2));
    assert.ok(close(videoCostEstimate('arksai-test-model', '4K', 2), 0.02 * 9 * 2));
    assert.ok(close(videoCostEstimate('arksai-test-model', '720p', 2), 0.02 * 2), 'a listed row is used as-is');
  } finally {
    delete t['arksai-test-model'];
  }
  // Video 1.5 accepts 4K but the official table lists it only to 1080p → 4× the 1080p rate, never
  // the flat fallback (which sat BELOW 1.5's own 1080p price).
  const r15 = t['arksai-video-15'];
  const expected4k = r15['4k'] ?? r15['1080p'] * 4;
  assert.ok(close(videoCostEstimate('arksai-video-15', '4k', 5), expected4k * 5));
  assert.ok(videoCostEstimate('arksai-video-15', '4k', 5) > videoCostEstimate('arksai-video-15', '1080p', 5));
  // A model WITH an official 4K row keeps it.
  assert.ok(close(videoCostEstimate('arksai-video-20', '4k', 5), t['arksai-video-20']['4k'] * 5));
});

// ---- generate_video end to end (stubbed provider) ----

interface Run {
  out: string;
  costs: number[];
  posts: any[];
  repo: string;
}

/** Run generate_video against a stubbed ModelArk. `reject(apiModel, body)` → an error body to refuse it. */
async function runTool(
  args: Record<string, unknown>,
  reject?: (apiModel: string, body: any) => { code: string; message: string } | null,
  setup?: (repo: string) => void,
): Promise<Run> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-video-'));
  setup?.(repo);
  const posts: any[] = [];
  const costs: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url);
    if (init.method === 'POST' && u.endsWith('/contents/generations/tasks')) {
      const body = JSON.parse(init.body);
      posts.push(body);
      const err = reject?.(body.model, body);
      if (err) return new Response(JSON.stringify({ error: err }), { status: 404 });
      return new Response(JSON.stringify({ id: `cgt-${posts.length}` }), { status: 200 });
    }
    if (/\/contents\/generations\/tasks\/cgt-/.test(u)) {
      return new Response(JSON.stringify({ status: 'succeeded', content: { video_url: 'https://cdn.example/out.mp4' } }), { status: 200 });
    }
    if (u === 'https://cdn.example/out.mp4') return new Response(Buffer.alloc(20_000, 1), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  }) as any;
  __setByteplusKeyForTest('ark-test');
  __resetVideoAvailabilityForTest();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const ctx = { repoDir: repo, signal: new AbortController().signal, addCost: (u: number) => costs.push(u) } as any;
    let settled = false;
    const p = generateVideoTool.run(args, ctx).finally(() => {
      settled = true;
    });
    for (let i = 0; i < 200 && !settled; i++) {
      await new Promise((r) => setImmediate(r));
      mock.timers.tick(5000); // the poll loop's 5 s wait
    }
    return { out: await p, costs, posts, repo };
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
    __resetVideoAvailabilityForTest();
  }
}

test('generate_video: available only while the ModelArk key is configured', () => {
  __setByteplusKeyForTest('');
  assert.equal(generateVideoTool.available?.(), false);
  __setByteplusKeyForTest('ark-test');
  try {
    assert.equal(generateVideoTool.available?.(), true);
  } finally {
    __setByteplusKeyForTest('');
  }
});

test('generate_video: default = a 480p DRAFT on Video 2.5 itself (no native draft flag), billed at 2.5 × 480p', async () => {
  const r = await runTool({ prompt: 'a slow push-in on a ceramic mug, morning light, soft cafe ambience' });
  try {
    assert.equal(r.posts.length, 1);
    const body = r.posts[0];
    assert.equal(body.model, VIDEO_MODELS['arksai-video-25'].api, 'same model as the final — only smaller');
    assert.equal(body.draft, undefined, '2.x has no draft mode (the API rejects it)');
    assert.match(body.content[0].text, /--resolution 480p/);
    assert.match(body.content[0].text, /--duration 8\b/);
    assert.equal(body.generate_audio, true);
    assert.deepEqual(r.costs.length, 1);
    assert.ok(close(r.costs[0], videoCostEstimate('arksai-video-25', '480p', 8)));
    assert.match(r.out, /^Draft video ready: videos\/video-\d+-draft\.mp4 \(ArksAI Video 2\.5, 8s 480p/);
    assert.match(r.out, /final:true, the same prompt and model:"video-2\.5"/, 'the hand-off pins the model that rendered');
    const files = fs.readdirSync(path.join(r.repo, 'videos'));
    assert.equal(files.length, 1);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: a 1.5 draft uses its NATIVE draft mode (still 480p), billed at the 1.5 draft rate', async () => {
  const r = await runTool({ prompt: 'a paper boat drifting down a rain gutter, macro', model: 'video-1.5', duration: 6 });
  try {
    const body = r.posts[0];
    assert.equal(body.model, VIDEO_MODELS['arksai-video-15'].api);
    assert.equal(body.draft, true);
    assert.match(body.content[0].text, /--resolution 480p --duration 6/);
    assert.ok(close(r.costs[0], videoCostEstimate('arksai-video-15', '480p', 6)));
    assert.match(r.out, /ArksAI Video 1\.5, 6s 480p/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: final:true renders the requested resolution, audio off honoured, cost follows it', async () => {
  const r = await runTool({ prompt: 'drone orbit over a lighthouse at dusk', final: true, resolution: '720p', duration: 10, audio: false });
  try {
    const body = r.posts[0];
    assert.equal(body.model, VIDEO_MODELS['arksai-video-25'].api);
    assert.equal(body.draft, undefined);
    assert.equal(body.generate_audio, false);
    assert.match(body.content[0].text, /--resolution 720p --duration 10/);
    assert.ok(close(r.costs[0], videoCostEstimate('arksai-video-25', '720p', 10)));
    assert.match(r.out, /^Final video ready: videos\/video-\d+\.mp4 \(ArksAI Video 2\.5, 10s 720p/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: 2.5 not activated → rendered on 2.0, and BILLED + labelled as 2.0 (built.model, not the ask)', async () => {
  const r = await runTool({ prompt: 'a fox crossing fresh snow, static wide shot', final: true, duration: 6 }, (api) =>
    api === VIDEO_MODELS['arksai-video-25'].api ? { code: 'ModelNotOpen', message: 'Your account has not activated the model' } : null,
  );
  try {
    assert.deepEqual(
      r.posts.map((b) => b.model),
      [VIDEO_MODELS['arksai-video-25'].api, VIDEO_MODELS['arksai-video-20'].api],
    );
    assert.equal(r.costs.length, 1, 'the refused 2.5 attempt is never billed');
    assert.ok(close(r.costs[0], videoCostEstimate('arksai-video-20', '1080p', 6)));
    assert.ok(!close(r.costs[0], videoCostEstimate('arksai-video-25', '1080p', 6)));
    assert.match(r.out, /ArksAI Video 2\.0, 6s 1080p/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: a provider refusal is a plain error string with nothing billed', async () => {
  const r = await runTool({ prompt: 'a city skyline timelapse', model: 'video-2.0' }, () => ({ code: 'InvalidParameter', message: 'duration out of range' }));
  try {
    assert.equal(r.posts.length, 1, 'a non-activation error does not hop models');
    assert.deepEqual(r.costs, []);
    assert.match(r.out, /^Error: video generation failed — video task rejected — duration out of range/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: an empty prompt is rejected before any provider call', async () => {
  const r = await runTool({ prompt: '   ' });
  try {
    assert.equal(r.posts.length, 0);
    assert.match(r.out, /^Error: describe the shot/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

// ---- draft → final hand-off pins the model that ACTUALLY rendered (V6) ----

test('generate_video: a draft that fell back 2.5 → 2.0 tells the agent to finalize with model:"video-2.0"', async () => {
  const r = await runTool({ prompt: 'a heron lifting off a misty lake, static wide shot' }, (api) =>
    api === VIDEO_MODELS['arksai-video-25'].api ? { code: 'ModelNotOpen', message: 'Your account has not activated the model' } : null,
  );
  try {
    assert.match(r.out, /ArksAI Video 2\.0, 8s 480p/);
    assert.match(r.out, /model:"video-2\.0"/);
    assert.doesNotMatch(r.out, /same prompt and model\)/, 'never the ambiguous "same model" wording');
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

// ---- 4K finals route to 2.0 (2.5 isn't listed at 4K) — V3 ----

test('generate_video: a 4K final on auto renders + bills on Video 2.0 at 4K', async () => {
  const r = await runTool({ prompt: 'aerial over terraced rice fields at dawn', final: true, resolution: '4k', duration: 5 });
  try {
    assert.deepEqual(r.posts.map((b) => b.model), [VIDEO_MODELS['arksai-video-20'].api]);
    assert.match(r.posts[0].content[0].text, /--resolution 4k/);
    assert.ok(close(r.costs[0], videoCostEstimate('arksai-video-20', '4k', 5)));
    assert.match(r.out, /ArksAI Video 2\.0, 5s 4k/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

// ---- real-person fallback honesty (V1) ----

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const putImages = (...names: string[]) => (repo: string) => {
  fs.mkdirSync(path.join(repo, 'uploads'), { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(repo, 'uploads', n), PNG);
};
const REAL_PERSON = { code: 'InputImageSensitiveContentDetected', message: 'The request failed because the input image may contain real person.' };
/** 2.x declines any spec carrying an image; 1.5 accepts. */
const declineOn2x = (api: string, body: any) =>
  api !== VIDEO_MODELS['arksai-video-15'].api && body.content.some((c: any) => c.type === 'image_url') ? REAL_PERSON : null;

test('generate_video: a lone person photo as a reference → animated as the first frame on 1.5, likeness claim TRUE', async () => {
  const r = await runTool({ prompt: 'she smiles and waves at the camera', model: 'video-2.0', reference_images: ['uploads/me.png'] }, declineOn2x, putImages('me.png'));
  try {
    assert.equal(r.posts.length, 2);
    assert.equal(r.posts[1].model, VIDEO_MODELS['arksai-video-15'].api);
    assert.deepEqual(r.posts[1].content.filter((c: any) => c.type === 'image_url').map((c: any) => c.role), ['first_frame']);
    assert.match(r.out, /exact likeness preserved/);
    assert.match(r.out, /model:"video-1\.5"/);
    assert.equal(r.costs.length, 1);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: several references, no start frame → reroute is REPORTED (which image), never claims likeness', async () => {
  const r = await runTool(
    { prompt: 'the founder holds the jar up to the light', reference_images: ['uploads/jar.png', 'uploads/founder.png'] },
    declineOn2x,
    putImages('jar.png', 'founder.png'),
  );
  try {
    assert.equal(r.posts[r.posts.length - 1].model, VIDEO_MODELS['arksai-video-15'].api);
    assert.doesNotMatch(r.out, /exact likeness preserved/);
    assert.match(r.out, /animating your first reference image as the opening frame/);
    assert.match(r.out, /the other 1 image\(s\) could not be used/);
    assert.match(r.out, /may NOT appear/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: start frame + a person reference → NO silent reroute; plain error, nothing billed', async () => {
  const r = await runTool(
    { prompt: 'the presenter walks into the showroom', first_frame_image: 'uploads/showroom.png', reference_images: ['uploads/presenter.png'] },
    declineOn2x,
    putImages('showroom.png', 'presenter.png'),
  );
  try {
    assert.ok(r.posts.every((b) => b.model !== VIDEO_MODELS['arksai-video-15'].api), 'never rerouted to 1.5');
    assert.deepEqual(r.costs, []);
    assert.match(r.out, /^Error: video generation failed — video task rejected — .*real person/);
    assert.match(r.out, /a start frame \(first_frame_image\) is also set/);
    assert.match(r.out, /Tell the user plainly/);
    assert.doesNotMatch(r.out, /likeness preserved/);
    assert.ok(!fs.existsSync(path.join(r.repo, 'videos')) || !fs.readdirSync(path.join(r.repo, 'videos')).some((f) => f.endsWith('.mp4')));
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

test('generate_video: a 4K final on video-1.5 renders on 1.5 and bills the pixel-ratio estimate (4× its 1080p rate)', async () => {
  const r = await runTool({ prompt: 'aerial over terraced rice fields at dawn', final: true, model: 'video-1.5', resolution: '4k', duration: 5 });
  try {
    assert.deepEqual(r.posts.map((b) => b.model), [VIDEO_MODELS['arksai-video-15'].api]);
    assert.match(r.posts[0].content[0].text, /--resolution 4k/);
    assert.ok(close(r.costs[0], videoCostEstimate('arksai-video-15', '4k', 5)));
    assert.ok(r.costs[0] > config.seedanceFinalCostPerSec * 5, 'never the flat fallback');
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

// ---- the real-person draft names the EXACT finalize call that succeeds (A1) ----

/** 2.x declines every image; 1.5 accepts a real person ONLY as the first frame (reference / end
 *  frame roles are declined there too) — the verified provider policy. */
const strictRealPerson = (api: string, body: any) => {
  const roles = body.content.filter((c: any) => c.type === 'image_url').map((c: any) => c.role);
  if (!roles.length) return null;
  if (api !== VIDEO_MODELS['arksai-video-15'].api) return REAL_PERSON;
  return roles.some((x: string) => x !== 'first_frame') ? REAL_PERSON : null;
};
/** Parse the finalize instruction out of a draft result into tool args. */
const finalizeArgs = (out: string): Record<string, unknown> => {
  const model = /model:"([^"]+)"/.exec(out)?.[1];
  const first = /first_frame_image:"([^"]+)"/.exec(out)?.[1];
  return { final: true, model, ...(first ? { first_frame_image: first } : {}) };
};

for (const c of [
  { label: 'a lone person photo as reference', args: { reference_images: ['uploads/me.png'] }, files: ['me.png'], animated: 'uploads/me.png' },
  { label: 'an end frame only', args: { last_frame_image: 'uploads/me.png' }, files: ['me.png'], animated: 'uploads/me.png' },
  { label: 'several references', args: { reference_images: ['uploads/jar.png', 'uploads/founder.png'] }, files: ['jar.png', 'founder.png'], animated: 'uploads/jar.png' },
]) {
  test(`generate_video: real-person reroute (${c.label}) → the draft names first_frame_image:"${c.animated}" on video-1.5, and that call renders first time`, async () => {
    const prompt = 'she smiles and waves at the camera';
    const draft = await runTool({ prompt, model: 'video-2.0', ...c.args }, strictRealPerson, putImages(...c.files));
    let fin: Run | undefined;
    try {
      assert.match(draft.out, /^Draft video ready/);
      assert.ok(draft.out.includes(`model:"video-1.5" and first_frame_image:"${c.animated}"`), draft.out);
      assert.match(draft.out, /NO reference_images or last_frame_image/);
      assert.doesNotMatch(draft.out, /the same prompt and model:"video-1\.5" \(the model that rendered/, 'never the bare "repeat the same call" wording');
      // Following the instruction succeeds on the FIRST post: 1.5, the photo as the only image, first_frame.
      fin = await runTool({ prompt, ...finalizeArgs(draft.out) }, strictRealPerson, putImages(...c.files));
      assert.match(fin.out, /^Final video ready/);
      assert.equal(fin.posts.length, 1, 'no declined round-trip');
      assert.equal(fin.posts[0].model, VIDEO_MODELS['arksai-video-15'].api);
      assert.deepEqual(fin.posts[0].content.filter((x: any) => x.type === 'image_url').map((x: any) => x.role), ['first_frame']);
    } finally {
      fs.rmSync(draft.repo, { recursive: true, force: true });
      if (fin) fs.rmSync(fin.repo, { recursive: true, force: true });
    }
  });
}

test('generate_video: a draft WITHOUT a reroute keeps the plain pin (no first_frame_image is invented)', async () => {
  const r = await runTool({ prompt: 'a heron lifting off a misty lake, static wide shot', model: 'video-1.5' });
  try {
    assert.match(r.out, /the same prompt and model:"video-1\.5" \(the model that rendered this draft\)/);
    assert.doesNotMatch(r.out, /first_frame_image:"/);
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});

// ---- the draft spells out the WHOLE finalize call — nothing that shaped it is dropped (V4) ----

/** The FINALIZE CALL line of a draft result, parsed into tool args. */
const finalizeCallArgs = (out: string): Record<string, unknown> => {
  const m = /^FINALIZE CALL \(only after the user approves\): generate_video (\{.*\})$/m.exec(out);
  assert.ok(m, `the draft spells out the finalize call: ${out}`);
  return JSON.parse(m![1]);
};
const images = (body: any) => body.content.filter((c: any) => c.type === 'image_url').map((c: any) => [c.role, c.image_url.url]);

test('generate_video: replaying the draft\'s FINALIZE CALL renders the final with the same ratio, duration, dialogue and first frame', async () => {
  const prompt = 'the baker turns to camera and smiles, warm bakery light';
  const draft = await runTool(
    { prompt, aspect_ratio: '9:16', duration: 6, dialogue: 'Fresh bread, every single morning.', first_frame_image: 'uploads/start.png' },
    undefined,
    putImages('start.png'),
  );
  let fin: Run | undefined;
  try {
    const args = finalizeCallArgs(draft.out);
    assert.equal(args.final, true);
    assert.equal(args.prompt, prompt);
    fin = await runTool(args, undefined, putImages('start.png'));
    assert.match(fin.out, /^Final video ready/);
    const [d, f] = [draft.posts[0], fin.posts[0]];
    assert.equal(f.model, d.model, 'the model that rendered the draft');
    assert.match(f.content[0].text, /--ratio 9:16 --resolution 1080p --duration 6$/);
    assert.ok(f.content[0].text.includes('says "Fresh bread, every single morning."'), f.content[0].text);
    assert.equal(f.content[0].text.replace(/--resolution \S+/, ''), d.content[0].text.replace(/--resolution \S+/, ''), 'the same compiled shot');
    assert.deepEqual(images(f), images(d));
    assert.deepEqual(images(f).map((x: string[]) => x[0]), ['first_frame']);
    assert.equal(f.generate_audio, true);
  } finally {
    fs.rmSync(draft.repo, { recursive: true, force: true });
    if (fin) fs.rmSync(fin.repo, { recursive: true, force: true });
  }
});

test('generate_video: a draft with NO duration and its replayed final send the identical compiled shot (default 8s)', async () => {
  const prompt = 'a heron lifting off a misty lake';
  const draft = await runTool({ prompt }, undefined, putImages());
  let fin: Run | undefined;
  try {
    fin = await runTool(finalizeCallArgs(draft.out), undefined, putImages());
    assert.match(fin.out, /^Final video ready/);
    const strip = (t: string) => t.replace(/--resolution \S+/, '');
    assert.equal(strip(fin.posts[0].content[0].text), strip(draft.posts[0].content[0].text), 'the user pays for exactly the approved shot');
    assert.match(draft.posts[0].content[0].text, /--duration 8$/);
  } finally {
    fs.rmSync(draft.repo, { recursive: true, force: true });
    if (fin) fs.rmSync(fin.repo, { recursive: true, force: true });
  }
});

test('generate_video: the FINALIZE CALL keeps audio:false, the end frame, every reference, the clamped duration and the FITTED dialogue', async () => {
  const s1 = 'Say hi to Mr. Khan, who has baked bread on this corner for thirty years.';
  const s2 = 'Every loaf is shaped by hand before the sun comes up.';
  const s3 = 'Come early, because the sourdough is usually gone by nine in the morning.';
  const draft = await runTool(
    {
      prompt: 'a mascot loaf hops onto the counter',
      model: 'video-2.0',
      duration: 40,
      audio: false,
      dialogue: `${s1} ${s2} ${s3}`,
      last_frame_image: 'uploads/end.png',
      reference_images: ['uploads/mascot.png', 'uploads/style.png'],
    },
    undefined,
    putImages('end.png', 'mascot.png', 'style.png'),
  );
  let fin: Run | undefined;
  try {
    const args = finalizeCallArgs(draft.out);
    assert.equal(args.duration, 15, 'the BUILT duration (clamped to 2.0), not the ask');
    assert.equal(args.audio, false);
    assert.equal(args.dialogue, `${s1} ${s2}`, 'the fitted line the draft voiced');
    assert.deepEqual(args.reference_images, ['uploads/mascot.png', 'uploads/style.png']);
    assert.equal(args.last_frame_image, 'uploads/end.png');
    assert.equal(args.first_frame_image, undefined, 'no start frame is invented');
    fin = await runTool(args, undefined, putImages('end.png', 'mascot.png', 'style.png'));
    const [d, f] = [draft.posts[0], fin.posts[0]];
    assert.equal(f.model, VIDEO_MODELS['arksai-video-20'].api);
    assert.equal(f.generate_audio, false);
    assert.match(f.content[0].text, /--ratio 16:9 --resolution 1080p --duration 15$/);
    assert.deepEqual(images(f), images(d));
    assert.deepEqual(images(f).map((x: string[]) => x[0]), ['last_frame', 'reference_image', 'reference_image']);
    assert.doesNotMatch(fin.out, /trimmed/, 'the fitted line fits — no second trim');
  } finally {
    fs.rmSync(draft.repo, { recursive: true, force: true });
    if (fin) fs.rmSync(fin.repo, { recursive: true, force: true });
  }
});

test('generate_video: a real-person draft\'s FINALIZE CALL carries the reroute override (1.5, photo as first frame, no references)', async () => {
  const draft = await runTool(
    { prompt: 'she smiles and waves at the camera', model: 'video-2.0', aspect_ratio: '9:16', reference_images: ['uploads/me.png'] },
    strictRealPerson,
    putImages('me.png'),
  );
  try {
    const args = finalizeCallArgs(draft.out);
    assert.equal(args.model, 'video-1.5');
    assert.equal(args.first_frame_image, 'uploads/me.png');
    assert.equal(args.reference_images, undefined);
    assert.equal(args.last_frame_image, undefined);
    assert.equal(args.aspect_ratio, '9:16');
  } finally {
    fs.rmSync(draft.repo, { recursive: true, force: true });
  }
});

// ---- product-ad mode voices the FITTED line, in ONE audio direction (V5) ----

test('videoPromptFor: product-ad dialogue is fitted BEFORE the brief — one voice direction, the over-cap tail never reaches Seedance', () => {
  const s1 = 'Say hi to Mr. Khan, who has baked bread on this corner for thirty years.';
  const s2 = 'Every loaf is shaped by hand before the sun comes up.';
  const s3 = 'Come early, because the sourdough is usually gone by nine in the morning.';
  const ad = { productName: 'Khan Sourdough', categoryId: 'food', durationS: 8 };
  const r = videoPromptFor({ prompt: 'a crusty loaf', dialogue: `${s1} ${s2} ${s3}`, ad });
  assert.equal(r.spoken?.trimmed, true);
  assert.equal(r.spoken?.text, `${s1} ${s2}`);
  assert.equal((r.compiled.match(/says/g) || []).length, 1, r.compiled);
  assert.ok(r.compiled.includes(`a warm voiceover says: "${s1} ${s2}"`), r.compiled);
  assert.ok(!r.compiled.includes('sourdough is usually gone'), 'the trimmed sentence is never voiced');
  assert.equal((r.compiled.match(/Audio:/g) || []).length, 1, 'exactly one audio direction');
  // Outside product mode the compiler quotes the fitted line, once.
  const plain = videoPromptFor({ prompt: 'a baker at dawn', dialogue: `${s1} ${s2} ${s3}` });
  assert.ok(plain.compiled.includes(`a clear voice says "${s1} ${s2}"`));
  assert.equal((plain.compiled.match(/Audio:/g) || []).length, 1);
  assert.ok(r.spoken!.text.length <= DIALOGUE_MAX_CHARS);
  // No dialogue → the brief's own audio direction stands alone.
  const silent = videoPromptFor({ prompt: 'a crusty loaf', ad });
  assert.equal(silent.spoken, null);
  assert.equal((silent.compiled.match(/Audio:/g) || []).length, 1);
  assert.doesNotMatch(silent.compiled, /says/);
});

test('generate_video: product-ad mode builds its prompt only through videoPromptFor (no raw tagline path)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/tools/media.ts'), 'utf8');
  assert.equal((src.match(/productAdBrief\(/g) || []).length, 1, 'productAdBrief is called once — inside videoPromptFor');
  assert.match(src, /videoPromptFor\(\{ prompt, dialogue: args\.dialogue, [^}]*ad: adBrief \}\)/);
  assert.doesNotMatch(src, /tagline: args\.dialogue/);
});

// ---- over-long dialogue is trimmed at a boundary and the agent is TOLD (A2) ----

test('generate_video: dialogue past one clip is trimmed at a sentence boundary and the result says so', async () => {
  const s1 = 'Say hi to Mr. Khan, who has baked bread on this corner for thirty years.';
  const s2 = 'Every loaf is shaped by hand before the sun comes up.';
  const s3 = 'Come early, because the sourdough is usually gone by nine in the morning.';
  const r = await runTool({ prompt: 'a baker dusts flour over a loaf at dawn', dialogue: `${s1} ${s2} ${s3}` });
  try {
    assert.ok(r.posts[0].content[0].text.includes(`says "${s1} ${s2}"`), 'the prompt speaks the whole sentences that fit');
    assert.ok(!r.posts[0].content[0].text.includes('sourdough'), 'the cut sentence is not voiced');
    assert.ok(r.out.includes(`trimmed to "${s1} ${s2}"`), r.out);
    assert.match(r.out, /generate_video_story/);
    const short = await runTool({ prompt: 'a baker at dawn', dialogue: 'Fresh bread, every morning.' });
    try {
      assert.doesNotMatch(short.out, /trimmed/);
    } finally {
      fs.rmSync(short.repo, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(r.repo, { recursive: true, force: true });
  }
});
