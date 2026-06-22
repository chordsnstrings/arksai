import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite before any config read.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-recover-'));
process.env.APP_PASSWORD = process.env.APP_PASSWORD || 'testpass';
delete process.env.DATABASE_URL;

let store: typeof import('../src/sessions/store');
let db: typeof import('../src/db');

before(async () => {
  store = await import('../src/sessions/store');
  db = await import('../src/db');
  await store.initStore();
});

async function mkRunning(id: string, updatedAt: number) {
  await db.q(
    `INSERT INTO sessions(id,title,mode,model,status,created_at,updated_at) VALUES($1,$2,'code','arksai-max','running',$3,$4)`,
    [id, 'build', updatedAt, updatedAt],
  );
}

test('recoverInterruptedSessions: recent run is queued to auto-resume, all cleared to error', async () => {
  const now = Date.now();
  await mkRunning('recent1', now - 60_000); // 1 min ago → resume
  await mkRunning('stale1', now - 60 * 60_000); // 1 h ago → NOT resumed (too old)

  const res = await store.recoverInterruptedSessions();
  assert.ok(res.all.includes('recent1') && res.all.includes('stale1'));
  assert.ok(res.resume.includes('recent1'), 'recent interruption is resumable');
  assert.ok(!res.resume.includes('stale1'), 'stale interruption is not auto-resumed');

  // Both end up cleared from "running".
  for (const id of ['recent1', 'stale1']) {
    const s = await store.getSession(id);
    assert.notEqual(s?.status, 'running');
  }
});

test('recoverInterruptedSessions: crash-loop guard — a re-interrupted resume is NOT resumed again', async () => {
  const now = Date.now();
  await mkRunning('looper', now - 30_000);
  // Simulate it was already resumed last boot (the marker is in its timeline) then died again.
  await store.appendTimeline('looper', { kind: 'system', id: 'm1', level: 'info', text: '↻ Resuming after restart…', ts: now - 20_000 } as any);

  const res = await store.recoverInterruptedSessions();
  assert.ok(!res.resume.includes('looper'), 'a session that already crash-looped is not resumed again');
  const s = await store.getSession('looper');
  assert.equal(s?.status, 'error');
});
