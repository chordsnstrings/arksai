import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDesignBrief, designBriefBlock } from '../src/agent/designBrief';
import { classifyTask } from '../src/agent/taskProfile';
import { __setByteplusKeyForTest, byteplusKey } from '../src/agent/byteplusRuntime';
import { config } from '../src/config';

/** Run fn with the ModelArk key set to `key` and fetch stubbed, restoring both afterwards. */
async function withModelark<T>(key: string, fetchImpl: typeof fetch | null, fn: () => Promise<T>): Promise<T> {
  const prevKey = byteplusKey();
  const prevFetch = globalThis.fetch;
  __setByteplusKeyForTest(key);
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    __setByteplusKeyForTest(prevKey);
    globalThis.fetch = prevFetch;
  }
}

const chatReply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

test('designBriefBlock wraps a compiled brief as a FOLLOW-IT system block', () => {
  const block = designBriefBlock('CONCEPT: a calm weather card\nPALETTE: marine');
  assert.match(block, /Build brief/i);
  assert.match(block, /FOLLOW IT/);
  assert.match(block, /CONCEPT: a calm weather card/);
});

test('compileDesignBrief fails OPEN (returns null) when no ModelArk key is configured', async () => {
  let calls = 0;
  const r = await withModelark('', (async () => {
    calls++;
    throw new Error('no network in tests');
  }) as any, async () => {
    // No key → the compiler must never call out, throw or block a build.
    const profile = classifyTask('make me a weather widget', 'code');
    return compileDesignBrief('make me a weather widget', profile, new AbortController().signal);
  });
  assert.equal(r, null);
  assert.equal(calls, 0, 'no model call without a key');
});

test('compileDesignBrief (keyed) compiles the brief via a ModelArk one-shot, thinking off', { skip: !config.designBrief }, async () => {
  const seen: { url: string; body: any }[] = [];
  const brief =
    'CONCEPT: a calm, glanceable weather card\nPALETTE: marine blues with one coral accent\n' +
    'LAYOUT: a single hero temperature with a 5-day strip below';
  const r = await withModelark('ark-test', (async (url: any, init: any) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return chatReply(brief);
  }) as any, async () => {
    const profile = classifyTask('make me a weather widget', 'code');
    return compileDesignBrief('make me a weather widget', profile, new AbortController().signal);
  });
  assert.equal(r, brief);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/chat\/completions$/);
  assert.equal(seen[0].body.model, config.arkTextModel);
  assert.deepEqual(seen[0].body.thinking, { type: 'disabled' });
});

test('compileDesignBrief (keyed) fails OPEN on a provider error or a degenerate reply', async () => {
  const profile = classifyTask('make me a weather widget', 'code');
  const err = await withModelark('ark-test', (async () =>
    new Response(JSON.stringify({ error: { code: 'ServerOverloaded', message: 'busy' } }), { status: 503 })) as any, () =>
    compileDesignBrief('make me a weather widget', profile, new AbortController().signal),
  );
  assert.equal(err, null);
  const thin = await withModelark('ark-test', (async () => chatReply('ok')) as any, () =>
    compileDesignBrief('make me a weather widget', profile, new AbortController().signal),
  );
  assert.equal(thin, null, 'a reply without the labelled sections is rejected');
});
