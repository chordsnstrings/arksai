import { config, validateConfig } from './config';
import { buildApp } from './app';
import * as store from './sessions/store';
import { sweepWorkspaces } from './sessions/workspace';
import { recoverDeployments } from './deploy/registry';
import { startDeploymentJanitor, startDeploymentHealthMonitor } from './deploy/publish';
import { startScheduler } from './schedule/scheduler';
import { startAnalyticsDigest } from './analytics/digest';
import { startRobotPoller } from './robots/poller';
import { startBuildReaper } from './build/androidBuild';
import { loadBuildRuntime } from './build/runtime';
import { loadByteplusRuntime } from './agent/byteplusRuntime';
import { loadDbRuntime } from './deploy/dbRuntime';
import { loadGithubRuntime } from './github/runtime';
import { loadGoogleRuntime } from './googleRuntime';
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
  startScheduler();
  startRobotPoller(); // inbound mail → robot draft replies (Stage 2)
  startDeploymentJanitor(); // 24h-preview auto-cleanup
  startDeploymentHealthMonitor(); // restart any published app whose process died (self-healing)
  startAnalyticsDigest(); // periodic platform metric snapshots (+ optional webhook)
  await loadBuildRuntime(); // load DO token + snapshot id from app_settings (if not in env)
  await loadByteplusRuntime(); // load the BytePlus/Dola ark key from app_settings (if not in env)
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
  // Make provider configuration self-evident at boot. MiniMax is the LLM engine AND powers
  // image gen / vision / M3 / M2.7 — one key for everything.
  console.log(
    `[capabilities] LLM + image + vision + ArksAI Max/Flash (MiniMax): ${
      config.minimaxApiKey ? 'enabled' : 'DISABLED — set MINIMAX_API_KEY in /opt/arksai/.env'
    } · web search: ${config.serperApiKey || config.braveApiKey ? 'enabled' : 'off'}`,
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
