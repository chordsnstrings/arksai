import { config, validateConfig } from './config';
import { buildApp } from './app';
import * as store from './sessions/store';
import { sweepWorkspaces } from './sessions/workspace';

async function main() {
  validateConfig();
  store.initStore();

  const recovered = store.recoverInterruptedSessions();
  if (recovered.length) {
    console.log(`[boot] marked ${recovered.length} interrupted session(s) as errored`);
  }
  sweepWorkspaces();

  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
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
