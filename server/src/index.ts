import { config, validateConfig } from './config';
import { buildApp } from './app';
import * as store from './sessions/store';
import { sweepWorkspaces } from './sessions/workspace';
import { recoverDeployments } from './deploy/registry';
import { startDeploymentJanitor } from './deploy/publish';
import { startScheduler } from './schedule/scheduler';
import { startAnalyticsDigest } from './analytics/digest';
import { startRobotPoller } from './robots/poller';
import { startBuildReaper } from './build/androidBuild';

async function main() {
  validateConfig();
  await store.initStore();

  const recovered = await store.recoverInterruptedSessions();
  if (recovered.length) {
    console.log(`[boot] marked ${recovered.length} interrupted session(s) as errored`);
  }
  await sweepWorkspaces();
  await recoverDeployments().catch((err) => console.error('[boot] deployment recovery:', err));

  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  startScheduler();
  startRobotPoller(); // inbound mail → robot draft replies (Stage 2)
  startDeploymentJanitor(); // 24h-preview auto-cleanup
  startAnalyticsDigest(); // periodic platform metric snapshots (+ optional webhook)
  startBuildReaper(); // destroy any stray Android build droplet (no-op unless configured)
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
