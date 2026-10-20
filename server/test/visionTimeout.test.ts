import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeImage, arkChat, visionUrlsForFile, MODELARK_MISSING } from '../src/engines/modelark';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';
import { config } from '../src/config';

// Hermetic: every test stubs globalThis.fetch (restored in finally) and toggles the ModelArk key
// in memory — no real network, no DB.

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgo=';
const sig = () => new AbortController().signal;

async function withArk<T>(fetchImpl: (url: string, init: any) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => fetchImpl(String(url), init)) as any;
  __setByteplusKeyForTest('ark-test');
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
}

// Regression: a vision call can buffer response headers for minutes, and ac.abort() does NOT
// reliably reject a pending undici fetch awaiting headers — so the verify/report gate froze.
// The ModelArk transport races every await against its deadline and DEGRADES to {ok:false}.
test('analyzeImage: a never-responding vision endpoint degrades within ARK_VISION_TIMEOUT_MS (no hang, no throw)', async () => {
  process.env.ARK_VISION_TIMEOUT_MS = '150';
  const calls: { url: string; body: any }[] = [];
  try {
    await withArk(
      (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return new Promise(() => {}); // never resolves, ignores abort
      },
      async () => {
        const t0 = Date.now();
        const r = await analyzeImage(PNG_1PX, 'Is this legible?', sig());
        const ms = Date.now() - t0;
        assert.equal(r.ok, false, 'should degrade, not succeed');
        assert.match(r.error ?? '', /timed out/);
        assert.ok(ms < 2000, `degraded promptly (was ${ms}ms), did not hang`);
      },
    );
    // The request that hung was a well-formed ModelArk vision call.
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/chat\/completions$/);
    assert.equal(calls[0].body.model, config.arkVisionModel);
    assert.deepEqual(calls[0].body.thinking, { type: 'disabled' });
    const parts = calls[0].body.messages.at(-1).content;
    assert.equal(parts[0].type, 'image_url');
    assert.equal(parts[0].image_url.url, PNG_1PX);
    assert.deepEqual(parts.at(-1), { type: 'text', text: 'Is this legible?' });
  } finally {
    delete process.env.ARK_VISION_TIMEOUT_MS;
  }
});

test('analyzeImage: a stalled body (headers arrived, text() never resolves) is also bounded', async () => {
  process.env.ARK_VISION_TIMEOUT_MS = '150';
  try {
    await withArk(
      async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) }) as any,
      async () => {
        const t0 = Date.now();
        const r = await analyzeImage(PNG_1PX, 'q', sig());
        assert.equal(r.ok, false);
        assert.match(r.error ?? '', /timed out/);
        assert.ok(Date.now() - t0 < 2000);
      },
    );
  } finally {
    delete process.env.ARK_VISION_TIMEOUT_MS;
  }
});

test('arkChat: the per-call timeoutMs bounds a hung fetch too, and the limiter slot is released', async () => {
  await withArk(
    () => new Promise(() => {}),
    async () => {
      // More hung calls than the one-shot limiter has slots: if a timed-out call leaked its
      // slot, the later ones would queue forever instead of timing out.
      const n = config.arkVisionConcurrency + 2;
      const t0 = Date.now();
      const rs = await Promise.all(Array.from({ length: n }, () => arkChat('hi', sig(), { timeoutMs: 80 })));
      for (const r of rs) {
        assert.equal(r.ok, false);
        assert.match(r.error ?? '', /timed out/);
      }
      assert.ok(Date.now() - t0 < 3000, 'all calls degraded; none stuck behind a leaked slot');
    },
  );
});

test('analyzeImage: a non-JSON 200 body (the coding-plan images quirk) is ok:false, never a throw', async () => {
  await withArk(
    async () => new Response('<html>upstream says no</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    async () => {
      const r = await analyzeImage(PNG_1PX, 'q', sig());
      assert.equal(r.ok, false);
      assert.match(r.error ?? '', /non-JSON/);
      assert.match(r.error ?? '', /HTTP 200/);
    },
  );
});

test('analyzeImage: an HTTP error keeps the status and the provider message', async () => {
  await withArk(
    async () => new Response(JSON.stringify({ error: { message: 'UnsupportedModel: not on this plan' } }), { status: 400 }),
    async () => {
      const r = await analyzeImage(PNG_1PX, 'q', sig());
      assert.equal(r.ok, false);
      assert.match(r.error ?? '', /^HTTP 400: UnsupportedModel/);
    },
  );
});

test('analyzeImage: missing key → MODELARK_MISSING without touching the network', async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called++;
    return new Response('{}');
  }) as any;
  __setByteplusKeyForTest('');
  try {
    const r = await analyzeImage(PNG_1PX, 'q', sig());
    assert.deepEqual(r, { ok: false, error: MODELARK_MISSING, costUsd: 0 }); // never billed
    const t = await arkChat('hello', sig());
    assert.deepEqual(t, { ok: false, error: MODELARK_MISSING, costUsd: 0 });
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('analyzeImage: success strips <think>, bills from usage, sends several images in ONE message', async () => {
  let body: any;
  await withArk(
    async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '<think>hmm</think>LEGIBLE: yes' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2000, completion_tokens: 100 },
        }),
        { status: 200 },
      );
    },
    async () => {
      const r = await analyzeImage([PNG_1PX, PNG_1PX], 'compare', sig());
      assert.equal(r.ok, true);
      assert.equal(r.text, 'LEGIBLE: yes');
      assert.ok((r.costUsd ?? 0) > 0);
    },
  );
  const parts = body.messages[0].content;
  assert.equal(parts.filter((p: any) => p.type === 'image_url').length, 2);
  assert.equal(body.max_tokens, 1500);
});

test('analyzeImage: an http(s) image is fetched by US (ModelArk cannot reach preview hosts); a 404 degrades', async () => {
  const urls: string[] = [];
  let chatBody: any;
  const png = Buffer.alloc(600);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  await withArk(
    async (url, init) => {
      urls.push(url);
      if (url.startsWith('http://preview.local/missing')) return new Response('nope', { status: 404 });
      if (url.startsWith('http://preview.local/')) return new Response(png, { status: 200 });
      chatBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    },
    async () => {
      const r = await analyzeImage('http://preview.local/shot.png', 'q', sig());
      assert.equal(r.ok, true);
      assert.match(chatBody.messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
      const bad = await analyzeImage('http://preview.local/missing.png', 'q', sig());
      assert.equal(bad.ok, false);
      assert.match(bad.error ?? '', /image read failed.*404/);
    },
  );
  assert.equal(urls.filter((u) => /chat\/completions/.test(u)).length, 1, 'a failed image read never reaches the model');
});

test('visionUrlsForFile: a normal image is one data URL; an unreadable tall one fails soft to the original', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-vision-'));
  // A PNG header carrying only IHDR dimensions — enough for imageDims/planTiles.
  const fakePng = (w: number, h: number) => {
    const b = Buffer.alloc(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  try {
    const square = path.join(dir, 'square.png');
    fs.writeFileSync(square, fakePng(400, 400));
    const one = await visionUrlsForFile(square);
    assert.equal(one.length, 1);
    assert.match(one[0], /^data:image\/png;base64,/);
    // Tall → wants tiles, but the bytes aren't a decodable PNG so the crop fails → the original.
    const tall = path.join(dir, 'tall.png');
    fs.writeFileSync(tall, fakePng(400, 4000));
    const soft = await visionUrlsForFile(tall);
    assert.equal(soft.length, 1);
    assert.match(soft[0], /^data:image\/png;base64,/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
