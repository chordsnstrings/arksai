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
