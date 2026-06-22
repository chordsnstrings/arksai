/**
 * Android APK build orchestrator — ephemeral DigitalOcean build droplet.
 *
 * Flow (no SSH needed — the droplet pulls source + pushes the APK over HTTPS):
 *  1. tar the session workspace → data/builds/<id>/source.tgz (served by a token-gated route)
 *  2. create a droplet from the pre-baked Android-SDK snapshot, passing cloud-init that:
 *       fetches the source tarball, npm install, `expo prebuild`, Gradle `assembleRelease`,
 *       then POSTs the APK back to /api/builds/<id>/artifact (or /fail with a log tail).
 *  3. poll the build row until terminal or the hard timeout; ALWAYS destroy the droplet
 *       (finally). An orphan reaper destroys any stray arksai-build droplet.
 *
 * Stays dormant unless a DO API token AND a baked Android-SDK snapshot id are set
 * (isBuildConfigured, from env or app_settings) — build_apk reports "not configured".
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config';
import { repoDir } from '../sessions/workspace';
import { createDroplet, destroyDroplet, getDroplet, listDropletsByTag } from './do';
import { getBuild, updateBuild, listActiveBuilds, type Build } from './store';
import { isBuildConfigured, snapshotId } from './runtime';

const execFileP = promisify(execFile);
const BUILD_TAG = 'arksai-build';

export { isBuildConfigured } from './runtime';

export function buildsDir(): string {
  return path.join(config.dataDir, 'builds');
}
export function buildDir(id: string): string {
  return path.join(buildsDir(), id);
}
export function sourceTarPath(id: string): string {
  return path.join(buildDir(id), 'source.tgz');
}
export function apkPath(id: string): string {
  return path.join(buildDir(id), 'app.apk');
}

/** cloud-init the build droplet runs once on first boot. */
function cloudInit(build: Build): string {
  const base = config.publicBaseUrl;
  const url = `${base}/api/builds/${build.id}`;
  const tok = build.token;
  // The snapshot already has: JDK 17, Android SDK + cmdline-tools, Node 20, the Gradle cache.
  return [
    '#!/bin/bash',
    'set -uo pipefail',
    'export ANDROID_HOME=${ANDROID_HOME:-/opt/android-sdk}',
    'export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"',
    'WORK=/tmp/arksai-build && rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"',
    'LOG="$WORK/build.log"',
    'fail() { tail -c 4000 "$LOG" 2>/dev/null | ' +
      `curl -fsS -X POST "${url}/fail?token=${tok}" -H "Content-Type: text/plain" --data-binary @- || true; poweroff; exit 1; }`,
    '{',
    `  curl -fsSL "${url}/source?token=${tok}" -o source.tgz || { echo "source download failed"; fail; }`,
    '  tar xzf source.tgz || { echo "untar failed"; fail; }',
    '  npm install --no-audit --no-fund || { echo "npm install failed"; fail; }',
    '  npx --yes expo prebuild --platform android --no-install || { echo "expo prebuild failed"; fail; }',
    '  cd android && ./gradlew assembleRelease --no-daemon -x lint || { echo "gradle assembleRelease failed"; fail; }',
    '  APK=$(ls -1 app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)',
    '  [ -n "$APK" ] || { echo "no apk produced"; fail; }',
    `  curl -fsS -X POST "${url}/artifact?token=${tok}" -H "Content-Type: application/octet-stream" --data-binary @"$APK" || { echo "artifact upload failed"; fail; }`,
    '  poweroff',
    '} >>"$LOG" 2>&1',
  ].join('\n');
}

async function tarWorkspace(sessionId: string, id: string): Promise<void> {
  const src = repoDir(sessionId);
  if (!fs.existsSync(src)) throw new Error('no workspace to build');
  fs.mkdirSync(buildDir(id), { recursive: true });
  // Exclude heavy/regenerable dirs; the droplet runs a fresh install.
  await execFileP('tar', [
    '-C', src,
    '--exclude=node_modules', '--exclude=.git', '--exclude=android', '--exclude=ios',
    '--exclude=.expo', '--exclude=dist', '--exclude=web-build',
    '-czf', sourceTarPath(id), '.',
  ], { maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Kick off a build (returns once the droplet is creating; the rest runs in the
 * background and reports completion via the artifact/fail routes + this watcher).
 */
export async function startAndroidBuild(build: Build, sessionId: string): Promise<void> {
  if (!isBuildConfigured()) {
    await updateBuild(build.id, { status: 'error', phase: 'not-configured', error: 'Android builds are not configured on this server (DO_API_TOKEN + ANDROID_SNAPSHOT_ID).' });
    return;
  }
  try {
    await updateBuild(build.id, { status: 'provisioning', phase: 'packaging source' });
    await tarWorkspace(sessionId, build.id);
    await updateBuild(build.id, { phase: 'creating build machine' });
    const droplet = await createDroplet({
      name: `arksai-build-${build.id.slice(0, 8)}`,
      region: config.androidBuildRegion,
      size: config.androidBuildSize,
      snapshotId: snapshotId(),
      tags: [BUILD_TAG],
      userData: cloudInit(build),
      sshKeyIds: config.androidBuildSshKeyId ? [config.androidBuildSshKeyId] : undefined,
    });
    await updateBuild(build.id, { status: 'building', phase: 'building APK on the cloud machine', droplet_id: String(droplet.id) });
    // Background watcher: teardown + timeout (success/fail land via the routes).
    void watchBuild(build.id, droplet.id);
  } catch (e: any) {
    await updateBuild(build.id, { status: 'error', phase: 'provisioning failed', error: String(e?.message ?? e) });
    // Best-effort: if a droplet leaked, the reaper will catch it.
  }
}

async function watchBuild(id: string, dropletId: number): Promise<void> {
  const deadline = Date.now() + config.androidBuildTimeoutMs;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 12_000));
      const b = await getBuild(id);
      if (!b) break;
      if (b.status === 'success' || b.status === 'error') break;
      if (Date.now() > deadline) {
        await updateBuild(id, { status: 'error', phase: 'timed out', error: 'Build exceeded the time limit and was cancelled.' });
        break;
      }
    }
  } finally {
    await destroyDroplet(dropletId).catch(() => {});
    // Stamp our infra cost once the droplet is gone.
    const b = await getBuild(id);
    if (b && b.cost == null) await updateBuild(id, { cost: config.androidBuildCost });
  }
}

/**
 * Destroy any stray arksai-build droplet that no in-flight build still owns.
 * Belt-and-braces against a crashed watcher; safe to run periodically + on boot.
 */
export async function reapOrphanBuildDroplets(): Promise<number> {
  if (!isBuildConfigured()) return 0;
  let killed = 0;
  try {
    const [droplets, active] = await Promise.all([listDropletsByTag(BUILD_TAG), listActiveBuilds()]);
    const owned = new Set(active.map((b) => b.droplet_id).filter(Boolean) as string[]);
    for (const d of droplets) {
      if (!owned.has(String(d.id))) {
        await destroyDroplet(d.id).catch(() => {});
        killed++;
      }
    }
  } catch (e: any) {
    console.warn('[androidBuild] reaper error:', e?.message ?? e);
  }
  return killed;
}

let reaperTimer: NodeJS.Timeout | null = null;
/** Boot hook: reap orphans now, then every 10 minutes. No-op if unconfigured. */
export function startBuildReaper(): void {
  if (!isBuildConfigured() || reaperTimer) return;
  void reapOrphanBuildDroplets();
  reaperTimer = setInterval(() => void reapOrphanBuildDroplets(), 10 * 60 * 1000);
  reaperTimer.unref?.();
  console.log('[androidBuild] orphan reaper started (10m)');
}
