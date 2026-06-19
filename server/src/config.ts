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
  githubToken: process.env.GITHUB_TOKEN || '',
  serperApiKey: process.env.SERPER_API_KEY || '',
  braveApiKey: process.env.BRAVE_API_KEY || '',
  // Engines (orchestration spine)
  sunoApiKey: process.env.SUNO_API_KEY || '',
  sunoBaseUrl: process.env.SUNO_BASE_URL || 'https://api.sunoapi.org',
  sunoCallbackUrl: process.env.SUNO_CALLBACK_URL || 'https://arksai.example.com/suno/callback',
  // Default Suno model id. V5 is the current flagship (superior expression, faster,
  // 1000-char style budget, up to ~8-min songs). Verified against the live sunoapi.org
  // docs (model ids: V5 / V4_5PLUS / V4_5ALL / V4_5 / V4; V4 is legacy with a 200-char
  // style cap). Override with SUNO_MODEL if a newer id ships.
  sunoModel: process.env.SUNO_MODEL || 'V5',
  // Estimated USD cost per generated track, added to the session cost. NB: a generate call
  // returns ~2 tracks, so a single generation costs ≈ 2× this.
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
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Self-healing: when true, errors/timeouts/cost-spikes are captured as incidents
  // (and, if a GitHub repo + token are set, an auto-fix issue is filed for a fresh
  // one). OFF by default — the kill switch for the whole loop. Set AUTO_HEAL=true.
  autoHeal: process.env.AUTO_HEAL === 'true',
  // Repo the auto-fix issues are filed against (owner/name); the Claude Code trigger
  // watches it. Defaults to this project's repo.
  autoHealRepo: process.env.AUTO_HEAL_REPO || 'chordsnstrings/arksai',
  // Public base URL of this app — used to build OAuth redirect URIs for ad-platform
  // connectors (must be HTTPS and registered in each provider's app). Defaults to the
  // live host; override per environment.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'https://arksai.studio').replace(/\/$/, ''),
  // Key used to encrypt connector OAuth tokens at rest (AES-256-GCM). Any string;
  // it's hashed to 32 bytes. MUST be set in production — without it connectors are
  // disabled so tokens are never stored in plaintext.
  connectorEncKey: process.env.CONNECTOR_ENC_KEY || '',
  // Ad-platform connector apps (each connector lights up only when its creds are set).
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  googleAdsClientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
  googleAdsClientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
  googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY || '',
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
  // Scheduled analytics digest: how often a platform snapshot is taken (hours), and an
  // optional webhook (Slack/Zapier/…) the digest is pushed to. Digests are always stored
  // in-app for the operator regardless; the webhook is opt-in.
  analyticsDigestHours: intEnv('ANALYTICS_DIGEST_HOURS', 24),
  analyticsDigestWebhook: process.env.ANALYTICS_DIGEST_WEBHOOK || '',
  // Gating visual design-critique loop (needs a vision model). On by default;
  // set AGENT_DESIGN_GATE=false to disable (e.g. keyless dev).
  designGate: process.env.AGENT_DESIGN_GATE !== 'false',
  // Auto-expertise router (Phase 1): a free-form message with no picked play
  // deterministically selects the right expert standards. ON by default; kill
  // switch EXPERTISE_AUTOROUTE=false for instant rollback to the generic agent.
  autoExpertise: process.env.EXPERTISE_AUTOROUTE !== 'false',
  // Confidence → clarify (Phase 4): apply explicit HIGH/MEDIUM/LOW tiers when auto-routing —
  // HIGH fires the specific task, MEDIUM fires only the department persona (no wrong
  // specifics), LOW/none injects nothing and leaves the message to the chat prompt's
  // vague-clarify path (ask ONE crisp question). ON by default; EXPERTISE_CLARIFY=false
  // reverts to applying whatever the router surfaces (task OR dept) regardless of tier.
  clarifyExpertise: process.env.EXPERTISE_CLARIFY !== 'false',
  // Progressive disclosure (Phase 5): the system prompt is assembled from a slim
  // always-on CORE + on-demand SLICES (report page-mechanics, design-system,
  // capability/tool notes); a slice is included ONLY when the current mode/task
  // needs it, decided ONCE at prompt-build time (per run + on switch_mode — no
  // mid-run swapping). A REPORT-mode build still receives EVERY rule it gets today
  // (byte-equivalent); the saving is NOT loading report/design/tool slices on turns
  // that don't use them (a plain plan turn, etc.). ON by default; EXPERTISE_PROGRESSIVE
  // =false returns the full prompt for an instant, diffable rollback.
  progressiveExpertise: process.env.EXPERTISE_PROGRESSIVE !== 'false',
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
  if (!config.minimaxApiKey) {
    const msg = 'MINIMAX_API_KEY is not set — agent runs will fail until it is provided (MiniMax is the LLM engine).';
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
    config.githubToken,
    config.appPassword,
    config.serperApiKey,
    config.braveApiKey,
    config.sunoApiKey,
    config.minimaxApiKey,
    config.analyticsDigestWebhook,
    config.metaAppSecret,
    config.googleAdsClientSecret,
    config.googleAdsDeveloperToken,
    config.tiktokClientSecret,
    config.connectorEncKey,
  ].filter((s) => s && s.length >= 6);
}
