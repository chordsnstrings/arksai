/**
 * One-time Android build-machine bake (server-side, no SSH).
 *
 * Creates a plain Ubuntu droplet with cloud-init that installs the full Android
 * toolchain (JDK17, Node20, Android SDK + platform-tools + build-tools + NDK + cmake),
 * posts its log back here, then powers off. The server polls until the droplet is OFF
 * and the log shows RESULT=OK, snapshots it, persists the snapshot id (which ACTIVATES
 * the builder), and destroys the bake droplet. Progress is tracked on a `builds` row
 * (platform='bake') so it's observable via the admin status endpoint.
 */
import { config } from '../config';
import {
  createDroplet,
  destroyDroplet,
  getDroplet,
  snapshotDroplet,
  getAction,
  listDropletSnapshots,
} from './do';
import { createBuild, getBuild, updateBuild, type Build } from './store';
import { doToken, setSnapshotId } from './runtime';

const BAKE_TAG = 'arksai-bake';
const BAKE_TIMEOUT_MS = 55 * 60 * 1000; // SDK + NDK downloads are large

function bakeCloudInit(bakeId: string, token: string): string {
  const url = `${config.publicBaseUrl}/api/builds/${bakeId}/fail?token=${token}`;
  return `#!/bin/bash
LOG=/var/log/arksai-bake.log
exec > >(tee -a "$LOG") 2>&1
post() { tail -c 6000 "$LOG" | curl --retry 5 --retry-delay 6 -fsS -X POST "${url}" -H "Content-Type: text/plain" --data-binary @- || true; }
fail() { echo "RESULT=FAIL step=$1"; post; sleep 3; poweroff; exit 1; }
export DEBIAN_FRONTEND=noninteractive
echo "=== arksai android bake start $(date -u) ==="
apt-get update || fail apt-update
apt-get install -y openjdk-17-jdk unzip curl git ca-certificates || fail base-pkgs
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || fail node-repo
apt-get install -y nodejs || fail node
export ANDROID_HOME=/opt/android-sdk
mkdir -p "$ANDROID_HOME/cmdline-tools"
cd /tmp
curl -fsSL -o cmdline.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip || fail dl-cmdline
unzip -q cmdline.zip -d "$ANDROID_HOME/cmdline-tools" || fail unzip
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" || fail mv-cmdline
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
yes | sdkmanager --licenses || fail licenses
sdkmanager "platform-tools" "platforms;android-34" "platforms;android-35" "build-tools;34.0.0" "build-tools;35.0.0" "ndk;27.1.12297006" "cmake;3.22.1" || fail sdk-packages
printf 'export ANDROID_HOME=/opt/android-sdk\\nexport ANDROID_SDK_ROOT=/opt/android-sdk\\nexport PATH=\\$PATH:\\$ANDROID_HOME/platform-tools:\\$ANDROID_HOME/cmdline-tools/latest/bin\\n' > /etc/profile.d/android.sh
chmod -R a+rx "$ANDROID_HOME" || true
echo "--- versions ---"; node -v; java -version; sdkmanager --version
echo "RESULT=OK $(date -u)"
post
sleep 3
poweroff
`;
}

/** Kick off a bake. Returns the bake build id immediately; the rest runs in the background. */
export async function startBake(): Promise<{ id: string }> {
  if (!doToken()) throw new Error('No DO API token configured — set it before baking.');
  const bake = await createBuild({ sessionId: null, orgId: null, appName: 'android-sdk-snapshot', platform: 'bake' });
  void runBake(bake).catch(async (e) => {
    await updateBuild(bake.id, { status: 'error', phase: 'bake crashed', error: String(e?.message ?? e) }).catch(() => {});
  });
  return { id: bake.id };
}

async function runBake(bake: Build): Promise<void> {
  let dropletId: number | null = null;
  try {
    await updateBuild(bake.id, { status: 'provisioning', phase: 'creating bake machine' });
    const droplet = await createDroplet({
      name: `arksai-bake-${bake.id.slice(0, 8)}`,
      region: config.androidBuildRegion,
      size: config.androidBuildSize,
      snapshotId: 'ubuntu-22-04-x64', // base OS image (createDroplet passes a non-numeric image through)
      tags: [BAKE_TAG],
      userData: bakeCloudInit(bake.id, bake.token),
      sshKeyIds: config.androidBuildSshKeyId ? [config.androidBuildSshKeyId] : ['57010428'],
    });
    dropletId = droplet.id;
    await updateBuild(bake.id, { status: 'building', phase: 'installing Android toolchain (15–40 min)', droplet_id: String(droplet.id) });

    // Poll until the droplet powers off (cloud-init done) or timeout.
    const deadline = Date.now() + BAKE_TIMEOUT_MS;
    let off = false;
    for (;;) {
      await new Promise((r) => setTimeout(r, 20_000));
      const d = await getDroplet(dropletId).catch(() => null);
      const row = await getBuild(bake.id);
      if (row && /RESULT=FAIL/.test(row.error || '')) {
        await updateBuild(bake.id, { status: 'error', phase: 'toolchain install failed' });
        return; // leave teardown to finally
      }
      if (d && d.status === 'off') { off = true; break; }
      if (Date.now() > deadline) {
        await updateBuild(bake.id, { status: 'error', phase: 'bake timed out', error: 'The bake exceeded the time limit.' });
        return;
      }
    }

    // Only snapshot a confirmed-good machine.
    const row = await getBuild(bake.id);
    if (!off || !/RESULT=OK/.test(row?.error || '')) {
      await updateBuild(bake.id, { status: 'error', phase: 'bake inconclusive', error: (row?.error || '') + '\n(no RESULT=OK marker — not snapshotting)' });
      return;
    }

    await updateBuild(bake.id, { phase: 'snapshotting the build machine' });
    const action = await snapshotDroplet(dropletId, `arksai-android-sdk-${new Date().toISOString().slice(0, 10)}`);
    const snapDeadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 15_000));
      const a = await getAction(action.id).catch(() => null);
      if (a?.status === 'completed') break;
      if (a?.status === 'errored') { await updateBuild(bake.id, { status: 'error', phase: 'snapshot failed' }); return; }
      if (Date.now() > snapDeadline) { await updateBuild(bake.id, { status: 'error', phase: 'snapshot timed out' }); return; }
    }

    const snaps = await listDropletSnapshots(dropletId);
    const newest = snaps.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    if (!newest) { await updateBuild(bake.id, { status: 'error', phase: 'snapshot missing after completion' }); return; }

    await setSnapshotId(String(newest.id)); // ← ACTIVATES the builder
    await updateBuild(bake.id, { status: 'success', phase: 'done', artifact_path: String(newest.id), size_bytes: null });
  } finally {
    if (dropletId != null) await destroyDroplet(dropletId).catch(() => {});
  }
}
