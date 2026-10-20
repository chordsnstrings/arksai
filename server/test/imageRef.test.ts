import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  buildImageRequest,
  generateImage,
  imageErrorMessage,
  isValidImageBytes,
  MODELARK_MISSING,
  seedreamSize,
  SEEDREAM_SIZES,
} from '../src/engines/modelark';
import { generateImageTool } from '../src/agent/tools/media';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';
import { config } from '../src/config';

// Reference-image (image-to-image) handling on Seedream: the reference rides in the `image`
// field as a data URI (ModelArk's equivalent of MiniMax's old `subject_reference`), and a
// provider refusal of a real-person reference comes back as plain-language guidance.

const DATA_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';

/** A real, decodable RGB PNG (noise pixels so it stays above the 512-byte validity floor). */
function makePng(w = 32, h = 32): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  let seed = 7;
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    for (let x = 0; x < w * 3; x++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      raw[y * (1 + w * 3) + 1 + x] = (seed >>> 16) & 0xff; // high LCG bits — incompressible noise
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG = makePng();

type Call = { url: string; init: any; body: any };

/** Stub fetch for the duration of `fn`, with the ModelArk key set; always restored. */
async function withArk<T>(handler: (url: string, body: any) => Response | Promise<Response>, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), init, body });
    return handler(String(url), body);
  }) as any;
  __setByteplusKeyForTest('ark-test');
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
}

const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arks-imgref-'));
const sig = () => new AbortController().signal;

// ---------------------------------------------------------------- pure request builder

test('fixture sanity: the PNG fixture is a valid image', () => {
  assert.equal(isValidImageBytes(PNG), true);
});

test('buildImageRequest: WITHOUT a reference → no `image` key (plain text-to-image)', () => {
  const body = buildImageRequest('seedream', 'a calm seaside scene', { aspectRatio: '16:9' });
  assert.ok(!('image' in body), '`image` must be omitted when no reference is given');
  assert.ok(!('subject_reference' in body), 'no MiniMax-era field may leak into a Seedream request');
});

test('buildImageRequest: WITH a data-URI reference → `image` carries the data URI verbatim', () => {
  const body = buildImageRequest('seedream', 'the same product on a beach', { aspectRatio: '1:1', referenceDataUri: DATA_URI });
  assert.equal(body.image, DATA_URI);
  assert.equal(typeof body.image, 'string', 'one reference, as a plain string (not a MiniMax-style array)');
});

test('buildImageRequest: model + prompt carried; size from seedreamSize; b64_json; no watermark', () => {
  const body = buildImageRequest('seedream', 'a red bicycle', { aspectRatio: '4:3' });
  assert.equal(body.model, 'seedream');
  assert.equal(body.prompt, 'a red bicycle');
  assert.equal(body.size, seedreamSize('4:3'));
  assert.equal(body.size, SEEDREAM_SIZES['4:3']);
  assert.equal(body.response_format, 'b64_json');
  assert.equal(body.watermark, false);
  assert.ok(!('aspect_ratio' in body) && !('n' in body), 'Seedream takes a pixel size, one image per call');
});

test('buildImageRequest: aspect defaults to the 1:1 size; seed only when a valid integer', () => {
  assert.equal(buildImageRequest('m', 'x', {}).size, SEEDREAM_SIZES['1:1']);
  assert.equal(buildImageRequest('m', 'x', { seed: 42 }).seed, 42);
  assert.equal(buildImageRequest('m', 'x', { seed: -1 }).seed, -1);
  assert.ok(!('seed' in buildImageRequest('m', 'x', { seed: 1.5 })));
  assert.ok(!('seed' in buildImageRequest('m', 'x', { seed: -2 })));
});

// ---------------------------------------------------------------- refusal messaging

test('imageErrorMessage: a real-person reference refusal → describe-the-person guidance', () => {
  const msg = imageErrorMessage('HTTP 400: The request failed because the input image may contain real person');
  assert.match(msg, /won't use a photo of a real person as a reference/);
  assert.match(msg, /describe the person instead/);
  assert.match(imageErrorMessage('HTTP 400: portrait rights violation'), /real person/);
  assert.match(imageErrorMessage('likeness of a public figure'), /real person/);
});

test('imageErrorMessage: content-policy refusals → rephrase guidance; anything else passes through', () => {
  assert.match(imageErrorMessage('HTTP 400: InputTextSensitiveContentDetected'), /content-policy grounds/);
  assert.equal(imageErrorMessage('HTTP 503: upstream busy'), 'HTTP 503: upstream busy');
});

// ---------------------------------------------------------------- generateImage (stubbed fetch)

test('generateImage: a reference file is sent as a data URI in `image`; the b64 result is saved', async () => {
  const dir = tmpDir();
  try {
    const ref = path.join(dir, 'uploads', 'product.jpg'); // misleading extension: mime comes from the BYTES
    fs.mkdirSync(path.dirname(ref), { recursive: true });
    fs.writeFileSync(ref, PNG);
    const r = await withArk(
      () => json({ data: [{ b64_json: PNG.toString('base64') }] }),
      async (calls) => {
        const res = await generateImage('the same bottle on marble', { aspectRatio: '4:5', subjectReference: ref }, dir, sig());
        assert.equal(calls.length, 1);
        const c = calls[0];
        assert.equal(c.url, `${config.byteplusVideoBaseUrl.replace(/\/$/, '')}/images/generations`, 'images go to the general endpoint');
        assert.equal(c.init.method, 'POST');
        assert.equal(c.init.headers.Authorization, 'Bearer ark-test');
        assert.equal(c.body.model, config.arkImageModel);
        assert.equal(c.body.prompt, 'the same bottle on marble');
        assert.equal(c.body.size, seedreamSize('4:5'));
        assert.equal(c.body.response_format, 'b64_json');
        assert.equal(c.body.watermark, false);
        assert.equal(c.body.image, `data:image/png;base64,${PNG.toString('base64')}`);
        return res;
      },
    );
    assert.equal(r.ok, true, r.error);
    assert.equal(r.files.length, 1);
    assert.match(r.files[0].path, /^images\/image-\d+-1\.png$/);
    assert.equal(r.files[0].kind, 'image');
    assert.deepEqual(fs.readFileSync(path.join(dir, r.files[0].path)), PNG, 'the decoded bytes land on disk unchanged');
    assert.equal(r.costUsd, config.arkImageCost);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateImage: without a reference the request has NO `image` field', async () => {
  const dir = tmpDir();
  try {
    await withArk(
      () => json({ data: [{ b64_json: PNG.toString('base64') }] }),
      async (calls) => {
        const r = await generateImage('a lighthouse at dusk', {}, dir, sig());
        assert.equal(r.ok, true, r.error);
        assert.ok(!('image' in calls[0].body));
        assert.equal(calls[0].body.size, SEEDREAM_SIZES['1:1']);
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateImage: an unreadable reference path fails fast with NO provider call', async () => {
  const dir = tmpDir();
  try {
    await withArk(
      () => json({ data: [{ b64_json: PNG.toString('base64') }] }),
      async (calls) => {
        const r = await generateImage('x', { subjectReference: path.join(dir, 'nope.png') }, dir, sig());
        assert.equal(r.ok, false);
        assert.match(r.error ?? '', /couldn't read the reference image/);
        assert.equal(calls.length, 0, 'never bill a call that cannot carry its reference');
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateImage: a real-person reference refusal surfaces the plain-language message, nothing saved', async () => {
  const dir = tmpDir();
  try {
    const ref = path.join(dir, 'face.png');
    fs.writeFileSync(ref, PNG);
    const r = await withArk(
      () => json({ error: { code: 'InputImageSensitiveContentDetected', message: 'The request failed because the input image may contain real person.' } }, 400),
      () => generateImage('the same person on a beach', { subjectReference: ref }, dir, sig()),
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, imageErrorMessage('real person'));
    assert.equal(r.costUsd, 0, 'a refused call costs nothing');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'images')), [], 'no file written on refusal');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateImage: an empty / non-image payload is rejected, never saved as a broken file', async () => {
  const dir = tmpDir();
  try {
    const r = await withArk(
      () => json({ data: [{ b64_json: Buffer.from('<html>error</html>').toString('base64') }] }),
      () => generateImage('x', {}, dir, sig()),
    );
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /empty or unreadable/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'images')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateImage: a URL-only response item is downloaded and validated', async () => {
  const dir = tmpDir();
  try {
    const r = await withArk(
      (url) => (url.startsWith('https://cdn.example/') ? new Response(PNG, { status: 200 }) : json({ data: [{ url: 'https://cdn.example/out.png' }] })),
      async (calls) => {
        const res = await generateImage('x', {}, dir, sig());
        assert.deepEqual(calls.map((c) => c.url.split('/').pop()), ['generations', 'out.png']);
        return res;
      },
    );
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(fs.readFileSync(path.join(dir, r.files[0].path)), PNG);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateImage: n is clamped to [1,4], one call per variant, each saved under its own name', async () => {
  const dir = tmpDir();
  try {
    await withArk(
      () => json({ data: [{ b64_json: PNG.toString('base64') }] }),
      async (calls) => {
        const r = await generateImage('x', { n: 9 }, dir, sig());
        assert.equal(calls.length, 4);
        assert.equal(r.files.length, 4);
        assert.equal(new Set(r.files.map((f) => f.path)).size, 4);
        assert.equal(r.costUsd, 4 * config.arkImageCost);
        calls.length = 0;
        await generateImage('x', { n: 0 }, dir, sig());
        assert.equal(calls.length, 1);
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateImage: no key → the configuration message, no provider call', async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called++;
    return json({});
  }) as any;
  __setByteplusKeyForTest('');
  try {
    const r = await generateImage('x', {}, os.tmpdir(), sig());
    assert.equal(r.ok, false);
    assert.equal(r.error, MODELARK_MISSING);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------- generate_image tool (reference_image)

function toolCtx(repoDir: string) {
  const spent: number[] = [];
  return { ctx: { repoDir, signal: sig(), addCost: (c: number) => spent.push(c) } as any, spent };
}

test('generate_image tool: reference_image resolves in the workspace and rides as the data URI', async () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, 'uploads'));
    fs.writeFileSync(path.join(dir, 'uploads', 'mascot.png'), PNG);
    const { ctx, spent } = toolCtx(dir);
    const out = await withArk(
      () => json({ data: [{ b64_json: PNG.toString('base64') }] }),
      async (calls) => {
        const res = await generateImageTool.run({ prompt: 'the mascot waving', reference_image: 'uploads/mascot.png', aspect_ratio: '9:16' }, ctx);
        assert.equal(calls[0].body.image, `data:image/png;base64,${PNG.toString('base64')}`);
        assert.equal(calls[0].body.size, seedreamSize('9:16'));
        assert.match(calls[0].body.prompt, /^the mascot waving\. absolutely no text/, 'text-free by default');
        return res;
      },
    );
    assert.match(String(out), /^Generated 1 image\(s\): images\/image-\d+-1\.png/);
    assert.deepEqual(spent, [config.arkImageCost]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generate_image tool: a missing reference_image is an actionable error, no provider call', async () => {
  const dir = tmpDir();
  try {
    const { ctx } = toolCtx(dir);
    await withArk(
      () => json({}),
      async (calls) => {
        const out = await generateImageTool.run({ prompt: 'x', reference_image: 'uploads/missing.png' }, ctx);
        assert.match(String(out), /wasn't found in the workspace/);
        assert.equal(calls.length, 0);
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generate_image tool: a real-person refusal tells the agent to drop the reference and describe the person', async () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'me.png'), PNG);
    const { ctx, spent } = toolCtx(dir);
    const out = await withArk(
      () => json({ error: { message: 'input image may contain real person' } }, 400),
      () => generateImageTool.run({ prompt: 'me as an astronaut', reference_image: 'me.png' }, ctx),
    );
    assert.match(String(out), /^Error: image generation failed — the image service won't use a photo of a real person/);
    assert.match(String(out), /Do NOT retry with this reference photo — regenerate WITHOUT reference_image/);
    assert.deepEqual(spent, [0], 'a refused call adds no spend');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
