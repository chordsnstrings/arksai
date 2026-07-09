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
  // Auto-Brief: inject the deterministic per-deliverable rigor scaffold into the system
  // prompt (Phase 1). On by default; set AUTO_BRIEF=0 to disable.
  autoBrief: process.env.AUTO_BRIEF !== '0',
  // Design-brief compiler: for a VISUAL build, an upfront M3 pass rewrites the user's casual
  // request into an expert, art-directed build brief (concept/palette/type/layout/signature/
  // avoid) that the build then follows — the per-request "think first" step Claude does
  // internally. On by default (needs the MiniMax key); set DESIGN_BRIEF=0 to disable.
  designBrief: process.env.DESIGN_BRIEF !== '0',
  // Per-session preview-port allocation (kills the canvas port race). Default on;
  // set PREVIEW_PORT_ALLOC=0 to fall back to the legacy fixed-4000 + /proc-scan path.
  previewPortAlloc: process.env.PREVIEW_PORT_ALLOC !== '0',
  // Checkpointed long-build mode (Phase 4): for a large build, the agent works task-by-task
  // and calls checkpoint(...) after each milestone → a durable git commit so the build is
  // resumable if interrupted. Opt-in (set CHECKPOINT_BUILDS=1) while it beds in.
  // Plan-by-plan heavy builds (Phase 4): ON by default — a heavy code build gets the
  // "outline ordered tasks → build one → checkpoint() → verify → next" steering + durable
  // git checkpoints with a resume note, so a long build is bounded and survives interruption
  // (the runaway/abort failures in the heavy-model bake-off were unbounded single-pass runs).
  // Set CHECKPOINT_BUILDS=0 to disable.
  checkpointBuilds: process.env.CHECKPOINT_BUILDS !== '0',
  // Simple-build fast path: for a trivially-simple (light-tier) code build, inject
  // anti-over-engineering guidance, cap the design-critique to 1 round, and nudge the
  // model to ship once it's over-building — so a small ask stays small + fast. Default
  // on; set SIMPLE_FAST_PATH=0 to disable.
  simpleFastPath: process.env.SIMPLE_FAST_PATH !== '0',
  // Direction library: inject the curated catalog of 40 tested modern design directions
  // (a layout archetype + a font trio + an accent + a signature) into the design context for
  // visual builds, so the agent picks a fitting, modern, varied look instead of one default.
  // On by default; set DIRECTION_LIBRARY=0 to disable.
  directionLibrary: process.env.DIRECTION_LIBRARY !== '0',
  dataDir: process.env.DATA_DIR || path.join(repoRoot, 'data'),
  databaseUrl: process.env.DATABASE_URL || '',
  // Admin connection to a managed Postgres used to PROVISION per-app databases for deployed apps
  // (each app gets its own isolated role + database). Empty → Postgres provisioning is disabled and
  // DB-backed apps must use self-contained SQLite. Set MANAGED_PG_ADMIN_URL on the droplet to enable.
  pgAdminUrl: process.env.MANAGED_PG_ADMIN_URL || '',
  clientDist:
    process.env.CLIENT_DIST ||
    [path.join(repoRoot, 'client', 'dist')].find((p) => fs.existsSync(p)) ||
    path.join(repoRoot, 'client', 'dist'),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  // BytePlus (ByteDance ModelArk) — the OpenAI-compatible CODING-PLAN endpoint (flat-rate).
  // Powers "ArksAI Swift" (Dola-Seed-2.0-pro) as the fast lane for simple builds. DORMANT until
  // ARK_API_KEY is set: with no key, simple builds stay on MiniMax (no behaviour change).
  byteplusApiKey: process.env.ARK_API_KEY || '',
  // Pexels stock photography/footage (search_photos) — free key from pexels.com/api;
  // keyless CC fallbacks (Openverse/Wikimedia) keep the tool alive without it.
  pexelsApiKey: process.env.PEXELS_API_KEY || '',
  byteplusBaseUrl: process.env.BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
  // Video (Seedance via ModelArk) runs on the GENERAL endpoint, not the coding plan.
  byteplusVideoBaseUrl: process.env.BYTEPLUS_VIDEO_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3',
  // Nominal cost estimates for the session cost bar (tune against real billing).
  seedanceDraftCost: Number(process.env.SEEDANCE_DRAFT_COST || '0.05') || 0.05,
  seedanceFinalCostPerSec: Number(process.env.SEEDANCE_FINAL_COST_PER_SEC || '0.08') || 0.08,
  // Per-K-video-token rate for story cost ESTIMATES (console June 2026: 1.5 ≈ $0.0012–0.0024/K;
  // mid default). The 2.0 rate rides the same knob until the console confirms a separate one.
  seedanceCostPerKTok: Number(process.env.SEEDANCE_COST_PER_KTOK || '0.0018') || 0.0018,
  byteplusModel: process.env.BYTEPLUS_MODEL || 'seed-2-0-pro',
  // Heavy-tier BytePlus coders under evaluation for the heavy build lane (branded id → concrete
  // model, with an optional per-model base URL override; env-overridable). All run on the coding
  // plan endpoint (config.byteplusBaseUrl) and are confirmed doing streaming tool-calls. A `base`
  // override can target the general endpoint for a model the coding plan doesn't serve (unused now
  // — GLM-5.2 is NOT on this account's coding plan; GLM-5.1 is the Z.AI flagship offered here).
  byteplusHeavyModels: {
    'arksai-heavy-glm': { model: process.env.BYTEPLUS_GLM_MODEL || 'glm-4-7-251222' }, // GLM-4.7
    'arksai-heavy-glm51': { model: process.env.BYTEPLUS_GLM51_MODEL || 'glm-5-1' }, // GLM-5.1 (Z.AI flagship, long-horizon)
    'arksai-heavy-kimi': { model: process.env.BYTEPLUS_KIMI_MODEL || 'kimi-k2-5' }, // Kimi-K2.5 (agentic stability)
    'arksai-heavy-ds4': { model: process.env.BYTEPLUS_DS4_MODEL || 'deepseek-v4-pro-260425' }, // DeepSeek-V4-Pro
    'arksai-heavy-code': { model: process.env.BYTEPLUS_CODE_MODEL || 'seed-2-0-code-preview-260328' }, // Dola-Seed-2.0-Code
  } as Record<string, { model: string; base?: string }>,
  // Non-thinking DeepSeek alias used for one-shot robot reply drafting (fast, decisive;
  // the thinking v4-pro is slow for short outputs). Env-overridable.
  deepseekReplyModel: process.env.DEEPSEEK_REPLY_MODEL || 'deepseek-chat',
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
  // Estimated cost of one M3 text completion (e.g. a logo SVG / brand-directive turn).
  minimaxTextCost: Number(process.env.MINIMAX_TEXT_COST || '0.004') || 0.004,
  minimaxImageCost: Number(process.env.MINIMAX_IMAGE_COST || '0.02') || 0.02,
  minimaxTtsCost: Number(process.env.MINIMAX_TTS_COST || '0.03') || 0.03,
  minimaxVideoCost: Number(process.env.MINIMAX_VIDEO_COST || '0.43') || 0.43,
  appPassword: process.env.APP_PASSWORD || '',
  // Symmetric key for encrypting third-party secrets at rest (per-org mailbox
  // passwords). Falls back to APP_PASSWORD so existing deployments work without a
  // new env var; set a dedicated ENCRYPTION_KEY to rotate independently of login.
  encryptionKey: process.env.ENCRYPTION_KEY || process.env.APP_PASSWORD || '',
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
  // When set (e.g. "apps.arksai.studio"), published apps are advertised at the CLEAN subdomain
  // https://<slug>.<base>/ instead of the path https://arksai.studio/apps/<slug>/. The server
  // already ROUTES <slug>.apps.arksai.studio (routes/deployments.ts) + Caddy mints on-demand TLS;
  // set this ONLY after the wildcard DNS (*.apps.arksai.studio → the droplet) is verified live,
  // so we never hand out a non-resolving URL. Empty = path-based (always works).
  appsSubdomainBase: (process.env.APPS_SUBDOMAIN_BASE || '').trim().replace(/^\.+|\/+$/g, ''),
  // Key used to encrypt connector OAuth tokens at rest (AES-256-GCM). Any string;
  // it's hashed to 32 bytes. MUST be set in production — without it connectors are
  // disabled so tokens are never stored in plaintext.
  connectorEncKey: process.env.CONNECTOR_ENC_KEY || '',
  // GitHub OAuth App — lets a user connect their own GitHub account and pick a repo to push
  // generated code to (per-user; tokens encrypted at rest via connectorEncKey). Dormant until
  // both creds are set + connectorEncKey. Callback: <publicBaseUrl>/api/github/callback.
  githubOauthClientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
  githubOauthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
  // Google OAuth client (generic) — powers "Sign in with Google" now and the Google Workspace
  // connectors (Gmail / Calendar / Drive·Sheets) once Google verifies the consent screen. Login
  // (openid/email/profile) works immediately; the Workspace scopes are restricted → verification.
  // Login callback: <publicBaseUrl>/api/auth/google/callback. Dormant until both creds are set.
  googleOauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
  googleOauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  // Org prepaid wallet. Usage is always RECORDED (debited at run_finished). Enforcement (blocking
  // a run when the balance is exhausted) is OFF by default — observe-first during the BD pilot;
  // set WALLET_ENFORCE=true to hard-block at zero. Low-balance warning fires below this USD level.
  walletEnforce: process.env.WALLET_ENFORCE === 'true',
  walletLowUsd: Number(process.env.WALLET_LOW_USD || '2') || 2,
  // Ad-platform connector apps (each connector lights up only when its creds are set).
  // Meta: app_id + the Facebook-Login-for-Business configuration id are NOT secrets (the app_id
  // is public; the config_id just references a permissions/assets bundle) — baked as defaults so
  // the connector is wired without touching .env; META_APP_ID / META_CONFIG_ID override them.
  // The app SECRET is the only real credential and stays env-only (empty until set).
  metaAppId: process.env.META_APP_ID || '980303688203652',
  metaAppSecret: process.env.META_APP_SECRET || '',
  // When set, the OAuth authorize URL uses config_id (Facebook Login for Business) instead of scope.
  metaConfigId: process.env.META_CONFIG_ID || '2004716123621967',
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
  // Code-review gate (connected-repo work): after the verify gate goes green, a second-model
  // pass reads the session's git DIFF for correctness/regressions/security and bounded-revises.
  // ON by default; AGENT_CODE_REVIEW=false disables. codeReviewModel overrides the reviewer
  // model (empty = use the run's active model — keeps the brain swappable).
  codeReviewGate: process.env.AGENT_CODE_REVIEW !== 'false',
  codeReviewModel: process.env.CODE_REVIEW_MODEL || '',
  // Estimated cost of one code-review completion, added to the session cost bar.
  minimaxCodeReviewCost: Number(process.env.MINIMAX_CODE_REVIEW_COST || '0.006') || 0.006,
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
  maxIterations: intEnv('MAX_ITERATIONS', 500),
  // When true the agent's shell inherits the FULL process environment (so it
  // can use tokens like DIGITALOCEAN_TOKEN), the workspace path jail is lifted,
  // and file tools may touch paths outside the workspace. Open-ended / unsafe;
  // intended for trusted single-operator testing. Flip off to re-harden.
  agentUnrestricted: process.env.AGENT_UNRESTRICTED === 'true',
  workspaceTtlDays: intEnv('WORKSPACE_TTL_DAYS', 14),
  // --- Android APK builds (ephemeral DO build droplet) ---
  // The whole feature stays DORMANT (build_apk reports "not configured", no reaper)
  // until BOTH a DO API token and a baked Android-SDK snapshot id are provided.
  doApiToken: process.env.DO_API_TOKEN || process.env.DIGITALOCEAN_TOKEN || '',
  // PROTECTED PRODUCTION INFRA — the automated DO client must NEVER destroy/modify these.
  // The MASTER ArksAI droplet (this production app; id 577088981 / name "arksai" / IP
  // 159.89.172.210) and the baked Android-SDK snapshot. The DO client hard-refuses a destroy
  // targeting any of these by id OR name, so no code path (or AI-driven tool) can take the app
  // down. Overridable via env, but the live defaults make the guard correct out of the box.
  masterDropletId: process.env.MASTER_DROPLET_ID || '577088981',
  masterDropletName: process.env.MASTER_DROPLET_NAME || 'arksai',
  androidSnapshotId: process.env.ANDROID_SNAPSHOT_ID || '', // id of the pre-baked Android-SDK snapshot (see BUILD_BAKE.md)
  androidBuildRegion: process.env.ANDROID_BUILD_REGION || 'blr1',
  androidBuildSize: process.env.ANDROID_BUILD_SIZE || 's-8vcpu-16gb', // headroom for the Kotlin daemon on large RN apps
  androidBuildSshKeyId: process.env.ANDROID_BUILD_SSH_KEY_ID || '', // optional DO ssh key id added to the build droplet (for debugging)
  androidBuildTimeoutMs: intEnv('ANDROID_BUILD_TIMEOUT_MS', 35 * 60 * 1000), // hard cap; droplet destroyed on timeout (large RN apps + cold cache run long)
  androidBuildCost: Number(process.env.ANDROID_BUILD_COST || '0.12') || 0.12, // our infra cost per APK build (droplet-hour share)
  // On boot, auto-resume a run that a restart/deploy interrupted (so a deploy never loses an
  // in-flight build). Recency-windowed + crash-loop-guarded. AUTO_RESUME_RUNS=false to disable.
  autoResumeRuns: process.env.AUTO_RESUME_RUNS !== 'false',
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
    config.doApiToken,
    config.githubOauthClientSecret,
  ].filter((s) => s && s.length >= 6);
}
