import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImageRequest,
  cosine,
  costFromUsage,
  imageDims,
  imageErrorMessage,
  isValidImageBytes,
  planTiles,
  SEEDREAM_SIZES,
  seedreamSize,
} from '../src/engines/modelark';
import { ttsAvailable, synthesizeSpeechBuffer, TTS_UNAVAILABLE } from '../src/engines/speech';
import { Semaphore } from '../src/lib/semaphore';

const area = (s: string) => {
  const [w, h] = s.split('x').map(Number);
  return w * h;
};

test('Seedream sizes: every table entry is inside the probed limits and the cheap tier', () => {
  for (const [aspect, size] of Object.entries(SEEDREAM_SIZES)) {
    const a = area(size);
    assert.ok(a >= 921_600, `${aspect} ${size} is below the 921,600 px floor`);
    assert.ok(a <= 2_610_000, `${aspect} ${size} is above the ≤2.61 MP price tier`);
  }
  assert.equal(seedreamSize('16:9'), '2048x1152');
  assert.equal(seedreamSize(undefined), SEEDREAM_SIZES['1:1']);
});

test('seedreamSize: computes any W:H inside the limits, clamps extreme ratios, ignores junk', () => {
  for (const r of ['7:5', '2.35:1', '1:4', '10:1']) {
    const s = seedreamSize(r);
    const [w, h] = s.split('x').map(Number);
    assert.equal(w % 16, 0);
    assert.equal(h % 16, 0);
    assert.ok(area(s) >= 921_600 && area(s) <= 2_610_000, `${r} → ${s}`);
    assert.ok(w / h <= 3.05 && w / h >= 1 / 3.05, `${r} ratio not clamped`);
  }
  assert.equal(seedreamSize('portrait please'), SEEDREAM_SIZES['1:1']);
});

test('buildImageRequest: b64, no watermark, optional reference + seed', () => {
  const plain = buildImageRequest('m', 'p', { aspectRatio: '4:5' });
  assert.deepEqual(plain, { model: 'm', prompt: 'p', size: '1440x1800', response_format: 'b64_json', watermark: false });
  const withRef = buildImageRequest('m', 'p', { referenceDataUri: 'data:image/png;base64,AAA', seed: 7 });
  assert.equal(withRef.image, 'data:image/png;base64,AAA');
  assert.equal(withRef.seed, 7);
  assert.equal(buildImageRequest('m', 'p', { seed: -5 }).seed, undefined, 'out-of-range seed dropped');
});

test('imageErrorMessage: provider refusals become plain-language guidance', () => {
  assert.match(imageErrorMessage('HTTP 400: input image may contain real person'), /real person/);
  assert.match(imageErrorMessage('HTTP 400: OutputImageSensitiveContentDetected'), /content-policy/);
  assert.equal(imageErrorMessage('HTTP 500: boom'), 'HTTP 500: boom');
});

test('imageDims: PNG, JPEG and WebP headers', () => {
  const png = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(1280, 16);
  png.writeUInt32BE(7200, 20);
  assert.deepEqual(imageDims(png), { w: 1280, h: 7200 });

  // SOI, APP0 (len 16), SOF0 with h=1152 w=2048
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.alloc(14),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x80, 0x08, 0x00, 0x03]),
    Buffer.alloc(16),
  ]);
  assert.deepEqual(imageDims(jpeg), { w: 2048, h: 1152 });

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  webp.writeUIntLE(1599, 24, 3);
  webp.writeUIntLE(899, 27, 3);
  assert.deepEqual(imageDims(webp), { w: 1600, h: 900 });

  assert.equal(imageDims(Buffer.from('not an image at all, really')), null);
});

test('planTiles: short images stay whole; tall pages tile to full coverage within the cap', () => {
  assert.deepEqual(planTiles(1280, 900), [{ y: 0, h: 900 }]);
  assert.deepEqual(planTiles(1280, 2400), [{ y: 0, h: 2400 }], 'a bit taller than one tile still reads fine whole');
  const tiles = planTiles(1280, 9000, 6);
  assert.equal(tiles.length, 6);
  assert.equal(tiles[0].y, 0);
  const covered = tiles.reduce((n, t) => n + t.h, 0);
  assert.equal(covered, 9000, 'tiles cover the whole page with no gap or overlap');
  for (let i = 1; i < tiles.length; i++) assert.equal(tiles[i].y, tiles[i - 1].y + tiles[i - 1].h);
});

test('cosine: identical, opposite, orthogonal, and malformed input', () => {
  assert.equal(cosine([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 2], [1, 2, 3]), 0);
  assert.equal(cosine(null, [1]), 0);
  assert.equal(cosine([0, 0], [0, 0]), 0);
});

test('costFromUsage: official ModelArk prices incl. cache hits; unknown model → fallback', () => {
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 500_000 } };
  // Seed 2.0 Pro: 0.5M miss × $0.50 + 0.5M hit × $0.10 + 1M out × $3.00
  assert.equal(Number(costFromUsage('seed-2-0-pro-260328', usage).toFixed(4)), 3.3);
  assert.equal(Number(costFromUsage('glm-5-2-260617', { prompt_tokens: 1e6, completion_tokens: 0 }).toFixed(4)), 1.4);
  assert.equal(costFromUsage('some-unknown-model', usage, 0.01), 0.01);
  assert.equal(costFromUsage('seed-2-0-pro-260328', undefined, 0.02), 0.02);
});

test('isValidImageBytes: rejects tiny / non-image payloads', () => {
  assert.equal(isValidImageBytes(Buffer.from('<html>error</html>')), false);
  const png = Buffer.alloc(1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png);
  assert.equal(isValidImageBytes(png), true);
});

test('speech seam: no provider → unavailable, never throws, plain-language error', async () => {
  assert.equal(ttsAvailable(), false);
  const r = await synthesizeSpeechBuffer('hello', {}, new AbortController().signal);
  assert.equal(r.ok, false);
  assert.equal(r.error, TTS_UNAVAILABLE);
});

test('Semaphore: caps concurrency, FIFO hand-off, abort leaves the queue', async () => {
  const sem = new Semaphore(1);
  const r1 = await sem.acquire();
  const order: number[] = [];
  const p2 = sem.acquire().then((rel) => (order.push(2), rel));
  const ac = new AbortController();
  const p3 = sem.acquire(ac.signal).catch(() => 'aborted');
  const p4 = sem.acquire().then((rel) => (order.push(4), rel));
  ac.abort();
  assert.equal(await p3, 'aborted');
  r1();
  const r2 = await p2;
  r2();
  const r4 = await p4;
  r4();
  r4(); // idempotent
  assert.deepEqual(order, [2, 4]);
  const again = await sem.acquire(); // the slot was returned exactly once
  again();
});

import { parseToolArgs } from '../src/lib/toolArgs';

test('parseToolArgs: strict JSON, trailing-junk recovery, and honest rejection', () => {
  assert.deepEqual(parseToolArgs('{"a":1}'), { a: 1 });
  // a few stray characters after a complete object → recovered
  assert.deepEqual(parseToolArgs('{"path":"x.html","content":"<p>a } b \\" {c}</p>"}  ]]"}\n'), { path: 'x.html', content: '<p>a } b " {c}</p>' });
  // braces inside strings don't confuse the matcher
  assert.deepEqual(parseToolArgs('{"f":"=SUM(A1:A3)","s":"}{"}xx'), { f: '=SUM(A1:A3)', s: '}{' });
  // a second object after the first is NOT silently dropped
  assert.equal(parseToolArgs('{"a":1}{"b":2}'), null);
  // truncated / non-object payloads stay null
  assert.equal(parseToolArgs('{"a":1,"b":'), null);
  assert.equal(parseToolArgs('oops {"a":1}'), null);
  assert.deepEqual(parseToolArgs('[1,2]'), [1, 2]);
});

import { endpointFor } from '../src/engines/modelark';
import { config as cfg } from '../src/config';

test('endpointFor: coding-plan models stay on the plan; Seed 2.1 Turbo (not on the plan) goes general', () => {
  assert.equal(endpointFor('deepseek-v4-pro-ga-260813'), 'coding');
  assert.equal(endpointFor('glm-5-2-260617'), 'coding');
  assert.equal(endpointFor('dola-seed-2-1-turbo-260628'), cfg.arkVisionModel === 'dola-seed-2-1-turbo-260628' ? cfg.arkVisionEndpoint : 'general');
  assert.equal(endpointFor(cfg.arkVisionModel), cfg.arkVisionEndpoint);
});

import { createVideoTask, buildVideoTask, isModelUnavailable, __resetVideoAvailabilityForTest, VIDEO_MODELS } from '../src/engines/seedance';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';

test('Seedance: 2.5 not activated on the account → transparent fallback to 2.0, remembered', async () => {
  __setByteplusKeyForTest('ark-test');
  __resetVideoAvailabilityForTest();
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const model = JSON.parse(init.body).model;
    seen.push(model);
    if (model === VIDEO_MODELS['arksai-video-25'].api) {
      return new Response(JSON.stringify({ error: { code: 'ModelNotOpen', message: 'Your account has not activated the model' } }), { status: 404 });
    }
    return new Response(JSON.stringify({ id: 'cgt-1' }), { status: 200 });
  }) as any;
  try {
    const sig = new AbortController().signal;
    const a = await createVideoTask({ prompt: 'a calm sea', model: 'arksai-video-25', duration: 5 }, sig);
    assert.equal(a.built.model, 'arksai-video-20');
    assert.deepEqual(seen, [VIDEO_MODELS['arksai-video-25'].api, VIDEO_MODELS['arksai-video-20'].api]);
    seen.length = 0;
    const b = await createVideoTask({ prompt: 'a calm sea', model: 'arksai-video-25', duration: 5 }, sig);
    assert.equal(b.built.model, 'arksai-video-20');
    assert.deepEqual(seen, [VIDEO_MODELS['arksai-video-20'].api], 'the not-activated verdict is cached — no doomed call');
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
    __resetVideoAvailabilityForTest();
  }
});

test('Seedance: other rejections are NOT mistaken for "not activated"; built reports the model used', () => {
  assert.equal(isModelUnavailable('ModelNotOpen: Your account has not activated the model'), true);
  assert.equal(isModelUnavailable('InvalidParameter: duration'), false);
  assert.equal(isModelUnavailable('OutputVideoSensitiveContentDetected'), false);
  assert.equal(buildVideoTask({ prompt: 'x', model: 'nope' }).model, 'arksai-video-15');
  const d = buildVideoTask({ prompt: 'x', model: 'arksai-video-25', draft: true, resolution: '1080p' });
  assert.equal(d.resolution, '480p', 'a 2.x draft renders at 480p on the same model (never a silent 1080p final)');
  assert.equal(d.model, 'arksai-video-25');
});
