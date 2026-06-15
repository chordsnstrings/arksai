import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAnthropicMessages, mapAnthropicStop, anthropicSseToOpenAI } from '../src/agent/runner';

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
