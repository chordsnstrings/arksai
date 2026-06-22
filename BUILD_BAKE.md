# Android build machine — one-time snapshot bake

The Android APK builder (Phase 3) runs each build on an **ephemeral DigitalOcean droplet**
created from a **pre-baked Android-SDK snapshot**, then destroys it. This is the single
one-time setup that turns the (already-shipped) orchestrator from *dormant* → *live*. After
it's done, builds are fully hands-free.

## What the orchestrator needs (env on the production droplet, in `/opt/arksai/.env`)
```
DO_API_TOKEN=dop_v1_…            # DO API token in the droplet's account (gicbdfacebook@gmail.com)
ANDROID_SNAPSHOT_ID=123456789    # id of the snapshot baked below
# optional overrides:
ANDROID_BUILD_REGION=blr1        # match the main droplet's region for speed
ANDROID_BUILD_SIZE=s-4vcpu-8gb   # Gradle wants RAM; 8GB is comfortable
ANDROID_BUILD_SSH_KEY_ID=        # a DO ssh key id, only if you want to shell in to debug
ANDROID_BUILD_TIMEOUT_MS=1500000 # 25 min hard cap (droplet destroyed on timeout)
ANDROID_BUILD_COST=0.12          # our infra cost/build (shown to the user; bill more later)
```
`isBuildConfigured()` is true only when **DO_API_TOKEN _and_ ANDROID_SNAPSHOT_ID** are set;
until then `POST /api/sessions/:id/build-apk` returns a clear "not configured" 503 and the
orphan reaper no-ops. **PWA/web builds are unaffected** — they never touch this.

## Bake the snapshot (≈ 20 min, once)
1. Create a temporary droplet (`s-4vcpu-8gb`, Ubuntu 22.04, the build region).
2. Install the toolchain:
   ```bash
   apt-get update && apt-get install -y openjdk-17-jdk unzip curl git
   # Node 20
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
   # Android cmdline-tools + SDK
   export ANDROID_HOME=/opt/android-sdk
   mkdir -p $ANDROID_HOME/cmdline-tools
   cd /tmp && curl -fsSL -o cmdline.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
   unzip -q cmdline.zip -d $ANDROID_HOME/cmdline-tools
   mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
   export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
   yes | sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125"
   # Persist the env for cloud-init runs
   printf 'export ANDROID_HOME=/opt/android-sdk\nexport PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin\n' > /etc/profile.d/android.sh
   ```
3. (Optional but faster) warm the Gradle + npm caches by running one throwaway
   `expo prebuild` + `./gradlew assembleRelease` on a sample app, so real builds hit a warm cache.
4. Bake a **release signing keystore** into the image (or have cloud-init generate a debug-signed
   APK for sideload; Play Store upload needs a real keystore — Phase 4).
5. Power off, **take a snapshot** in the DO console (or `POST /droplets/{id}/actions {type:snapshot}`),
   note its **id** → that's `ANDROID_SNAPSHOT_ID`. Destroy the temp droplet.

## How a build runs (no SSH from the server)
`androidBuild.ts` tars the session workspace → `data/builds/<id>/source.tgz`, creates a droplet
from the snapshot tagged `arksai-build`, and passes **cloud-init** that: downloads the source
from `/api/builds/<id>/source?token=…`, `npm install`, `expo prebuild --platform android`,
Gradle `assembleRelease`, then POSTs the APK to `/api/builds/<id>/artifact?token=…` (or a log
tail to `/fail`) and powers off. The server's watcher polls the build row and **always destroys
the droplet** (finally); a 10-min **orphan reaper** destroys any stray `arksai-build` droplet not
owned by an in-flight build. Each build's token is one-time and the droplet routes are gated on it.

## Verify (after baking + setting env, on a fresh deploy)
1. Build a **small** app (QR scanner) and a **large** app (Tinder-style) via the agent.
2. Confirm a real `.apk` downloads from the build panel and the droplet was destroyed
   (`listDropletsByTag('arksai-build')` empty).
3. Phase 4: emulator crash-smoke (the snapshot has the SDK → boot the APK in an emulator and
   assert it launches without crashing) before delivery, plus release signing.

> iOS/Apple uses **EAS** (Expo cloud build, macOS) on the SAME RN codebase — a separate track.
> Android NEVER uses EAS.
