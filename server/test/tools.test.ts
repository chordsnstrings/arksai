import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInWorkspace, ToolError } from '../src/agent/tools/common';
import { planModeViolation } from '../src/agent/tools/bash';
import { truncateMiddle } from '../src/lib/exec';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-test-'));
fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
fs.writeFileSync(path.join(ws, 'src', 'a.ts'), 'hello');

test('resolveInWorkspace allows paths inside the workspace', () => {
  assert.equal(resolveInWorkspace(ws, 'src/a.ts'), fs.realpathSync(path.join(ws, 'src', 'a.ts')));
  assert.ok(resolveInWorkspace(ws, 'new/dir/file.txt').startsWith(fs.realpathSync(ws)));
});

test('resolveInWorkspace blocks .. traversal', () => {
  assert.throws(() => resolveInWorkspace(ws, '../../etc/passwd'), ToolError);
  assert.throws(() => resolveInWorkspace(ws, '/etc/passwd'), ToolError);
});

test('resolveInWorkspace blocks symlink escape', () => {
  const link = path.join(ws, 'escape');
  fs.symlinkSync('/etc', link);
  assert.throws(() => resolveInWorkspace(ws, 'escape/passwd'), ToolError);
});

test('plan mode denylist blocks mutating commands', () => {
  for (const cmd of [
    'rm -rf src',
    'echo hi > file.txt',
    'git commit -m x',
    'git push origin main',
    'npm install left-pad',
    'sed -i s/a/b/ file',
    'ls && touch x',
  ]) {
    assert.ok(planModeViolation(cmd), `expected block: ${cmd}`);
  }
});

test('plan mode denylist allows read-only commands', () => {
  for (const cmd of ['ls -la', 'git log --oneline', 'cat package.json', 'git diff', 'grep -r foo src']) {
    assert.equal(planModeViolation(cmd), null, `expected allow: ${cmd}`);
  }
});

test('truncateMiddle caps long output', () => {
  const long = 'x'.repeat(100_000);
  const out = truncateMiddle(long);
  assert.ok(out.length < 31_000);
  assert.match(out, /characters truncated/);
});

test('extractText reads xlsx sheets and ignores unknown formats', async () => {
  const XLSX = await import('xlsx');
  const { extractText } = await import('../src/lib/extract');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Task', 'Owner'],
      ['Build API', 'Sam'],
    ]),
    'Plan',
  );
  const file = path.join(ws, 'plan.xlsx');
  XLSX.writeFile(wb, file);

  const text = await extractText(file);
  assert.ok(text);
  assert.match(text!, /Sheet: Plan/);
  assert.match(text!, /Build API,Sam/);

  assert.equal(await extractText(path.join(ws, 'src', 'a.ts')), null);
});

test('process registry: start, tail, survive, kill', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-data-'));
  const { processRegistry } = await import('../src/agent/processes');

  const proc = processRegistry.start('sess1', 'echo hello-from-bg; sleep 30', ws, 'test proc');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(proc.exited, false, 'process should still be running');
  assert.match(processRegistry.tail(proc.id), /hello-from-bg/);

  assert.equal(processRegistry.kill(proc.id), true);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(processRegistry.get(proc.id)?.exited, true);
});

test('process registry: session isolation and killAllForSession', async () => {
  const { processRegistry } = await import('../src/agent/processes');
  const a = processRegistry.start('sessA', 'sleep 30', ws);
  const b = processRegistry.start('sessB', 'sleep 30', ws);
  assert.equal(processRegistry.listForSession('sessA').some((p) => p.id === b.id), false);
  processRegistry.killAllForSession('sessA');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(processRegistry.get(a.id)?.exited, true);
  assert.equal(processRegistry.get(b.id)?.exited, false, 'other session untouched');
  processRegistry.killAllForSession('sessB');
});
