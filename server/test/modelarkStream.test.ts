import { test } from 'node:test';
import assert from 'node:assert/strict';

// The agent-loop stream (createModelarkStream) + its retry/escalation wrapper
// (createCompletionWithRetry) are private methods on AgentRun; they're driven here through
// `(run as any)` with globalThis.fetch stubbed — NO real network. The concurrency limiter is
// built at module load from ARK_MAX_CONCURRENCY, so it's pinned BEFORE the source is loaded
// (every src import below is dynamic for that reason). ARK_IDLE_MS is read per call.
process.env.ARK_MAX_CONCURRENCY = '2';

const load = async () => {
  const runner = await import('../src/agent/runner');
  const router = await import('../src/agent/router');
  const rt = await import('../src/agent/byteplusRuntime');
  const { config } = await import('../src/config');
  return { ...runner, ...router, ...rt, config };
};

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = (delta: any) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;

/** A 200 SSE Response whose frames arrive every `gapMs`, then [DONE]. With `endless`, that frame
 *  repeats (capped at ~200 so a regression FAILS the test instead of hanging the process). The
 *  body ignores the fetch abort signal on purpose — the deadline race must work without it. */
function sseResponse(frames: string[], opts: { gapMs?: number; endless?: string; onFrame?: () => void } = {}): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (opts.gapMs) await sleep(opts.gapMs);
      if (i < frames.length) {
        opts.onFrame?.();
        ctrl.enqueue(enc.encode(frames[i++]));
      } else if (opts.endless != null && i++ < frames.length + 200) {
        opts.onFrame?.();
        ctrl.enqueue(enc.encode(opts.endless));
      } else {
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
        ctrl.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function drain(stream: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

/** Fail (instead of hanging the suite) if `p` doesn't settle within `ms`. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${what} did not settle in ${ms}ms (hung / leaked slot)`)), ms);
    }),
  ]);
}

/** Run `fn` with fetch stubbed, the test key set, and ARK_IDLE_MS shortened; always restored. */
async function withStubs<T>(fetchStub: (url: string, opts: any) => Promise<Response>, fn: () => Promise<T>, idleMs = '150'): Promise<T> {
  const { __setByteplusKeyForTest } = await load();
  const origFetch = globalThis.fetch;
  const origIdle = process.env.ARK_IDLE_MS;
  globalThis.fetch = fetchStub as any;
  process.env.ARK_IDLE_MS = idleMs;
  __setByteplusKeyForTest('ark-test');
  try {
    return await fn();
  } finally {
    globalThis.fetch = origFetch;
    if (origIdle === undefined) delete process.env.ARK_IDLE_MS;
    else process.env.ARK_IDLE_MS = origIdle;
    __setByteplusKeyForTest('');
  }
}

async function newRun(model = 'arksai-max', id = 's-stream'): Promise<any> {
  const { AgentRun } = await load();
  const run: any = new AgentRun({ id, mode: 'code', model } as any);
  run.setActiveModel(model);
  return run;
}

const PARAMS = () => ({ messages: [{ role: 'user', content: 'hi' }], tools: [] as any[] });

test('isTransientApiError: recognizes the premature-close / mid-stream drop class', async () => {
  const { isTransientApiError } = await load();
  // undici wraps a mid-stream socket drop as `TypeError: terminated` with the real
  // reason on .cause — both shapes must be treated as transient (→ retry the turn).
  assert.equal(isTransientApiError(new TypeError('terminated')), true);
  assert.equal(isTransientApiError({ message: 'terminated', cause: { code: 'ERR_STREAM_PREMATURE_CLOSE' } }), true);
  assert.equal(isTransientApiError({ message: 'Premature close' }), true);
  assert.equal(isTransientApiError({ cause: { code: 'UND_ERR_SOCKET', message: 'other side closed' } }), true);
  assert.equal(isTransientApiError({ message: 'fetch failed', cause: { code: 'ECONNRESET' } }), true);
  assert.equal(isTransientApiError({ status: 503 }), true);
  assert.equal(isTransientApiError({ status: 429 }), true);
});

test('isTransientApiError: does NOT retry auth/bad-request or a clean stop', async () => {
  const { isTransientApiError } = await load();
  assert.equal(isTransientApiError({ status: 401 }), false);
  assert.equal(isTransientApiError({ status: 400, message: 'invalid request' }), false);
  assert.equal(isTransientApiError(new Error('some unrelated logic error')), false);
});

// Headers-hang regression: a provider can sit on the response HEADERS for minutes, and aborting
// doesn't reliably reject a pending undici fetch — so the `await fetch` is raced against the
// content deadline. A fetch that never resolves (and ignores abort) must stall out, not hang.
test('createModelarkStream: a fetch that never returns headers stalls out with llmStall (no infinite hang)', async () => {
  await withStubs(
    () => new Promise<Response>(() => {}), // never resolves, ignores the abort signal
    async () => {
      const run = await newRun();
      const t0 = Date.now();
      await assert.rejects(
        () => within(run.createModelarkStream(PARAMS()), 3000, 'headers-hang stream'),
        (e: any) => e?.llmStall === true && /before responding/.test(e.message),
        'should reject with an llmStall error (→ the engine ladder), not hang',
      );
      assert.ok(Date.now() - t0 < 2000, `stalled out promptly (was ${Date.now() - t0}ms)`);
    },
  );
});

// A stream that keeps sending BYTES but no content — ': ping' comments and empty-delta chunks —
// is exactly a starved/stuck turn. Keepalives must not re-arm the content deadline.
test('createModelarkStream: a keepalive-only SSE stream trips the idle stall even though bytes keep arriving', async () => {
  let frames = 0;
  const keepalive = ': ping\n\n' + frame({}) + frame({ content: '' });
  await withStubs(
    async () => sseResponse([], { gapMs: 15, endless: keepalive, onFrame: () => frames++ }),
    async () => {
      const run = await newRun();
      const stream = await run.createModelarkStream(PARAMS());
      const t0 = Date.now();
      await assert.rejects(
        () => within(drain(stream), 3000, 'keepalive-only stream'),
        (e: any) => e?.llmStall === true && /mid-stream/.test(e.message),
      );
      assert.ok(frames >= 5, `keepalive bytes kept arriving inside the idle window (${frames} frames) yet it still tripped`);
      assert.ok(Date.now() - t0 < 2000, 'tripped near the idle deadline, not later');
    },
  );
});

test('createModelarkStream: content followed by only keepalives still trips (content does not grant immunity)', async () => {
  await withStubs(
    async () => sseResponse([frame({ content: 'Starting…' })], { gapMs: 15, endless: ': ping\n\n' + frame({}) }),
    async () => {
      const run = await newRun();
      const stream = await run.createModelarkStream(PARAMS());
      const seen: string[] = [];
      await assert.rejects(
        () =>
          within(
            (async () => {
              for await (const c of stream) if (c.choices?.[0]?.delta?.content) seen.push(c.choices[0].delta.content);
            })(),
            3000,
            'content-then-keepalive stream',
          ),
        (e: any) => e?.llmStall === true,
      );
      assert.deepEqual(seen, ['Starting…'], 'the real content was delivered before the stall');
    },
  );
});

// A body that delivers headers then never yields another byte (and ignores abort): every
// reader.read() is raced against the deadline, so it can't park the loop forever.
test('createModelarkStream: a hung body read that ignores abort still stalls out via the race', async () => {
  await withStubs(
    async () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}) }), { status: 200 }),
    async () => {
      const run = await newRun();
      const stream = await run.createModelarkStream(PARAMS());
      await assert.rejects(() => within(drain(stream), 3000, 'hung-read stream'), (e: any) => e?.llmStall === true);
    },
  );
});

// Healthy-but-slow generation: each content / reasoning / tool-call delta arrives under the idle
// window, the total runs well past it — it must NOT be cut off.
test('createModelarkStream: content, reasoning and tool-call deltas trickling under the idle window do NOT trip', async () => {
  const frames = [
    frame({ reasoning_content: 'think ' }),
    frame({ content: 'a' }),
    ': ping\n\n',
    frame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '' } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }),
    frame({ reasoning_content: 'more' }),
    frame({ content: 'b' }),
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
  ];
  await withStubs(
    async () => sseResponse(frames, { gapMs: 60 }), // 9 frames × 60ms ≈ 540ms total > 150ms idle
    async () => {
      const run = await newRun();
      const t0 = Date.now();
      const chunks = await within(drain(await run.createModelarkStream(PARAMS())), 4000, 'trickling stream');
      assert.ok(Date.now() - t0 > 300, 'the turn ran well past the idle window');
      const deltas = chunks.map((c) => c.choices?.[0]?.delta ?? {});
      assert.equal(deltas.map((d) => d.content ?? '').join(''), 'ab');
      assert.equal(deltas.map((d) => d.reasoning_content ?? '').join(''), 'think more');
      const args = deltas.flatMap((d) => d.tool_calls ?? []).map((t: any) => t.function?.arguments ?? '').join('');
      assert.deepEqual(JSON.parse(args), { path: 'a.txt' });
      assert.ok(chunks.some((c) => c.choices?.[0]?.finish_reason === 'tool_calls'));
      assert.equal(chunks.find((c) => c.usage)?.usage.total_tokens, 15, 'the usage chunk is passed through');
    },
  );
});

test('createModelarkStream: request carries the lane model, auth, tools and the lane reasoning controls', async () => {
  const { config, resolveProvider } = await load();
  const calls: { url: string; headers: any; body: any }[] = [];
  await withStubs(
    async (url, opts) => {
      calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
      return sseResponse([frame({ content: 'ok' })]);
    },
    async () => {
      const tools = [{ type: 'function', function: { name: 'x', parameters: { type: 'object', properties: {} } } }];
      // Flash: thinking disabled, no effort.
      const flash = await newRun('arksai-flash');
      await drain(await flash.createModelarkStream({ messages: [{ role: 'user', content: 'hi' }], tools }));
      // GLM alternate: bounded effort, no explicit thinking.
      const glm = await newRun('arksai-heavy-glm');
      await drain(await glm.createModelarkStream(PARAMS()));
      // thinking disabled + an effort set → reasoning_effort must be OMITTED.
      const off = await newRun('arksai-max');
      off.activeThinking = 'disabled';
      off.activeEffort = 'high';
      await drain(await off.createModelarkStream(PARAMS()));
      // thinking enabled + effort → both sent.
      const on = await newRun('arksai-max');
      on.activeThinking = 'enabled';
      on.activeEffort = 'medium';
      await drain(await on.createModelarkStream(PARAMS()));
    },
  );
  assert.equal(calls.length, 4);
  const [flash, glm, off, on] = calls;

  const flashLane = resolveProvider('arksai-flash');
  assert.equal(flash.url, `${flashLane.baseUrl || config.byteplusBaseUrl}/chat/completions`);
  assert.equal(flash.headers.Authorization, 'Bearer ark-test');
  assert.equal(flash.body.model, flashLane.apiModel);
  assert.equal(flash.body.stream, true);
  assert.deepEqual(flash.body.stream_options, { include_usage: true });
  assert.ok(flash.body.max_tokens > 0);
  assert.equal(flash.body.tools.length, 1);
  assert.equal(flash.body.tool_choice, 'auto');
  assert.deepEqual(flash.body.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in flash.body, false);

  const glmLane = resolveProvider('arksai-heavy-glm');
  assert.equal(glm.body.model, glmLane.apiModel);
  if (glmLane.effort) assert.equal(glm.body.reasoning_effort, glmLane.effort);
  if (!glmLane.thinking) assert.equal('thinking' in glm.body, false);
  assert.equal('tools' in glm.body, false, 'no tools → no tools/tool_choice keys');
  assert.equal('tool_choice' in glm.body, false);

  assert.deepEqual(off.body.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in off.body, false, 'reasoning_effort is omitted when thinking is disabled');

  assert.deepEqual(on.body.thinking, { type: 'enabled' });
  assert.equal(on.body.reasoning_effort, 'medium');
});

test('createModelarkStream: an override model gets ITS endpoint and never inherits the lane thinking/effort', async () => {
  const { config } = await load();
  const calls: { url: string; body: any }[] = [];
  await withStubs(
    async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return sseResponse([frame({ content: 'ok' })]);
    },
    async () => {
      // A GLM lane (effort low) asked to run a review on the general-endpoint vision model.
      const glm = await newRun('arksai-heavy-glm');
      await drain(await glm.createModelarkStream({ ...PARAMS(), model: config.arkVisionModel }));
      // Same lane, override = a coding-plan model.
      await drain(await glm.createModelarkStream({ ...PARAMS(), model: 'seed-2-0-pro-260328' }));
    },
  );
  const [vision, coder] = calls;
  assert.equal(vision.body.model, config.arkVisionModel);
  if (config.arkVisionEndpoint === 'general') assert.equal(vision.url, `${config.byteplusVideoBaseUrl.replace(/\/$/, '')}/chat/completions`);
  assert.equal('reasoning_effort' in vision.body, false, 'lane effort does not leak onto an override');
  assert.equal('thinking' in vision.body, false);
  assert.equal(coder.url, `${config.byteplusBaseUrl.replace(/\/$/, '')}/chat/completions`);
  assert.equal('reasoning_effort' in coder.body, false);
});

// ARK_MAX_CONCURRENCY is pinned to 2 for this file. Run far more streams than that SEQUENTIALLY
// through every exit path — fully consumed, abandoned early, non-ok response, headers stall,
// mid-stream stall — and each must free its slot, or a later acquire blocks forever.
test('createModelarkStream: the concurrency slot is released on every exit path (no leak)', async () => {
  const { config } = await load();
  assert.equal(config.arkMaxConcurrency, 2, 'test pins ARK_MAX_CONCURRENCY=2 before load');
  const kinds = ['ok', 'early', 'non-ok', 'headers-stall', 'mid-stall', 'ok', 'non-ok', 'early', 'ok'] as const;
  let kind: (typeof kinds)[number] = 'ok';
  await withStubs(
    async () => {
      if (kind === 'non-ok') return new Response('{"error":"boom"}', { status: 500 });
      if (kind === 'headers-stall') return new Promise<Response>(() => {});
      if (kind === 'mid-stall') return sseResponse([], { gapMs: 15, endless: ': ping\n\n' });
      return sseResponse([frame({ content: 'a' }), frame({ content: 'b' })]);
    },
    async () => {
      const run = await newRun();
      for (const k of kinds) {
        kind = k;
        const attempt = (async () => {
          const s = await run.createModelarkStream(PARAMS());
          if (k === 'early') {
            for await (const _ of s) break; // consumer abandons the stream after one chunk
          } else {
            await drain(s);
          }
        })();
        if (k === 'ok' || k === 'early') await within(attempt, 2000, `${k} stream`);
        else await assert.rejects(() => within(attempt, 2000, `${k} stream`), (e: any) => !/did not settle/.test(e.message));
      }
      // Two concurrent streams still fit after all of the above → nothing leaked.
      kind = 'ok';
      const both = await within(Promise.all([run.createModelarkStream(PARAMS()), run.createModelarkStream(PARAMS())]), 2000, 'two concurrent acquires');
      await Promise.all(both.map((s: any) => drain(s)));
    },
  );
});

test('createModelarkStream: an HTTP 429 error carries .status=429 (→ retryable)', async () => {
  const { isTransientApiError } = await load();
  await withStubs(
    async () => new Response('{"error":{"code":"RateLimitExceeded"}}', { status: 429 }),
    async () => {
      const run = await newRun();
      await assert.rejects(
        () => run.createModelarkStream(PARAMS()),
        (e: any) => e.status === 429 && /429/.test(e.message) && /RateLimitExceeded/.test(e.message) && isTransientApiError(e) && !e.llmStall,
      );
    },
  );
});

test('createCompletionWithRetry: a 429 is retried on the SAME model (no escalation)', async () => {
  const models: string[] = [];
  await withStubs(
    async (_url, opts) => {
      models.push(JSON.parse(opts.body).model);
      if (models.length === 1) return new Response('slow down', { status: 429 });
      return sseResponse([frame({ content: 'recovered' })]);
    },
    async () => {
      const run = await newRun('arksai-max');
      const startModel = run.activeModel;
      const chunks = await within(drain(await run.createCompletionWithRetry(PARAMS())), 6000, 'retry after 429');
      assert.equal(chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join(''), 'recovered');
      assert.equal(models.length, 2, 'one retry after the 429');
      assert.equal(models[0], models[1], 'a rate limit is retried on the same model');
      assert.equal(run.activeModel, startModel, 'no engine switch on a transient error');
    },
  );
});

test('createCompletionWithRetry: a 400 is NOT retried on the same model — it escalates once to a different model (stallLadder)', async () => {
  const { stallLadder, resolveProvider } = await load();
  const bodies: any[] = [];
  await withStubs(
    async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      if (bodies.length === 1) return new Response('{"error":{"code":"InvalidParameter"}}', { status: 400 });
      return sseResponse([frame({ content: 'ok' })]);
    },
    async () => {
      const run = await newRun('arksai-max');
      const alt = stallLadder('arksai-max')[0];
      assert.ok(alt, 'the ladder has an alternate engine');
      const params = {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'prev', reasoning_content: 'model-specific reasoning' },
        ],
        tools: [],
      };
      const t0 = Date.now();
      await drain(await run.createCompletionWithRetry(params));
      assert.ok(Date.now() - t0 < 1500, 'escalation is immediate (no backoff sleep on a hard 4xx)');
      assert.equal(bodies.length, 2);
      assert.notEqual(bodies[1].model, bodies[0].model, 'the second attempt runs a DIFFERENT model');
      assert.equal(bodies[1].model, resolveProvider(alt).apiModel);
      assert.equal(run.activeModel, alt);
      assert.equal('reasoning_content' in bodies[1].messages[1], false, 'model-specific reasoning dropped before switching');
    },
  );
});

test('createCompletionWithRetry: a 400 on the escalated model too gives up after exactly one switch (status kept)', async () => {
  const models: string[] = [];
  await withStubs(
    async (_url, opts) => {
      models.push(JSON.parse(opts.body).model);
      return new Response('bad request', { status: 400 });
    },
    async () => {
      const run = await newRun('arksai-max');
      await assert.rejects(() => within(run.createCompletionWithRetry(PARAMS()), 3000, 'double 400'), (e: any) => e.status === 400);
      assert.equal(models.length, 2, 'original + one escalation, no retries of a 4xx');
      assert.notEqual(models[0], models[1]);
    },
  );
});

test('createCompletionWithRetry: a silent stall bubbles straight to the run loop (no retry, no switch here)', async () => {
  let calls = 0;
  await withStubs(
    () => {
      calls++;
      return new Promise<Response>(() => {});
    },
    async () => {
      const run = await newRun('arksai-max');
      const startModel = run.activeModel;
      await assert.rejects(() => within(run.createCompletionWithRetry(PARAMS()), 3000, 'stall'), (e: any) => e?.llmStall === true);
      assert.equal(calls, 1, 'the engine stall ladder lives in the run loop, not in the retry wrapper');
      assert.equal(run.activeModel, startModel);
    },
  );
});

test('runner auto-continues silent mid-work deaths (source lock — the loop is not unit-hostable)', () => {
  // Live bug class (3 occurrences): the model announces its next action ("Now retake
  // scene 2:") or returns an empty 'stop' turn, then ends with no tool call — the run
  // finished "done" mid-task. The fix injects the human "Continue:" nudge automatically,
  // bounded by EMPTY_RETRY_LIMIT, at the calls.length === 0 decision point.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/runner.ts'), 'utf8');
  assert.ok(src.includes('SILENT MID-WORK DEATH'), 'the auto-continue branch exists');
  assert.match(src, /announcedThenStopped = \/:\\s\*\$\/\.test\(trimmed\)/, 'colon-terminated announcements detected');
  assert.ok(src.includes('Turn ended mid-work — auto-continuing'), 'user-visible system line');
  assert.ok(src.includes('CALL THE TOOL now — do not re-plan'), 'the nudge tells it to act, not restart');
  // The nudge must run BEFORE the natural-completion break so it actually preempts it.
  assert.ok(src.indexOf('SILENT MID-WORK DEATH') < src.indexOf("stopReason = 'natural'; // task done"), 'nudge preempts natural completion');
});

test('createModelarkStream: an explicit params.model (e.g. CODE_REVIEW_MODEL) overrides the lane model', async () => {
  await load();
  const bodies: any[] = [];
  await withStubs(
    async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return sseResponse([frame({ content: 'ok' })]);
    },
    async () => {
      const run = await newRun('arksai-max');
      await drain(await run.createModelarkStream({ ...PARAMS(), model: 'glm-5-2-260617' }));
      await drain(await run.createModelarkStream(PARAMS()));
    },
  );
  assert.equal(bodies[0].model, 'glm-5-2-260617', 'the override is sent');
  assert.equal(bodies[1].model, (await load()).resolveProvider('arksai-max').apiModel, 'no override → the lane model');
});

test('createModelarkStream: a returned stream nobody iterates still frees its slot after the idle window', async () => {
  const { config } = await load();
  await withStubs(
    async () => sseResponse([], { endless: ': ping\n\n' }),
    async () => {
      const run = await newRun('arksai-max');
      // Take every slot with streams that are returned but never consumed.
      for (let i = 0; i < config.arkMaxConcurrency; i++) await run.createModelarkStream(PARAMS());
      await sleep(400); // > ARK_IDLE_MS (150): each idle timer must release its own slot
      // If any slot leaked, this acquire would queue forever.
      const s = await within(run.createModelarkStream(PARAMS()), 1500, 'acquire after un-iterated streams');
      await drain(s).catch(() => {});
    },
  );
});

test('createCompletionWithRetry: with model passed THE WAY THE RUN LOOP DOES, a 4xx still reaches the alternate engine', async () => {
  const { stallLadder, resolveProvider } = await load();
  const bodies: any[] = [];
  await withStubs(
    async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      if (bodies.length === 1) return new Response('{"error":{"code":"ModelNotOpen"}}', { status: 404 });
      return sseResponse([frame({ content: 'ok' })]);
    },
    async () => {
      const run = await newRun('arksai-max');
      const alt = stallLadder('arksai-max')[0];
      // The run loop passes `model: this.activeApiModel` explicitly (runner.ts main loop).
      await drain(await run.createCompletionWithRetry({ ...PARAMS(), model: run.activeApiModel }));
      assert.equal(bodies.length, 2);
      assert.equal(bodies[1].model, resolveProvider(alt).apiModel, 'the retry is sent to the NEW engine, not the one that failed');
      assert.equal(bodies[1].reasoning_effort, resolveProvider(alt).effort, 'and carries the new lane settings coherently');
    },
  );
});

test('createCompletionWithRetry: an explicit override model is never rewritten, and a side call (escalate:false) never switches the build engine', async () => {
  const { stallLadder } = await load();
  const bodies: any[] = [];
  await withStubs(
    async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return new Response('{"error":{"code":"InvalidParameter"}}', { status: 400 });
    },
    async () => {
      const run = await newRun('arksai-max');
      const before = run.activeModel;
      await assert.rejects(run.createCompletionWithRetry({ ...PARAMS(), model: 'glm-5-2-260617' }, { escalate: false }));
      assert.equal(bodies.length, 1, 'no retry, no switch for a side call');
      assert.equal(run.activeModel, before, "the build's engine is untouched");
      assert.ok(stallLadder(before).length > 0);
    },
  );
});

// --- code-review billing + the engine stall ladder (post-migration review fixes) ---

const usageFrame = (u: any) => `data: ${JSON.stringify({ choices: [], usage: u })}\n\n`;
const REVIEW_USAGE = { prompt_tokens: 10_000, completion_tokens: 2_000, prompt_tokens_details: { cached_tokens: 4_000 } };

/** A session workspace with an uncommitted diff (so reviewDiff actually calls the model), under a
 *  throwaway data dir. Returns a restore fn. */
async function reviewWorkspace(sessionId: string): Promise<() => void> {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const { config } = await load();
  const { repoDir } = await import('../src/sessions/workspace');
  const prevData = config.dataDir;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-review-'));
  config.dataDir = tmp;
  const dir = repoDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const add = (a, b) => a + b;\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const add = (a, b) => a - b; // changed the operator\n');
  return () => {
    config.dataDir = prevData;
    fs.rmSync(tmp, { recursive: true, force: true });
  };
}

test('reviewDiff: real usage is billed ONCE — the flat estimate is only a fallback for a usage-less stream', async () => {
  const { config } = await load();
  const { computeCost } = await import('../../shared/types');
  const restore = await reviewWorkspace('s-review-bill');
  const prevOverride = config.codeReviewModel;
  config.codeReviewModel = '';
  try {
    let withUsage = true;
    await withStubs(
      async () => sseResponse([frame({ content: '{"verdict":"approve","findings":[]}' }), ...(withUsage ? [usageFrame(REVIEW_USAGE)] : [])]),
      async () => {
        const run = await newRun('arksai-max', 's-review-bill');
        await run.reviewDiff();
        assert.equal(run.engineCostUsd, 0, 'no flat charge on top of the metered usage');
        // The default reviewer (the active lane's model) is priced exactly as before: the lane rate.
        const expected = computeCost('arksai-max', { cacheHit: 4_000, cacheMiss: 6_000, completion: 2_000 });
        assert.ok(Math.abs(run.accruedCostUsd - expected) < 1e-12, `${run.accruedCostUsd} vs ${expected}`);
        assert.equal(run.usage.promptTokens, 10_000);

        withUsage = false;
        const run2 = await newRun('arksai-max', 's-review-bill');
        await run2.reviewDiff();
        assert.equal(run2.accruedCostUsd, 0);
        assert.equal(run2.engineCostUsd, config.arkCodeReviewCost, 'no usage reported → the flat estimate');
      },
    );
  } finally {
    config.codeReviewModel = prevOverride;
    restore();
  }
});

test('reviewDiff: a CODE_REVIEW_MODEL override is priced at the REVIEWER model rate, not the build lane', async () => {
  const { config, resolveProvider } = await load();
  const { costFromUsage } = await import('../src/engines/modelark');
  const { computeCost } = await import('../../shared/types');
  const restore = await reviewWorkspace('s-review-price');
  const prevOverride = config.codeReviewModel;
  const reviewer = 'glm-5-2-260617';
  config.codeReviewModel = reviewer;
  const bodies: any[] = [];
  try {
    await withStubs(
      async (_url, opts) => {
        bodies.push(JSON.parse(opts.body));
        return sseResponse([frame({ content: '{"verdict":"approve","findings":[]}' }), usageFrame(REVIEW_USAGE)]);
      },
      async () => {
        const run = await newRun('arksai-max', 's-review-price');
        assert.notEqual(resolveProvider('arksai-max').apiModel, reviewer, 'the override really is a different model');
        await run.reviewDiff();
        assert.equal(bodies[0].model, reviewer);
        const expected = costFromUsage(reviewer, REVIEW_USAGE);
        const laneRate = computeCost('arksai-max', { cacheHit: 4_000, cacheMiss: 6_000, completion: 2_000 });
        assert.ok(Math.abs(expected - laneRate) > 1e-6, 'the two rates genuinely differ (the test can tell them apart)');
        assert.ok(Math.abs(run.accruedCostUsd - expected) < 1e-12, `${run.accruedCostUsd} vs reviewer-rate ${expected}`);
        // Token counters still see every token.
        assert.equal(run.usage.promptTokens, 10_000);
        assert.equal(run.usage.completionTokens, 2_000);
        assert.equal(run.usage.cacheHitTokens, 4_000);
      },
    );
  } finally {
    config.codeReviewModel = prevOverride;
    restore();
  }
});

test('stall ladder: within ONE bad patch it retries → switches engine → retries → switches → gives up', async () => {
  const { stallLadder } = await load();
  const run = await newRun('arksai-max', 's-ladder');
  const ctx = [{ role: 'assistant', content: 'x', reasoning_content: 'model-specific' }];
  const m0 = run.activeModel;
  assert.equal(run.stallStep(ctx), 'retry');
  assert.equal(run.activeModel, m0, 'first stall retries the same engine');
  assert.equal(run.stallStep(ctx), 'switch');
  const m1 = stallLadder(m0)[0];
  assert.equal(run.activeModel, m1, 'second stall switches to a different engine');
  assert.ok(!('reasoning_content' in ctx[0]), 'reasoning is dropped before switching engines');
  assert.equal(run.stallStep(ctx), 'retry');
  assert.equal(run.stallStep(ctx), 'switch');
  assert.equal(run.activeModel, stallLadder(m1)[0], 'fourth stall moves to a third engine');
  assert.equal(run.stallStep(ctx), 'give-up', 'five consecutive stalls = genuinely stuck');
});

test('stall ladder: a COMPLETED turn resets the count — recovered stalls spread over a long run never kill it', () => {
  // The run loop is not unit-hostable (source lock, like the auto-continue lock above): the reset
  // must sit right after the turn's stream drains, INSIDE the try (a stalled stream never reaches it).
  const fs = require('node:fs');
  const path = require('node:path');
  const src: string = fs.readFileSync(path.join(__dirname, '../src/agent/runner.ts'), 'utf8');
  const drain = src.indexOf('for await (const chunk of stream) {\n          const choice = chunk.choices?.[0];');
  const reset = src.indexOf('this.llmStalls = 0;');
  const handler = src.indexOf('const step = this.stallStep(context);');
  assert.ok(drain > 0 && handler > 0, 'the run loop stream + stall handler exist');
  assert.ok(reset > drain && reset < handler, 'llmStalls is reset after the stream completes, before the stall handler');
  assert.ok(!src.slice(reset, handler).includes('for await'), 'the reset belongs to THIS turn (no other stream in between)');
  assert.ok(src.slice(reset, handler).includes('} catch (err: any) {'), 'the reset is inside the try, so a stall skips it');
});
