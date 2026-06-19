import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAnthropicMessages, mapAnthropicStop, anthropicSseToOpenAI, AgentRun, isTransientApiError } from '../src/agent/runner';

test('isTransientApiError: recognizes the premature-close / mid-stream drop class', () => {
  // undici wraps a mid-stream socket drop as `TypeError: terminated` with the real
  // reason on .cause — both shapes must be treated as transient (→ retry the turn).
  assert.equal(isTransientApiError(new TypeError('terminated')), true);
  assert.equal(isTransientApiError({ message: 'terminated', cause: { code: 'ERR_STREAM_PREMATURE_CLOSE' } }), true);
  assert.equal(isTransientApiError({ message: 'Premature close' }), true);
  assert.equal(isTransientApiError({ cause: { code: 'UND_ERR_SOCKET', message: 'other side closed' } }), true);
  assert.equal(isTransientApiError({ message: 'fetch failed', cause: { code: 'ECONNRESET' } }), true);
  assert.equal(isTransientApiError({ status: 503 }), true);
});

test('isTransientApiError: does NOT retry auth/bad-request or a clean stop', () => {
  assert.equal(isTransientApiError({ status: 401 }), false);
  assert.equal(isTransientApiError({ status: 400, message: 'invalid request' }), false);
  assert.equal(isTransientApiError(new Error('some unrelated logic error')), false);
});

test('toAnthropicMessages: system is hoisted, user becomes a text block', () => {
  const { system, messages } = toAnthropicMessages([
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Build a sheet.' },
  ]);
  assert.equal(system, 'You are helpful.');
  assert.deepEqual(messages, [{ role: 'user', content: [{ type: 'text', text: 'Build a sheet.' }] }]);
});

test('toAnthropicMessages: assistant tool_calls → tool_use blocks; tool results → user tool_result', () => {
  const { messages } = toAnthropicMessages([
    { role: 'user', content: 'go' },
    {
      role: 'assistant',
      content: 'On it.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'generate_spreadsheet', arguments: '{"output":"a.xlsx"}' } }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'wrote a.xlsx' },
  ]);
  const asst = messages[1];
  assert.equal(asst.role, 'assistant');
  assert.deepEqual(asst.content[0], { type: 'text', text: 'On it.' });
  assert.deepEqual(asst.content[1], { type: 'tool_use', id: 'call_1', name: 'generate_spreadsheet', input: { output: 'a.xlsx' } });
  const toolMsg = messages[2];
  assert.equal(toolMsg.role, 'user');
  assert.deepEqual(toolMsg.content[0], { type: 'tool_result', tool_use_id: 'call_1', content: 'wrote a.xlsx' });
});

test('toAnthropicMessages: consecutive tool results merge into one user message; empty assistant gets non-empty content', () => {
  const { messages } = toAnthropicMessages([
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }, { id: 'b', type: 'function', function: { name: 'y', arguments: 'not json' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'ra' },
    { role: 'tool', tool_call_id: 'b', content: 'rb' },
  ]);
  // assistant with only tool_calls: content is the two tool_use blocks (non-empty)
  assert.equal(messages[0].content.length, 2);
  assert.equal(messages[0].content[1].input && typeof messages[0].content[1].input, 'object'); // bad JSON → {}
  // both tool results land in a single following user message
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content.length, 2);
  assert.deepEqual(messages[1].content.map((b: any) => b.tool_use_id), ['a', 'b']);
});

test('mapAnthropicStop maps the cases the loop branches on', () => {
  assert.equal(mapAnthropicStop('tool_use'), 'tool_calls');
  assert.equal(mapAnthropicStop('max_tokens'), 'length');
  assert.equal(mapAnthropicStop('end_turn'), 'stop');
  assert.equal(mapAnthropicStop('stop_sequence'), 'stop');
});

// Build a fake web ReadableStream from a list of SSE text frames.
function sseStream(frames: string[]): any {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        read() {
          if (i < frames.length) return Promise.resolve({ done: false, value: enc.encode(frames[i++]) });
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

// A stream that emits ONE tool_use block, then a read that resolves `done` after `tailMs`
// (simulating M3 buffering the args) but REJECTS early if the controller aborts.
function stallingToolStream(toolName: string, ctrl: AbortController, tailMs: number): any {
  const enc = new TextEncoder();
  const frames = [`data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"c1","name":"${toolName}"}}\n\n`];
  let i = 0;
  return {
    getReader() {
      return {
        read() {
          if (i < frames.length) return Promise.resolve({ done: false, value: enc.encode(frames[i++]) });
          return new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve({ done: true, value: undefined }), tailMs);
            ctrl.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
          });
        },
      };
    },
  };
}

test('anthropicSseToOpenAI: heavy generator on the PRIMARY model shortens the deadline → stall→fallback', async () => {
  const ctrl = new AbortController();
  let threw: any;
  try {
    for await (const _ of anthropicSseToOpenAI(stallingToolStream('generate_spreadsheet', ctrl, 5000), {
      controller: ctrl,
      idleMs: 120_000, // idle backstop must NOT fire first
      stall: { tripped: false },
      isPrimary: true,
      heavyNames: new Set(['generate_spreadsheet']),
      heavyMs: 25, // tiny → trips right after the tool_use block
    })) {
      /* consume */
    }
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, 'expected a stall throw once the shortened deadline fired');
  assert.equal(threw.minimaxStall, true);
  assert.equal(ctrl.signal.aborted, true);
});

test('anthropicSseToOpenAI: heavy generator on the FAST model does NOT shorten the deadline', async () => {
  const ctrl = new AbortController();
  // isPrimary:false → no heavy timer; the stream completes normally (no premature stall).
  for await (const _ of anthropicSseToOpenAI(stallingToolStream('generate_spreadsheet', ctrl, 60), {
    controller: ctrl,
    idleMs: 120_000,
    stall: { tripped: false },
    isPrimary: false,
    heavyNames: new Set(['generate_spreadsheet']),
    heavyMs: 25,
  })) {
    /* consume */
  }
  assert.equal(ctrl.signal.aborted, false);
});

// A read that emits one frame then NEVER settles and IGNORES abort — the real "hung socket"
// undici can leave pending after a mid-stream abort. This is the operator's 9-min hang.
function deadStream(): any {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        read() {
          if (i++ === 0) return Promise.resolve({ done: false, value: enc.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n') });
          return new Promise(() => {}); // never settles; ignores abort entirely
        },
      };
    },
  };
}

test('anthropicSseToOpenAI: a hung read that ignores abort still stalls out via the race', async () => {
  const ctrl = new AbortController();
  let threw: any;
  try {
    for await (const _ of anthropicSseToOpenAI(deadStream(), {
      controller: ctrl,
      idleMs: 30, // tiny idle backstop → trips quickly once the read hangs
      stall: { tripped: false },
      isPrimary: true,
    })) {
      /* consume */
    }
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, 'expected a stall throw even though the read never rejected on abort');
  assert.equal(threw.minimaxStall, true);
});

test('anthropicSseToOpenAI: text + tool_use + usage translate to OpenAI chunks', async () => {
  const frames = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":20}}}\n\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_9","name":"generate_doc"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"output\\":"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.docx\\"}"}}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}\n\n',
    'data: {"type":"message_stop"}\n\n',
  ];
  const chunks: any[] = [];
  for await (const c of anthropicSseToOpenAI(sseStream(frames))) chunks.push(c);

  // text delta surfaced as delta.content
  assert.ok(chunks.some((c) => c.choices[0].delta.content === 'Hello'));
  // tool_use start carries id + name at its block index
  const start = chunks.find((c) => c.choices[0].delta.tool_calls?.[0]?.id === 'call_9');
  assert.equal(start.choices[0].delta.tool_calls[0].index, 1);
  assert.equal(start.choices[0].delta.tool_calls[0].function.name, 'generate_doc');
  // args stream as fragments at the same index → concatenate to valid JSON
  const args = chunks
    .flatMap((c) => c.choices[0].delta.tool_calls ?? [])
    .filter((t: any) => t.index === 1 && t.function?.arguments)
    .map((t: any) => t.function.arguments)
    .join('');
  assert.deepEqual(JSON.parse(args), { output: 'a.docx' });
  // stop_reason mapped; final usage chunk carries mapped token counts
  assert.ok(chunks.some((c) => c.choices[0].finish_reason === 'tool_calls'));
  const usage = chunks.find((c) => c.usage)?.usage;
  assert.equal(usage.completion_tokens, 42);
  assert.equal(usage.prompt_tokens, 120); // 100 input + 20 cache_read
  assert.equal(usage.prompt_cache_hit_tokens, 20);
});

// Regression for the M3 headers-hang: M3 can buffer the response HEADERS server-side for
// minutes on a big prompt, and ac.abort() does NOT reliably reject a pending undici fetch
// stuck awaiting headers — so the run hung at 0 tokens with no fallback (observed on legal/
// code-mode M3). The fix races the `await fetch` against the turn deadline. This proves a
// fetch that never returns headers stalls out (→ minimaxStall → the loop falls back) instead
// of hanging forever.
test('createMinimaxStream: a fetch that never sends headers stalls out (no infinite hang)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise(() => {})) as any; // never resolves, ignores abort
  process.env.MINIMAX_TURN_DEADLINE_MS = '150'; // 150ms so the test is fast
  process.env.MINIMAX_FAST_DEADLINE_MS = '150'; // legal now routes to the fast path → bound it too
  try {
    const run: any = new AgentRun({ id: 's', mode: 'code', task: 'legal.contract', model: 'arksai-max' } as any);
    const t0 = Date.now();
    await assert.rejects(
      () => run.createMinimaxStream({ messages: [{ role: 'user', content: 'hi' }], tools: [] }),
      (e: any) => e && e.minimaxStall === true,
      'should reject with a minimaxStall error (→ fallback), not hang',
    );
    assert.ok(Date.now() - t0 < 3000, `fell back promptly (was ${Date.now() - t0}ms), did not hang`);
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.MINIMAX_TURN_DEADLINE_MS;
    delete process.env.MINIMAX_FAST_DEADLINE_MS;
  }
});

// Live evidence settled it: M2.7-highspeed produced a complete 24k-char bilingual UAE
// contract where M3 stubbed + froze. So legal MUST route to the fast model; a non-legal
// code run stays on M3. Lock both by capturing the model actually sent on the wire.
test('legal routes to the fast model; a non-legal code run stays on M3', async () => {
  const { config } = await import('../src/config');
  const origFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = ((_url: any, opts: any) => {
    try { seen.push(JSON.parse(opts.body).model); } catch { /* ignore */ }
    return Promise.resolve(new Response('', { status: 500 })); // fail fast, don't hang
  }) as any;
  try {
    const legal: any = new AgentRun({ id: 's', mode: 'code', task: 'legal.contract', model: 'arksai-max' } as any);
    await legal.createMinimaxStream({ messages: [{ role: 'user', content: 'hi' }], tools: [] }).catch(() => {});
    const code: any = new AgentRun({ id: 's2', mode: 'code', task: 'finance.cashflow', model: 'arksai-max' } as any);
    await code.createMinimaxStream({ messages: [{ role: 'user', content: 'hi' }], tools: [] }).catch(() => {});
    assert.equal(seen[0], config.minimaxFallbackModel, 'legal → fast model (M2.7)');
    assert.notEqual(seen[1], config.minimaxFallbackModel, 'non-legal code → M3, not the fast model');
  } finally {
    globalThis.fetch = origFetch;
  }
});
