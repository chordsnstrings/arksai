import { config, validateConfig } from './config';
import { buildApp } from './app';
import * as store from './sessions/store';
import { sweepWorkspaces } from './sessions/workspace';
import { attachWsUpgradeProxy } from './deploy/wsProxy';
import { recoverDeployments, deploymentRegistry } from './deploy/registry';
import { startDeploymentJanitor, startDeploymentHealthMonitor } from './deploy/publish';
import { startScheduler } from './schedule/scheduler';
import { startAnalyticsDigest } from './analytics/digest';
import { startIssueDigest } from './selfheal/issueDigest';
import { warmBackgroundRemoval } from './agent/productShot';
import { startRobotPoller } from './robots/poller';
import { installCommandHook } from './robots/tasks';
import { installNotifyHooks } from './robots/notify';
import { startBuildReaper } from './build/androidBuild';
import { loadBuildRuntime } from './build/runtime';
import { loadByteplusRuntime, byteplusConfigured } from './agent/byteplusRuntime';
import { loadMetaRuntime } from './connectors/metaRuntime';
import { loadPhotoRuntime } from './agent/assets/photos';
import { loadDbRuntime } from './deploy/dbRuntime';
import { loadGithubRuntime } from './github/runtime';
import { loadGoogleRuntime } from './googleRuntime';
import { ttsAvailable } from './engines/speech';
import * as manager from './sessions/manager';

async function main() {
  validateConfig();
  await store.initStore();

  const recovered = await store.recoverInterruptedSessions();
  if (recovered.all.length) {
    console.log(`[boot] cleared ${recovered.all.length} interrupted run(s); ${recovered.resume.length} eligible to auto-resume`);
  }
  await sweepWorkspaces();
  await recoverDeployments().catch((err) => console.error('[boot] deployment recovery:', err));

  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  // WebSocket upgrade forwarding for published apps: /apps/<slug>/… WS handshakes are piped
  // to the app's local port (the fetch-based proxy can't carry an UPGRADE). SSE stays the
  // default realtime transport; this makes real-WS apps work at their published URL too.
  attachWsUpgradeProxy(app.server, (slug) => deploymentRegistry.runningPort(slug));
  startScheduler();
  installCommandHook(); // trusted-commander build lane (channels → tryCommand)
  installNotifyHooks(); // owner pings + remote APPROVE/dictate resolution
  startRobotPoller(); // inbound mail + channels → robot draft replies / build tasks
  startDeploymentJanitor(); // 24h-preview auto-cleanup
  startDeploymentHealthMonitor(); // restart any published app whose process died (self-healing)
  startAnalyticsDigest(); // periodic platform metric snapshots (+ optional webhook)
  startIssueDigest(); // self-healing Phase 1: nightly issue detection + clustering digest
  warmBackgroundRemoval(); // one-time rembg JIT warmup so the first product video is never slow
  await loadBuildRuntime(); // load DO token + snapshot id from app_settings (if not in env)
  await loadByteplusRuntime(); // load the ModelArk ark key from app_settings (if not in env)
  if (!byteplusConfigured()) {
    // ModelArk is the ONLY model provider — without the key nothing can think, see or generate.
    console.error(
      '[boot] ✗✗✗ ModelArk key NOT configured — EVERY model feature (chat, builds, vision, images, ' +
        'video, embeddings) is DISABLED until the key is set via Admin → Keys ' +
        '(POST /api/admin/providers/byteplus) or ARK_API_KEY in /opt/arksai/.env. ✗✗✗',
    );
  }
  await loadMetaRuntime(); // load the Meta app secret from app_settings (if not in env) → ads connector
  await loadPhotoRuntime(); // load the Pexels key from app_settings (if not in env)
  await loadDbRuntime(); // load the managed-Postgres admin URL from app_settings (if not in env)
  await loadGithubRuntime(); // load GitHub OAuth-app creds from app_settings (if not in env)
  await loadGoogleRuntime(); // load Google OAuth-client creds from app_settings (if not in env)
  startBuildReaper(); // destroy any stray Android build droplet (no-op unless configured)
  // Auto-resume runs a restart/deploy interrupted (recency- + crash-loop-guarded in the store),
  // so a deploy never loses an in-flight build. Capped so a bad batch can't stampede.
  for (const id of recovered.resume.slice(0, 5)) {
    manager
      .startRun(id, 'Continue from where you left off — pick up the build exactly where it stopped.')
      .then((r) => console.log(`[boot] auto-resume ${id}: ${r.ok ? 'started' : r.error}`))
      .catch((e) => console.error(`[boot] auto-resume ${id} failed:`, e?.message ?? e));
  }
  console.log(`ArksAI server listening on :${config.port} (data: ${config.dataDir})`);
  // Make provider configuration self-evident at boot. ModelArk is the single model provider —
  // one key for every LLM lane + vision + Seedream images + Seedance video + embeddings. There is
  // no speech model on ModelArk, so TTS reports off until engines/speech.ts gains a provider.
  // (scripts/deploy-check.sh greps this line — keep "ModelArk" + "enabled" in it.)
  console.log(
    `[capabilities] ModelArk (chat + vision + images + video + embeddings): ${
      byteplusConfigured() ? 'enabled' : 'DISABLED — set the key via Admin → Keys or ARK_API_KEY in /opt/arksai/.env'
    } · tts: ${ttsAvailable() ? 'enabled' : 'off'} · web search: ${config.serperApiKey || config.braveApiKey ? 'enabled' : 'off'}`,
  );
  if (config.agentUnrestricted) {
    console.warn(
      '[security] AGENT_UNRESTRICTED=true — the agent has FULL host + env access. ' +
        'For trusted testing only.',
    );
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
