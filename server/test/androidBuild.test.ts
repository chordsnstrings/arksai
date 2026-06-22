import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB before any config read.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-build-'));
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let S: typeof import('../src/build/store');
let AB: typeof import('../src/build/androidBuild');

before(async () => {
  db = await import('../src/db');
  S = await import('../src/build/store');
  AB = await import('../src/build/androidBuild');
  await db.initDb();
});

test('isBuildConfigured is false without a DO token + snapshot (feature dormant)', () => {
  assert.equal(AB.isBuildConfigured(), false);
});

test('reaper + reaper-start are no-ops when unconfigured', async () => {
  assert.equal(await AB.reapOrphanBuildDroplets(), 0);
  assert.doesNotThrow(() => AB.startBuildReaper());
});

test('startAndroidBuild marks the build errored (not-configured) when dormant', async () => {
  const b = await S.createBuild({ sessionId: null, orgId: null, appName: 'Snap QR' });
  await AB.startAndroidBuild(b, 'no-session');
  const after = await S.getBuild(b.id);
  assert.equal(after?.status, 'error');
  assert.equal(after?.phase, 'not-configured');
});

test('build store round-trips with a one-time token, status updates and active list', async () => {
  const b = await S.createBuild({ sessionId: 's1', orgId: 'o1', appName: 'Sparkmatch' });
  assert.equal(b.status, 'queued');
  assert.ok(b.token && b.token.length >= 32, 'a one-time token is minted');

  // Two distinct builds never share a token.
  const b2 = await S.createBuild({ sessionId: 's1', orgId: 'o1', appName: 'Sparkmatch' });
  assert.notEqual(b.token, b2.token);

  await S.updateBuild(b.id, { status: 'building', phase: 'building APK', droplet_id: '12345' });
  const mid = await S.getBuild(b.id);
  assert.equal(mid?.status, 'building');
  assert.equal(mid?.droplet_id, '12345');

  const active = await S.listActiveBuilds();
  assert.ok(active.some((x) => x.id === b.id), 'an in-flight build is listed active');

  await S.updateBuild(b.id, { status: 'success', size_bytes: 24_000_000 });
  const done = await S.getBuild(b.id);
  assert.equal(done?.status, 'success');
  assert.equal(done?.size_bytes, 24_000_000);

  const list = await S.listBuildsForSession('s1');
  assert.ok(list.length >= 2);
});

test('build_apk tool is gated + reports not-configured cleanly when dormant', async () => {
  const { buildApkTool } = await import('../src/agent/tools/build');
  assert.equal(buildApkTool.available?.(), false); // hidden until the build machine is set up
  const ctx: any = {
    session: { id: 's-apk', title: 'Snap QR', orgId: null },
    repoDir: '/tmp',
    mode: 'code',
    signal: new AbortController().signal,
    addCost: () => {},
  };
  const res = await buildApkTool.run({}, ctx);
  assert.match(res, /not configured/i);
  assert.match(res, /PWA|web/i); // points the user at the working alternative
});

test('build paths live under the data dir and are per-build', () => {
  const a = AB.apkPath('abc');
  const s = AB.sourceTarPath('abc');
  assert.match(a, /builds[\\/]abc[\\/]app\.apk$/);
  assert.match(s, /builds[\\/]abc[\\/]source\.tgz$/);
  assert.notEqual(AB.buildDir('abc'), AB.buildDir('def'));
});
