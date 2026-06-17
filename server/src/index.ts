import { config, validateConfig } from './config';
import { buildApp } from './app';
import * as store from './sessions/store';
import { sweepWorkspaces } from './sessions/workspace';
import { recoverDeployments } from './deploy/registry';
import { startDeploymentJanitor } from './deploy/publish';
import { startScheduler } from './schedule/scheduler';
import { startAnalyticsDigest } from './analytics/digest';

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
  startDeploymentJanitor(); // 24h-preview auto-cleanup
  startAnalyticsDigest(); // periodic platform metric snapshots (+ optional webhook)
  console.log(`ArksAI server listening on :${config.port} (data: ${config.dataDir})`);
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
