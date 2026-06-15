import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeThinkFilter } from '../src/agent/thinkFilter';

// Feed `input` through the filter in fixed-size chunks; return concatenated visible output.
function run(input: string, chunkSize: number): string {
  const f = makeThinkFilter();
  let out = '';
  for (let i = 0; i < input.length; i += chunkSize) out += f(input.slice(i, i + chunkSize));
  out += f.flush();
  return out;
}

test('strips a <think> block, keeps the rest (any chunking)', () => {
  const s = '<think>reasoning here</think>\n\nThe answer is 42.';
  for (const cs of [1, 3, 7, 1000]) assert.equal(run(s, cs), '\n\nThe answer is 42.', `chunk=${cs}`);
});

test('passes through text with no think block', () => {
  const s = 'Built the app. Plan: 1) scaffold 2) wire data. Done.';
  for (const cs of [1, 2, 5, 1000]) assert.equal(run(s, cs), s, `chunk=${cs}`);
});

test('handles <think> tags split across chunks', () => {
  const s = 'before <think>hidden</think> after';
  for (const cs of [2, 4, 6]) assert.equal(run(s, cs), 'before  after', `chunk=${cs}`);
});

test('preserves legitimate < and partial-looking text', () => {
  const s = 'if (a < b) and x<y then <thi is not a tag';
  for (const cs of [1, 3, 1000]) assert.equal(run(s, cs), s, `chunk=${cs}`);
});

test('drops an unclosed think block', () => {
  assert.equal(run('visible <think>still thinking with no close', 4), 'visible ');
});

test('strips multiple think blocks', () => {
  const s = 'a<think>1</think>b<think>2</think>c';
  for (const cs of [1, 2, 1000]) assert.equal(run(s, cs), 'abc', `chunk=${cs}`);
});
