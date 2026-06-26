import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-clone-'));
delete process.env.DATABASE_URL;

let ws: typeof import('../src/sessions/workspace');

before(async () => {
  ws = await import('../src/sessions/workspace');
});

test('ensureRepoCloned: no repo connected → never clones', async () => {
  const cloned = await ws.ensureRepoCloned({ id: 's-norepo', repoUrl: null } as any);
  assert.equal(cloned, false);
});

test('ensureRepoCloned: a non-empty workspace is never clobbered', async () => {
  const id = 's-hasfiles';
  const dir = ws.repoDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>my app</h1>'); // real work already here
  const cloned = await ws.ensureRepoCloned({ id, repoUrl: 'https://github.com/x/y.git', repoName: 'x/y' } as any);
  assert.equal(cloned, false); // guard: don't wipe the user's build to clone over it
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>my app</h1>'); // intact
});
