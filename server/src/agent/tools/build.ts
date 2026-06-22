import { config } from '../../config';
import type { ToolDef } from './common';
import { createBuild, getBuild, listBuildsForSession, type Build } from '../../build/store';
import { startAndroidBuild, isBuildConfigured } from '../../build/androidBuild';

const POLL_MS = 12_000;
const MAX_WAIT_MS = 20 * 60 * 1000; // bounded; cold Gradle can run ~18 min

// Errors worth ONE automatic retry (flaky infra, not the app's code): OOM, the Kotlin/Gradle
// daemon dying, a transient network/provisioning blip. A real compile error is NOT retried.
const TRANSIENT_RE = /OutOfMemory|Metaspace|daemon|GC overhead|Connection (reset|refused|timed out)|ETIMEDOUT|ECONNRESET|provision|timed out|Could not (download|resolve|GET)/i;

/** Run one build to terminal (or the wait cap). Returns the final Build row. */
async function runOneBuild(appName: string, ctx: any): Promise<Build | null> {
  const build = await createBuild({ sessionId: ctx.session.id, orgId: ctx.session.orgId ?? null, appName });
  await startAndroidBuild(build, ctx.session.id);
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    if (ctx.signal.aborted) return build;
    const b = await getBuild(build.id);
    if (!b) return null;
    if (b.status === 'success' || b.status === 'error') return b;
    if (Date.now() > deadline) return b; // still building — caller reports "in background"
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * Build a signed, installable Android APK from the current Expo app on ArksAI's own
 * build infra (ephemeral droplet; never EAS). Only appears when the build machine is
 * configured — otherwise the PWA/web build is the delivered app. Call it ONLY after the
 * Expo WEB target boots clean (the crash gate) and the app is finished.
 */
export const buildApkTool: ToolDef = {
  name: 'build_apk',
  description:
    'Build a real, installable Android APK from the finished Expo app in this workspace (on ArksAI ' +
    'infra — never EAS). Call ONLY after the Expo web target boots clean (no uncaught errors) and the ' +
    'app is complete. Takes a few minutes; returns a download link when ready. If a backend is needed ' +
    'it must already be published. Use the PWA/web path instead when a store-installable native binary ' +
    "isn't required.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'App name for the APK file (defaults to the session/app name).' },
    },
  },
  modes: ['code'],
  available: () => isBuildConfigured(),
  summarize: () => 'build Android APK',
  async run(args, ctx) {
    if (!isBuildConfigured()) {
      return 'Android APK builds are not configured on this server. Deliver the PWA/web build instead (it installs from the browser); the native APK builder needs the one-time build-machine setup.';
    }
    const appName = String(args?.name || ctx.session.title || 'ArksAI App').slice(0, 60);

    // SINGLE-FLIGHT: never start a second build while one is already in flight for this
    // session (the agent occasionally called build_apk twice → duplicate droplets + cost).
    const inFlight = (await listBuildsForSession(ctx.session.id)).find((b) =>
      ['queued', 'provisioning', 'building'].includes(b.status),
    );
    if (inFlight) {
      return `A build is already running for this app (status: ${inFlight.phase || inFlight.status}). I won't start a second one — waiting on the in-flight build avoids duplicate machines/cost.`;
    }

    const okMsg = (b: Build) => {
      if (b.cost) ctx.addCost(b.cost);
      const url = `${config.publicBaseUrl}/api/builds/${b.id}/download`;
      const mb = b.size_bytes ? Math.round(b.size_bytes / 1e5) / 10 : null;
      return `✅ APK built${mb ? ` (${mb} MB)` : ''}. Download: ${url}\nShare this link — install on Android (enable "install from unknown sources" for a sideloaded APK).`;
    };

    let b = await runOneBuild(appName, ctx);
    if (b && b.status === 'error' && TRANSIENT_RE.test(b.error || b.phase || '') && !ctx.signal.aborted) {
      // One automatic retry for a flaky-infra failure (OOM / daemon / network) — not for a
      // genuine compile error.
      const b2 = await runOneBuild(appName, ctx);
      if (b2) b = b2;
    }

    if (!b) return 'Build record disappeared unexpectedly.';
    if (ctx.signal.aborted) return `Build ${b.id} started but the run was cancelled; it will finish in the background.`;
    if (b.status === 'success') return okMsg(b);
    if (b.status === 'error') {
      return `❌ APK build failed (${b.phase || 'error'}): ${b.error || 'unknown error'}. The web/PWA build still works; fix the build issue (often a missing/incompatible native dependency — use \`expo install\`) and retry, or deliver the PWA.`;
    }
    return `Build ${b.id} is taking longer than usual and is still running (${b.phase || 'building'}). It will keep building in the background; the download will appear at ${config.publicBaseUrl}/api/builds/${b.id}/download once done.`;
  },
};
