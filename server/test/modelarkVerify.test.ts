import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeBody, classifyProbe, modelarkProbeTargets } from '../src/routes/builds';
import { config } from '../src/config';
import { endpointFor } from '../src/engines/modelark';
import { VIDEO_MODELS } from '../src/engines/seedance';
import { ASR_MODEL } from '../src/robots/voice';

// ModelArk entitlement probes ("can this key actually call that model on that endpoint?").
// All pure — no network.

const coding = config.byteplusBaseUrl.replace(/\/$/, '');
const general = config.byteplusVideoBaseUrl.replace(/\/$/, '');

// ---------------------------------------------------------------- probeBody

test('probeBody chat: a REAL minimal call — 1 output token, thinking disabled', () => {
  const b: any = probeBody('chat', 'deepseek-x');
  assert.equal(b.model, 'deepseek-x');
  assert.equal(b.max_tokens, 1);
  assert.deepEqual(b.thinking, { type: 'disabled' });
  assert.ok(Array.isArray(b.messages) && b.messages.length >= 1);
  assert.equal(b.messages[0].role, 'user');
  assert.ok(String(b.messages[0].content).length > 0);
});

test('probeBody embedding: a REAL minimal call — one tiny text input', () => {
  const b: any = probeBody('embedding', 'skylark-x');
  assert.equal(b.model, 'skylark-x');
  assert.ok(Array.isArray(b.input) && b.input.length === 1);
  assert.equal(b.input[0].type, 'text');
  assert.ok(b.input[0].text.length > 0 && b.input[0].text.length < 10);
});

test('probeBody image: deliberately invalid size (rejected in validation, never generated)', () => {
  const b: any = probeBody('image', 'seedream-x');
  assert.equal(b.model, 'seedream-x');
  assert.equal(b.size, '10x10');
  assert.ok(String(b.prompt).length > 0);
});

test('probeBody video: empty content (rejected in validation, never generated)', () => {
  const b: any = probeBody('video', 'seedance-x');
  assert.equal(b.model, 'seedance-x');
  assert.deepEqual(b.content, []);
});

// ---------------------------------------------------------------- classifyProbe

const ALL_KINDS = ['chat', 'embedding', 'image', 'video'] as const;

test('classifyProbe: 2xx → ok for every kind ("served" for the real chat/embedding calls)', () => {
  const r = classifyProbe('chat', 200, { choices: [{ message: { content: 'O' } }] });
  assert.equal(r.access, 'ok');
  assert.match(r.detail, /served/);
  assert.match(classifyProbe('embedding', 200, { data: {} }).detail, /served/);
  for (const k of ['image', 'video'] as const) assert.equal(classifyProbe(k, 200, { id: 'x' }).access, 'ok');
});

test('classifyProbe: not entitled / not activated / not served → no_access, for every kind', () => {
  for (const kind of ALL_KINDS) {
    for (const [status, code] of [
      [404, 'ModelNotOpen'],
      [404, 'InvalidEndpointOrModel.NotFound'],
      [400, 'UnsupportedModel'],
      [403, 'ModelNotOpen'],
    ] as const) {
      const r = classifyProbe(kind, status, { error: { code, message: 'nope' } });
      assert.equal(r.access, 'no_access', `${kind} ${status} ${code}`);
      assert.match(r.detail, new RegExp(code.replace('.', '\\.')));
      assert.match(r.detail, /nope/);
    }
  }
});

test('classifyProbe image/video: InvalidParameter (rejected in validation) → ok — the model was found', () => {
  for (const kind of ['image', 'video'] as const) {
    const r = classifyProbe(kind, 400, { error: { code: 'InvalidParameter', message: 'size too small' } });
    assert.equal(r.access, 'ok', kind);
    assert.match(r.detail, /rejected in validation/);
    assert.match(r.detail, /size too small/);
    assert.equal(classifyProbe(kind, 400, { error: { code: 'MissingParameter' } }).access, 'ok');
    assert.equal(classifyProbe(kind, 400, null, 'HTTP 400: bad').access, 'ok', 'a code-less 400 is still a validation pass');
  }
});

test('classifyProbe chat/embedding: a REAL call that 400s is an error with the detail — never "ok"', () => {
  for (const kind of ['chat', 'embedding'] as const) {
    // e.g. the endpoint rejects the thinking flag / max_tokens the lane sends
    const r = classifyProbe(kind, 400, { error: { code: 'InvalidParameter', message: 'thinking is not supported' } });
    assert.equal(r.access, 'error', kind);
    assert.match(r.detail, /InvalidParameter/);
    assert.match(r.detail, /thinking is not supported/);
    assert.doesNotMatch(r.detail, /as intended/);
    assert.equal(classifyProbe(kind, 400, { error: { code: 'MissingParameter' } }).access, 'error');
    const bare = classifyProbe(kind, 400, null, 'HTTP 400: max_tokens out of range');
    assert.equal(bare.access, 'error', `${kind}: a code-less 400 is not access`);
    assert.match(bare.detail, /max_tokens out of range/);
  }
});

test('classifyProbe: auth / quota / billing failures → error (never mistaken for access), every kind', () => {
  for (const kind of ALL_KINDS) {
    assert.equal(classifyProbe(kind, 401, { error: { code: 'AuthenticationError', message: 'bad key' } }).access, 'error');
    assert.equal(classifyProbe(kind, 401, null, 'HTTP 401: unauthorized').access, 'error');
    assert.equal(classifyProbe(kind, 429, { error: { code: 'QuotaExceeded', message: 'quota' } }).access, 'error');
    assert.equal(classifyProbe(kind, 429, { error: { code: 'RateLimitExceeded' } }).access, 'error');
    // a 400 whose code names auth/quota/billing is NOT a validation pass
    assert.equal(classifyProbe(kind, 400, { error: { code: 'QuotaExceeded' } }).access, 'error');
    assert.equal(classifyProbe(kind, 400, { error: { code: 'AccountOverdueError' } }).access, 'error');
    assert.equal(classifyProbe(kind, 500, { error: { code: 'InternalServiceError' } }).access, 'error');
  }
});

test('classifyProbe: detail falls back to the raw text, then the status', () => {
  assert.equal(classifyProbe('image', 502, null, 'HTTP 502: bad gateway').detail, 'HTTP 502: bad gateway');
  assert.equal(classifyProbe('chat', 502, null).detail, 'HTTP 502');
});

// ---------------------------------------------------------------- modelarkProbeTargets

const targets = modelarkProbeTargets();
const find = (kind: string, model: string, base: string) =>
  targets.find((t) => t.kind === kind && t.model === model && t.base === base);

test('modelarkProbeTargets: every branded lane in config.modelarkModels is probed, named in usedBy', () => {
  for (const [id, lane] of Object.entries(config.modelarkModels)) {
    const base = (lane.base || coding).replace(/\/$/, '');
    const t = find('chat', lane.model, base);
    assert.ok(t, `lane ${id} (${lane.model}) has a chat probe`);
    assert.ok(t!.usedBy.includes(id), `${id} listed in usedBy of ${lane.model}`);
    assert.match(t!.endpoint, /\/chat\/completions$/);
  }
});

test('modelarkProbeTargets: lanes sharing one model collapse into ONE probe listing every lane', () => {
  const byModel = new Map<string, string[]>();
  for (const [id, lane] of Object.entries(config.modelarkModels)) {
    if (lane.base) continue;
    byModel.set(lane.model, [...(byModel.get(lane.model) ?? []), id]);
  }
  for (const [model, ids] of byModel) {
    const t = find('chat', model, coding)!;
    for (const id of ids) assert.ok(t.usedBy.includes(id), `${id} in ${model}'s usedBy`);
  }
});

test('modelarkProbeTargets: the vision model is probed on the endpoint endpointFor gives', () => {
  const ep = endpointFor(config.arkVisionModel);
  const base = ep === 'general' ? general : coding;
  const t = find('chat', config.arkVisionModel, base);
  assert.ok(t, 'vision probe present');
  assert.ok(t!.usedBy.includes('vision'));
  assert.ok(t!.endpoint.startsWith(`${ep} `), `endpoint label "${t!.endpoint}" names ${ep}`);
});

test('modelarkProbeTargets: Seedream + every Seedance model probe the GENERAL endpoint', () => {
  const img = find('image', config.arkImageModel, general);
  assert.ok(img, 'Seedream probed on general');
  assert.equal(img!.endpoint, 'general /images/generations');
  assert.ok(!targets.some((t) => t.kind === 'image' && t.base !== general), 'no image probe off the general endpoint');

  for (const [id, v] of Object.entries(VIDEO_MODELS)) {
    const t = find('video', v.api, general);
    assert.ok(t, `${id} (${v.api}) probed on general`);
    assert.ok(t!.usedBy.includes(id));
    assert.equal(t!.endpoint, 'general /contents/generations/tasks');
  }
  assert.ok(!targets.some((t) => t.kind === 'video' && t.base !== general), 'no video probe off the general endpoint');
});

test('modelarkProbeTargets: the embedder and the one-shot text/coder models are covered', () => {
  const emb = targets.find((t) => t.kind === 'embedding' && t.model === config.arkEmbedModel);
  assert.ok(emb && emb.usedBy.includes('embeddings'));
  const usedBy = targets.flatMap((t) => t.usedBy);
  assert.ok(usedBy.includes('one-shot text'));
  assert.ok(usedBy.includes('code / SVG authoring'));
});

test('modelarkProbeTargets: the robot voice-note ASR model is probed (chat) on the GENERAL endpoint', () => {
  assert.equal(ASR_MODEL, process.env.ROBOT_ASR_MODEL || 'seed-2-0-mini-260428');
  const t = find('chat', ASR_MODEL, general);
  assert.ok(t, 'ASR probe present');
  assert.ok(t!.usedBy.includes('voice-note transcription'));
  assert.equal(t!.endpoint, 'general /chat/completions');
});

test('modelarkProbeTargets: no duplicate (kind, model, endpoint) probes and no empty usedBy', () => {
  const keys = targets.map((t) => `${t.kind}|${t.model}|${t.base}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const t of targets) {
    assert.ok(t.model, 'model set');
    assert.ok(t.usedBy.length > 0, `${t.model} has a caller`);
    assert.equal(new Set(t.usedBy).size, t.usedBy.length, `${t.model} usedBy has no repeats`);
  }
});

// ---------------------------------------------------------------- verifyModelarkAccess (stubbed fetch)

test('verifyModelarkAccess: the probe KIND reaches the classifier — a 400 InvalidParameter is ok for image/video, an error for chat/embedding', async () => {
  const { verifyModelarkAccess } = await import('../src/routes/builds');
  const { __setByteplusKeyForTest } = await import('../src/agent/byteplusRuntime');
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  __setByteplusKeyForTest('ark-test');
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push(String(url));
    assert.equal(init.headers.Authorization, 'Bearer ark-test');
    return new Response(JSON.stringify({ error: { code: 'InvalidParameter', message: 'rejected' } }), { status: 400 });
  }) as typeof fetch;
  try {
    const results = await verifyModelarkAccess();
    assert.equal(results.length, targets.length);
    assert.equal(seen.length, targets.length, 'one request per target');
    for (const r of results) {
      const want = r.kind === 'chat' || r.kind === 'embedding' ? 'error' : 'ok';
      assert.equal(r.access, want, `${r.kind} ${r.model}: ${r.detail}`);
    }
    assert.ok(results.some((r) => r.usedBy.includes('voice-note transcription')));
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
});
