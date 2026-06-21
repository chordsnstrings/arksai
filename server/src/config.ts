import fs from 'node:fs';
import path from 'node:path';

/** Walk up from a dir until we find the repo root (contains server/ and shared/). */
function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, 'server')) &&
      fs.existsSync(path.join(dir, 'shared')) &&
      fs.existsSync(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const repoRoot = findRoot(__dirname);

/** Minimal .env loader so we don't need a dotenv dependency. */
function loadDotEnv() {
  for (const file of [path.join(repoRoot, '.env'), path.join(process.cwd(), '.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    break;
  }
}
loadDotEnv();

const isProd = process.env.NODE_ENV === 'production';

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  isProd,
  port: intEnv('PORT', 3000),
  dataDir: process.env.DATA_DIR || path.join(repoRoot, 'data'),
  databaseUrl: process.env.DATABASE_URL || '',
  clientDist:
    process.env.CLIENT_DIST ||
    [path.join(repoRoot, 'client', 'dist')].find((p) => fs.existsSync(p)) ||
    path.join(repoRoot, 'client', 'dist'),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  githubToken: process.env.GITHUB_TOKEN || '',
  serperApiKey: process.env.SERPER_API_KEY || '',
  braveApiKey: process.env.BRAVE_API_KEY || '',
  // Engines (orchestration spine)
  sunoApiKey: process.env.SUNO_API_KEY || '',
  sunoBaseUrl: process.env.SUNO_BASE_URL || 'https://api.sunoapi.org',
  sunoCallbackUrl: process.env.SUNO_CALLBACK_URL || 'https://arksai.example.com/suno/callback',
  // Estimated USD cost per generated track, added to the session cost.
  sunoCostPerTrack: Number(process.env.SUNO_COST_PER_TRACK || '0.08') || 0.08,
  // MiniMax (LLM, voice/audio, music, video/Hailuo). Registered in the engine
  // roster when the key is set; specific tools wired per capability later.
  minimaxApiKey: process.env.MINIMAX_API_KEY || '',
  minimaxBaseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
  minimaxGroupId: process.env.MINIMAX_GROUP_ID || '',
  // OpenAI-compatible chat model sent to MiniMax. MiniMax-M3 (June 2026) is the
  // current frontier model; the branded id surfaced in ArksAI is 'arksai-max'.
  minimaxModel: process.env.MINIMAX_MODEL || 'MiniMax-M3',
  // When M3 over-buffers / stalls on an agentic turn, fall back to this faster
  // always-thinking coding model for the rest of the run (verified ~1min, detailed
  // output). Same Anthropic endpoint, so the adapter is unchanged.
  minimaxFallbackModel: process.env.MINIMAX_FALLBACK_MODEL || 'MiniMax-M2.7-highspeed',
  // MiniMax capability models (override per the MiniMax console once validated).
  // M3 is natively multimodal, so vision runs on the same model (no separate VL id).
  minimaxVlModel: process.env.MINIMAX_VL_MODEL || 'MiniMax-M3', // vision (M3 multimodal)
  minimaxImageModel: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
  minimaxTtsModel: process.env.MINIMAX_TTS_MODEL || 'speech-02-hd',
  minimaxVideoModel: process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-Hailuo-02',
  // Estimated USD cost per call, added to the session cost bar (tune to billing).
  minimaxVisionCost: Number(process.env.MINIMAX_VISION_COST || '0.003') || 0.003,
  minimaxImageCost: Number(process.env.MINIMAX_IMAGE_COST || '0.02') || 0.02,
  minimaxTtsCost: Number(process.env.MINIMAX_TTS_COST || '0.03') || 0.03,
  minimaxVideoCost: Number(process.env.MINIMAX_VIDEO_COST || '0.43') || 0.43,
  appPassword: process.env.APP_PASSWORD || '',
  // Symmetric key for encrypting third-party secrets at rest (per-org mailbox
  // passwords). Falls back to APP_PASSWORD so existing deployments work without a
  // new env var; set a dedicated ENCRYPTION_KEY to rotate independently of login.
  encryptionKey: process.env.ENCRYPTION_KEY || process.env.APP_PASSWORD || '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Scheduled analytics digest: how often a platform snapshot is taken (hours), and an
  // optional webhook (Slack/Zapier/…) the digest is pushed to. Digests are always stored
  // in-app for the operator regardless; the webhook is opt-in.
  analyticsDigestHours: intEnv('ANALYTICS_DIGEST_HOURS', 24),
  analyticsDigestWebhook: process.env.ANALYTICS_DIGEST_WEBHOOK || '',
  // Gating visual design-critique loop (needs a vision model). On by default;
  // set AGENT_DESIGN_GATE=false to disable (e.g. keyless dev).
  designGate: process.env.AGENT_DESIGN_GATE !== 'false',
  maxConcurrentRuns: intEnv('MAX_CONCURRENT_RUNS', 3),
  maxIterations: intEnv('MAX_ITERATIONS', 200),
  // When true the agent's shell inherits the FULL process environment (so it
  // can use tokens like DIGITALOCEAN_TOKEN), the workspace path jail is lifted,
  // and file tools may touch paths outside the workspace. Open-ended / unsafe;
  // intended for trusted single-operator testing. Flip off to re-harden.
  agentUnrestricted: process.env.AGENT_UNRESTRICTED === 'true',
  workspaceTtlDays: intEnv('WORKSPACE_TTL_DAYS', 14),
};

export function validateConfig() {
  const problems: string[] = [];
  if (!config.appPassword) {
    if (isProd) {
      problems.push('APP_PASSWORD is required in production (this app executes shell commands).');
    } else {
      config.appPassword = 'arksai';
      console.warn('[config] APP_PASSWORD not set — using dev default "arksai". Set it in .env.');
    }
  }
  if (!config.deepseekApiKey) {
    const msg = 'DEEPSEEK_API_KEY is not set — agent runs will fail until it is provided.';
    if (isProd) problems.push(msg);
    else console.warn(`[config] ${msg}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`[config] FATAL: ${p}`);
    process.exit(1);
  }
}

/** Secret values that must never appear in tool output sent to the model/UI. */
export function secretValues(): string[] {
  return [
    config.deepseekApiKey,
    config.githubToken,
    config.appPassword,
    config.serperApiKey,
    config.braveApiKey,
    config.sunoApiKey,
    config.minimaxApiKey,
    config.analyticsDigestWebhook,
  ].filter((s) => s && s.length >= 6);
}
