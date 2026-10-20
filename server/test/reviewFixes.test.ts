import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheSplit, Usage } from '../src/agent/usage';
import { computeCost, FAST_MODEL, SWIFT_MODEL, MAX_MODEL, HEAVY_GLM51_MODEL, HEAVY_DS4_MODEL } from '../../shared/types';

// Locks for the fixes from the post-migration adversarial review.

test('cacheSplit: ModelArk reports cache hits as prompt_tokens_details.cached_tokens — both shapes count', () => {
  assert.deepEqual(cacheSplit({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 600 } }), { hit: 600, miss: 400 });
  assert.deepEqual(cacheSplit({ prompt_tokens: 1000, prompt_cache_hit_tokens: 250 }), { hit: 250, miss: 750 });
  assert.deepEqual(cacheSplit({ prompt_tokens: 1000 }), { hit: 0, miss: 1000 });
  const u = new Usage();
  u.add({ prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 900 } });
  assert.equal(u.cacheHitTokens, 900);
  assert.equal(u.cacheMissTokens, 100);
  // Cache hits are priced at the cache-hit rate (far cheaper than a miss on DeepSeek-V4-Pro).
  const withHits = computeCost(MAX_MODEL, { cacheHit: 900, cacheMiss: 100, completion: 0 });
  const allMiss = computeCost(MAX_MODEL, { cacheHit: 0, cacheMiss: 1000, completion: 0 });
  assert.ok(withHits < allMiss / 5, 'a cached prompt costs a fraction of an uncached one');
});

test('floorModel: a user-pinned thinking-off lane is floored for builds, spreadsheets and reports', async () => {
  const { AgentRun } = await import('../src/agent/runner');
  const mk = (mode: string, model: string) => {
    const run: any = new (AgentRun as any)({ id: 's-floor', mode, model, title: 't' });
    run.setActiveModel(model);
    return run;
  };
  for (const pinned of [FAST_MODEL, SWIFT_MODEL]) {
    assert.equal(mk('report', pinned).floorModel('summarize this quarter'), MAX_MODEL, `${pinned} report → Max`);
    assert.equal(mk('code', pinned).floorModel('a simple counter app'), HEAVY_GLM51_MODEL, `${pinned} build → heavy coder`);
    assert.equal(
      mk('code', pinned).floorModel('Build a 24-month financial model spreadsheet with an Assumptions sheet and live formulas'),
      HEAVY_DS4_MODEL,
      `${pinned} spreadsheet → bounded-reasoning lane`,
    );
    assert.equal(mk('chat', pinned).floorModel('hey there'), null, `${pinned} chat stays on the quick lane`);
    // Chat makes spreadsheets directly (generate_spreadsheet) — thinking-off breaks financial models.
    assert.equal(
      mk('chat', pinned).floorModel('Make me an Excel cash flow forecast for my cafe for the next 12 months'),
      HEAVY_DS4_MODEL,
      `${pinned} chat spreadsheet → bounded-reasoning lane`,
    );
  }
  assert.equal(mk('report', MAX_MODEL).floorModel('x'), null, 'reasoning lanes are never floored');
});

test('routeModel: a pinned Swift chat asked for a spreadsheet is floored, and the line names the reason', async () => {
  const { AgentRun } = await import('../src/agent/runner');
  const lines: string[] = [];
  const run: any = new (AgentRun as any)({ id: 's-floor-chat', mode: 'chat', model: SWIFT_MODEL, title: 't' });
  run.routeModel('Build me an Excel workbook budget model for a 12-month marketing plan', (t: string) => lines.push(t));
  assert.equal(run.activeModel, HEAVY_DS4_MODEL);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^↳ Spreadsheet models use the careful-reasoning engine — switched to ArksAI Heavy/);
  // A plain chat message on the same pinned lane is left alone (no floor line).
  const run2: any = new (AgentRun as any)({ id: 's-floor-chat2', mode: 'chat', model: SWIFT_MODEL, title: 't' });
  const lines2: string[] = [];
  run2.routeModel('hey there', (t: string) => lines2.push(t));
  assert.equal(run2.activeModel, SWIFT_MODEL);
  assert.deepEqual(lines2, []);
});

test('secretValues: a retired provider key still in the env is redacted; non-secret env is not', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-retired-provider-key-0123456789';
  process.env.SOME_SERVICE_TOKEN = 'tok-abcdefghijklmnop';
  try {
    const { secretValues } = await import('../src/config');
    const v = secretValues();
    assert.ok(v.includes('sk-cp-retired-provider-key-0123456789'));
    assert.ok(v.includes('tok-abcdefghijklmnop'));
    assert.ok(!v.includes(process.env.PATH as string), 'PATH is not a secret');
    assert.equal(new Set(v).size, v.length, 'no duplicates');
  } finally {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.SOME_SERVICE_TOKEN;
  }
});

test('one-shot calls: the queue wait is bounded on its own (no unbounded wait), and a call never ran is not billed', async () => {
  const { analyzeImage } = await import('../src/engines/modelark');
  const { __setByteplusKeyForTest } = await import('../src/agent/byteplusRuntime');
  const { config } = await import('../src/config');
  const realFetch = globalThis.fetch;
  const hung: Array<() => void> = [];
  globalThis.fetch = ((_u: any, init: any) =>
    new Promise((_res, rej) => {
      hung.push(() => rej(new Error('released')));
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
    })) as any;
  const prevQueue = config.arkQueueWaitMs;
  config.arkQueueWaitMs = 400;
  process.env.ARK_VISION_TIMEOUT_MS = '5000';
  __setByteplusKeyForTest('ark-test');
  try {
    const img = 'data:image/png;base64,iVBORw0KGgo=';
    // Saturate the vision pool with calls that never answer…
    const blockers = Array.from({ length: config.arkVisionConcurrency }, () => analyzeImage(img, 'x', new AbortController().signal));
    // …then one more: it gives up after the QUEUE bound instead of waiting forever.
    const t0 = Date.now();
    const r = await analyzeImage(img, 'x', new AbortController().signal);
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /busy/);
    assert.ok(Date.now() - t0 < 2500, `gave up in ${Date.now() - t0}ms`);
    assert.equal(r.costUsd, 0, 'a call that never ran is not billed');
    hung.forEach((f) => f());
    await Promise.all(blockers);
  } finally {
    globalThis.fetch = realFetch;
    config.arkQueueWaitMs = prevQueue;
    delete process.env.ARK_VISION_TIMEOUT_MS;
    __setByteplusKeyForTest('');
  }
});

test('one-shot calls: a call that QUEUED still gets its full request deadline (tail pages of a long deck are reviewed)', async () => {
  const { analyzeImage } = await import('../src/engines/modelark');
  const { __setByteplusKeyForTest } = await import('../src/agent/byteplusRuntime');
  const { config } = await import('../src/config');
  const realFetch = globalThis.fetch;
  // Every request takes 300ms; the per-call deadline is 500ms. With N pages > pool size, later pages
  // queue for several × 300ms — under the old "queue counts against the deadline" rule they timed out.
  globalThis.fetch = ((_u: any) =>
    new Promise((res) =>
      setTimeout(() => res(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })), 300),
    )) as any;
  process.env.ARK_VISION_TIMEOUT_MS = '500';
  __setByteplusKeyForTest('ark-test');
  try {
    const img = 'data:image/png;base64,iVBORw0KGgo=';
    const pages = config.arkVisionConcurrency * 3;
    const results = await Promise.all(Array.from({ length: pages }, () => analyzeImage(img, 'review', new AbortController().signal)));
    assert.equal(results.filter((r) => r.ok).length, pages, 'every page was reviewed, none silently dropped');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ARK_VISION_TIMEOUT_MS;
    __setByteplusKeyForTest('');
  }
});

test('chat spreadsheet routing: questions and the verb "excel" stay quick; asks and follow-ups get the sheets lane', async () => {
  const { selectModel, isChatSpreadsheetAsk } = await import('../src/agent/router');
  const { AgentRun, madeSpreadsheetRecently } = await import('../src/agent/runner');
  const { __setByteplusKeyForTest } = await import('../src/agent/byteplusRuntime');
  __setByteplusKeyForTest('ark-test');
  try {
    for (const q of ['how do I excel at job interviews?', 'what is a cash flow forecast?', 'is excel better than google sheets?']) {
      assert.equal(isChatSpreadsheetAsk(q), false, q);
      assert.notEqual(selectModel(q, 'chat').model, HEAVY_DS4_MODEL, q);
    }
    assert.equal(selectModel('Make me a 24-month cash flow forecast spreadsheet for my bakery', 'chat').model, HEAVY_DS4_MODEL);

    const ctx = [
      { role: 'user', content: 'make me a budget sheet' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'generate_spreadsheet', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ];
    assert.equal(madeSpreadsheetRecently(ctx), true);
    assert.equal(madeSpreadsheetRecently([{ role: 'user', content: 'hi' }]), false);
    assert.equal(madeSpreadsheetRecently([...ctx, ...Array.from({ length: 12 }, () => ({ role: 'user', content: 'x' }))]), false, 'only RECENT turns count');

    const run: any = new (AgentRun as any)({ id: 's-sheetctx', mode: 'chat', model: SWIFT_MODEL, title: 't' });
    run.setActiveModel(SWIFT_MODEL);
    assert.equal(run.floorModel('now change the growth rate to 8%'), null, 'no spreadsheet yet → quick lane');
    run.sheetContext = true;
    assert.equal(run.floorModel('now change the growth rate to 8%'), HEAVY_DS4_MODEL, 'follow-up to a sheet → sheets lane');
    run.sheetContext = false;
    assert.equal(run.floorModel('what is a cash flow forecast?'), null, 'a question about one stays quick');
  } finally {
    __setByteplusKeyForTest('');
  }
});
