import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordCheckpoint, readCheckpoints, checkpointResumeNote, checkpointPlanGuidance } from '../src/agent/checkpoint';

const mkws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-cp-'));

test('recordCheckpoint git-inits, commits, and records the milestone in the ledger', async () => {
  const ws = mkws();
  fs.writeFileSync(path.join(ws, 'index.html'), '<h1>step 1</h1>');
  const r = await recordCheckpoint(ws, 'built the landing page');
  assert.equal(r.ok, true, `commit ok (${r.output})`);
  assert.ok(r.sha.length >= 4, 'a short sha was captured');
  // a git repo now exists with a commit
  assert.ok(fs.existsSync(path.join(ws, '.git')), 'workspace was git-init-ed');
  const led = readCheckpoints(ws);
  assert.equal(led.length, 1);
  assert.equal(led[0].task, 'built the landing page');
  assert.equal(led[0].sha, r.sha);
});

test('a second checkpoint appends to the ledger (task-by-task)', async () => {
  const ws = mkws();
  fs.writeFileSync(path.join(ws, 'a.txt'), '1');
  await recordCheckpoint(ws, 'task one');
  fs.writeFileSync(path.join(ws, 'b.txt'), '2');
  await recordCheckpoint(ws, 'task two');
  const led = readCheckpoints(ws);
  assert.equal(led.length, 2);
  assert.deepEqual(led.map((c) => c.task), ['task one', 'task two']);
});

test('checkpointResumeNote lists completed work only when checkpoints exist', async () => {
  const ws = mkws();
  assert.equal(checkpointResumeNote(ws), '', 'no checkpoints → empty (fresh build, no note)');
  fs.writeFileSync(path.join(ws, 'x'), '1');
  await recordCheckpoint(ws, 'data model + migrations');
  const note = checkpointResumeNote(ws);
  assert.match(note, /Resuming a checkpointed build/);
  assert.match(note, /data model \+ migrations/);
  assert.match(note, /must NOT rebuild/);
});

test('readCheckpoints tolerates a missing/garbage ledger', () => {
  const ws = mkws();
  assert.deepEqual(readCheckpoints(ws), []);
  fs.mkdirSync(path.join(ws, '.arksai'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.arksai', 'checkpoints.json'), 'not json');
  assert.deepEqual(readCheckpoints(ws), []);
});

test('checkpointPlanGuidance: a few one-pass steps, each checkpointed (operator doctrine 2026-07-02)', () => {
  const g = checkpointPlanGuidance();
  assert.match(g, /a few one-pass steps, each checkpointed/i);
  assert.match(g, /Same one-pass rule, applied per STEP/);
  assert.match(g, /checkpoint\(/);
});
