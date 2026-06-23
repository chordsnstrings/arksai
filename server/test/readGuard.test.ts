import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileTool } from '../src/agent/tools/files';
import type { ToolCtx } from '../src/agent/tools/common';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-read-'));
const ctx = (id = 's1'): ToolCtx =>
  ({ session: { id }, repoDir: ws, mode: 'code', signal: new AbortController().signal, addCost: () => {} } as any);

test('read_file: refuses to dump a large generated/lock file (directs to grep)', async () => {
  fs.writeFileSync(path.join(ws, 'package-lock.json'), JSON.stringify({ x: 'y'.repeat(30000) }));
  const res = await readFileTool.run({ path: 'package-lock.json' }, ctx());
  assert.match(res, /generated\/lock file/);
  assert.match(res, /grep/);
  assert.doesNotMatch(res, /yyyyyyy/); // didn't actually dump the content
});

test('read_file: re-read guard stops looping on the same file', async () => {
  fs.writeFileSync(path.join(ws, 'big.ts'), Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'));
  const c = ctx('loop-sess');
  let last = '';
  for (let i = 0; i < 7; i++) last = await readFileTool.run({ path: 'big.ts' }, c);
  // After several reads of the same file in a run, it refuses with guidance instead of content.
  assert.match(last, /STOP re-reading/);
  assert.match(last, /grep/);
});

test('read_file: a normal single read still returns numbered content', async () => {
  fs.writeFileSync(path.join(ws, 'app.tsx'), 'export const A = 1;\nexport const B = 2;');
  const res = await readFileTool.run({ path: 'app.tsx' }, ctx('fresh-sess'));
  assert.match(res, /1\texport const A = 1;/);
  assert.doesNotMatch(res, /STOP re-reading/);
});
