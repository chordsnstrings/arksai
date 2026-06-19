import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInWorkspace, ToolError } from '../src/agent/tools/common';
import { planModeViolation, protectedCommand } from '../src/agent/tools/bash';
import { toCell } from '../src/agent/tools/excel';
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

test('protected denylist blocks host/process-killing commands (all modes)', () => {
  for (const cmd of [
    'pkill node',
    'pkill -f server',
    'killall -9 node',
    'fuser -k 3000/tcp',
    'sudo shutdown -h now',
    'reboot',
    'systemctl stop nginx',
    'ls && pkill node',
    'kill $(pgrep node)',
    'kill $(lsof -ti:3000)',
  ]) {
    assert.ok(protectedCommand(cmd), `expected block: ${cmd}`);
  }
});

test('protected denylist allows normal build/dev commands', () => {
  for (const cmd of ['npm run build', 'node server.js', 'npm install', 'git commit -m x', 'curl localhost:4000', 'kill 12345', 'ls -la']) {
    assert.equal(protectedCommand(cmd), null, `expected allow: ${cmd}`);
  }
});

test('spreadsheet toCell converts formula specs and leaves plain values', () => {
  assert.deepEqual(toCell('=B2*C2'), { formula: 'B2*C2' });
  assert.deepEqual(toCell({ f: 'SUM(A1:A3)', v: 6 }), { formula: 'SUM(A1:A3)', result: 6 });
  assert.deepEqual(toCell({ f: 'A1+1' }), { formula: 'A1+1' });
  assert.equal(toCell('hello'), 'hello');
  assert.equal(toCell(42), 42);
  assert.equal(toCell('='), '='); // too short to be a formula
});

test('computeCost matches MiniMax cache-aware billing', async () => {
  const { computeCost } = await import('../../shared/types');
  // arksai-max (M3): cacheHit $0.06/M, cacheMiss $0.30/M, output $1.20/M
  const c = computeCost('arksai-max', { cacheHit: 768, cacheMiss: 100, completion: 17 });
  assert.ok(Math.abs(c - (768e-6 * 0.06 + 100e-6 * 0.3 + 17e-6 * 1.2)) < 1e-12);
  // when only a prompt total is given, it's billed entirely as cache-miss
  const c2 = computeCost('arksai-max', { prompt: 1000, completion: 0 });
  assert.ok(Math.abs(c2 - 1000e-6 * 0.3) < 1e-12);
  // cache hits are far cheaper than misses
  assert.ok(
    computeCost('arksai-max', { cacheHit: 1000, completion: 0 }) <
      computeCost('arksai-max', { cacheMiss: 1000, completion: 0 }),
  );
});

test('truncateMiddle caps long output', () => {
  const long = 'x'.repeat(100_000);
  const out = truncateMiddle(long);
  assert.ok(out.length < 31_000);
  assert.match(out, /characters truncated/);
});

test('assertPublicUrl blocks SSRF targets and bad protocols', async () => {
  const { assertPublicUrl } = await import('../src/lib/web');
  for (const bad of [
    'http://localhost/admin',
    'http://127.0.0.1:3000',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5',
    'http://192.168.1.1',
    'https://[::1]/',
    'file:///etc/passwd',
    'ftp://example.com',
  ]) {
    await assert.rejects(() => assertPublicUrl(bad), new RegExp('.'), `should block ${bad}`);
  }
});

test('htmlToText strips scripts/styles and tags', async () => {
  const { htmlToText } = await import('../src/lib/web');
  const out = htmlToText(
    '<html><head><style>.x{color:red}</style></head><body><h1>Hi</h1><script>alert(1)</script><p>World &amp; more</p></body></html>',
  );
  assert.match(out, /Hi/);
  assert.match(out, /World & more/);
  assert.doesNotMatch(out, /alert/);
  assert.doesNotMatch(out, /color:red/);
});

test('extractText: spreadsheets are NOT text-extracted (read_spreadsheet handles them); unknown formats are null', async () => {
  const XLSX = await import('xlsx');
  const { extractText, EXTRACTABLE, SPREADSHEET } = await import('../src/lib/extract');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Task', 'Owner'], ['Build API', 'Sam']]), 'Plan');
  const file = path.join(ws, 'plan.xlsx');
  XLSX.writeFile(wb, file);

  // No lossy CSV sidecar for spreadsheets — they route to read_spreadsheet instead.
  assert.equal(await extractText(file), null);
  assert.ok(SPREADSHEET.has('.xlsx') && !EXTRACTABLE.has('.xlsx'));
  // Prose docs still extract; unknown formats are null.
  assert.ok(EXTRACTABLE.has('.pdf') && EXTRACTABLE.has('.docx'));
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
