import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolCtx } from '../src/agent/tools/common';
import { parseDelimited, fetchDataTool } from '../src/agent/tools/data';
import { sendWebhookTool } from '../src/agent/tools/outbound';
import { fetchPublic } from '../src/lib/web';

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

// SSRF-via-redirect: a PUBLIC url that 302s to a private/metadata address must be refused
// — redirect:'follow' would have bypassed the guard that only checked the first hop.
test('fetchPublic: a redirect to a private/metadata address is blocked (every hop re-validated)', async () => {
  const realFetch = globalThis.fetch;
  // stub: the (public) origin immediately redirects to the cloud-metadata IP
  globalThis.fetch = (async () =>
    new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })) as any;
  try {
    await assert.rejects(
      // 93.184.216.34 is a public literal IP → passes the initial guard with no DNS
      fetchPublic('http://93.184.216.34/data.csv', new AbortController().signal),
      /private|reserved/i,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Edge-case data into the dependency-free CSV parser — must never throw.
test('parseDelimited: empty / single-cell / CRLF / unterminated-quote inputs degrade safely', () => {
  assert.deepEqual(parseDelimited('', ','), []); // empty → no rows
  assert.deepEqual(parseDelimited('solo', ','), [['solo']]); // single cell
  assert.deepEqual(parseDelimited('a,b\r\n1,2\r\n', ','), [['a', 'b'], ['1', '2']]); // CRLF
  // an unterminated quote must not hang or throw — it consumes to end-of-input
  assert.doesNotThrow(() => parseDelimited('name,note\n"unterminated, oops\n1,2', ','));
});
