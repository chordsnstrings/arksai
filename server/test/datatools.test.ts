import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolCtx } from '../src/agent/tools/common';
import { parseDelimited, fetchDataTool } from '../src/agent/tools/data';
import { sendWebhookTool } from '../src/agent/tools/outbound';

const ctx = (): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: '/tmp',
  mode: 'code',
  signal: new AbortController().signal,
  addCost: () => {},
});

test('parseDelimited: basic comma rows', () => {
  const r = parseDelimited('a,b,c\n1,2,3\n4,5,6', ',');
  assert.deepEqual(r, [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
    ['4', '5', '6'],
  ]);
});

test('parseDelimited: quoted field with comma and escaped quote', () => {
  const r = parseDelimited('name,note\n"Smith, Jane","said ""hi"""', ',');
  assert.deepEqual(r, [
    ['name', 'note'],
    ['Smith, Jane', 'said "hi"'],
  ]);
});

test('parseDelimited: tab-delimited + drops blank rows', () => {
  const r = parseDelimited('a\tb\n\n1\t2\n', '\t');
  assert.deepEqual(r, [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('fetch_data: refuses a private/internal URL (SSRF guard)', async () => {
  const res = await fetchDataTool.run({ url: 'http://localhost:3000/secret' }, ctx());
  assert.match(res, /^Error/);
});

test('fetch_data: requires a url', async () => {
  assert.match(await fetchDataTool.run({}, ctx()), /^Error/);
});

test('send_webhook: refuses a private/internal URL (SSRF guard)', async () => {
  const res = await sendWebhookTool.run({ url: 'http://127.0.0.1/hook', message: 'hi' }, ctx());
  assert.match(res, /^Error/);
});

test('send_webhook: requires url + message', async () => {
  assert.match(await sendWebhookTool.run({ url: 'https://example.com/hook' }, ctx()), /^Error/);
});
