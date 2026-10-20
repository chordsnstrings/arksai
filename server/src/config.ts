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
  // Design-brief compiler: for a VISUAL build, an upfront ModelArk pass rewrites the user's casual
  // request into an expert, art-directed build brief (concept/palette/type/layout/signature/
  // avoid) that the build then follows — the per-request "think first" step Claude does
  // internally. On by default (needs the ModelArk key); set DESIGN_BRIEF=0 to disable.
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
  // BytePlus ModelArk — the platform's single model provider. The key comes from ARK_API_KEY or,
  // with no SSH, from encrypted app_settings (POST /api/admin/providers/byteplus; byteplusRuntime).
  byteplusApiKey: process.env.ARK_API_KEY || '',
  // Pexels stock photography/footage (search_photos) — free key from pexels.com/api;
  // keyless CC fallbacks (Openverse/Wikimedia) keep the tool alive without it.
  pexelsApiKey: process.env.PEXELS_API_KEY || '',
  byteplusBaseUrl: process.env.BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
  // MEDIA (Seedream images + Seedance video) runs on the GENERAL endpoint, not the coding plan:
  // the coding plan answers images/generations with a non-JSON body (probed 2026-10-20).
  byteplusVideoBaseUrl: process.env.BYTEPLUS_VIDEO_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3',
  // Nominal cost estimates for the session cost bar (tune against real billing).
  seedanceDraftCost: Number(process.env.SEEDANCE_DRAFT_COST || '0.05') || 0.05,
  seedanceFinalCostPerSec: Number(process.env.SEEDANCE_FINAL_COST_PER_SEC || '0.08') || 0.08,
  // Per-K-video-token rate for story cost ESTIMATES (console June 2026: 1.5 ≈ $0.0012–0.0024/K;
  // mid default). The 2.0 rate rides the same knob until the console confirms a separate one.
  seedanceCostPerKTok: Number(process.env.SEEDANCE_COST_PER_KTOK || '0.0018') || 0.0018,
  // ── ModelArk is the ONLY model provider (every LLM lane, vision, images, video, embeddings).
  // Branded ArksAI id → concrete ModelArk model. The branded strings are stored in sessions,
  // projects and robots, so they stay stable; only what they resolve to changes. All of these
  // were verified callable on the coding-plan endpoint (2026-10-20, `models --verify`) and
  // stream tool calls. `thinking` sends {thinking:{type}} (omit = the model's default
  // reasoning); `effort` sends reasoning_effort ('low' bounds reasoning — verified honoured on
  // GLM-5.2 and DeepSeek-V4-Pro: ~half the reasoning tokens, same answer); `base` overrides the
  // endpoint for a model the coding plan doesn't serve.
  // Lane assignment = the 2026-10-20 BLIND bake-offs (round 1: 3 judges × 6 real ArksAI workloads;
  // round 2: reasoning settings). DeepSeek-V4-Pro won EVERY text workload — app build 8.3, report
  // 6.0, formula spreadsheet 6.8, bilingual UAE legal 6.8, chat routing 8.8 — vs Seed-2.0-Pro
  // 2.0–5.7 and GLM-5.2 1.0–6.5 (GLM's default reasoning ran 6 min without output). Round 2:
  // builds need DeepSeek's FULL reasoning (8.5; thinking-off 6.0, effort-low 5.75), spreadsheets do
  // best at effort-low (7.5; thinking-off 1.25 = broken models), chat routing is best thinking-off.
  // GLM-5.2 (effort low) and Seed 2.0 Pro are the DIFFERENT-model alternates the stall ladder uses.
  modelarkModels: {
    // Reports, legal, heavy chat — full reasoning.
    'arksai-max': { model: process.env.ARK_MAX_MODEL || 'deepseek-v4-pro-ga-260813' },
    // Quick lanes (conversational chat, light planning) — thinking off (chat-routing winner).
    'arksai-flash': { model: process.env.ARK_FLASH_MODEL || 'deepseek-v4-pro-ga-260813', thinking: 'disabled' },
    'arksai-swift': { model: process.env.ARK_SWIFT_MODEL || 'deepseek-v4-pro-ga-260813', thinking: 'disabled' },
    // Every code build — full reasoning.
    'arksai-heavy-glm51': { model: process.env.ARK_HEAVY_MODEL || 'deepseek-v4-pro-ga-260813' },
    // Spreadsheet/financial-model deliverables — bounded reasoning (round-2 winner).
    'arksai-heavy-ds4': { model: process.env.ARK_SHEET_MODEL || process.env.BYTEPLUS_DS4_MODEL || 'deepseek-v4-pro-ga-260813', effort: 'low' },
    // GLM-5.2 — alternate engine. Reasoning BOUNDED (its default reasoning runs away on big outputs).
    'arksai-heavy-glm': { model: process.env.ARK_GLM_MODEL || 'glm-5-2-260617', effort: 'low' },
    // Seed 2.0 Pro — alternate engine (fast, multimodal).
    'arksai-heavy-code': { model: process.env.ARK_SEED_MODEL || 'seed-2-0-pro-260328' },
    // Kimi-K2.5 is NOT on this key (probed) — the id stays valid for old rows but runs DeepSeek-V4-Pro.
    'arksai-heavy-kimi': { model: process.env.BYTEPLUS_KIMI_MODEL || 'deepseek-v4-pro-ga-260813' },
  } as Record<string, { model: string; base?: string; thinking?: 'enabled' | 'disabled'; effort?: 'minimal' | 'low' | 'medium' | 'high' }>,
  // Capability models. One-shot utility text (design brief, story planning, classification,
  // digests) → arkTextModel; SVG/code authoring → arkCoderModel — both DeepSeek-V4-Pro (bake-off
  // winner; one-shots run with thinking off → ~4s). Images → Seedream 5.0 Pro (min 921,600 px; ≤2.61 MP is the cheaper tier).
  // Embeddings (screenshot/video similarity checks) → Skylark vision embeddings (2048-dim).
  // Vision = Seed 2.1 Turbo: the blind bake-off's best design critic (7.5 vs Seed 2.0 Pro 6.2) and
  // 5/5 planted-defect recall with thinking off (~14s). NOT on the coding plan ("UnsupportedModel"),
  // so it runs on the general (pay-as-you-go) endpoint, ≈ $0.003 per check.
  arkVisionModel: process.env.ARK_VISION_MODEL || 'dola-seed-2-1-turbo-260628',
  arkVisionEndpoint: (process.env.ARK_VISION_ENDPOINT === 'coding' ? 'coding' : 'general') as 'coding' | 'general',
  arkTextModel: process.env.ARK_TEXT_MODEL || 'deepseek-v4-pro-ga-260813',
  arkCoderModel: process.env.ARK_CODER_MODEL || 'deepseek-v4-pro-ga-260813',
  arkImageModel: process.env.ARK_IMAGE_MODEL || 'dola-seedream-5-0-pro-260628',
  arkEmbedModel: process.env.ARK_EMBED_MODEL || 'skylark-embedding-vision-251215',
  // Concurrency caps (queue instead of 429): agent-loop streams, and one-shot vision/text calls
  // (the per-page deliverable gate fans out in parallel).
  arkMaxConcurrency: Math.max(1, Number(process.env.ARK_MAX_CONCURRENCY || '6') || 6),
  arkVisionConcurrency: Math.max(1, Number(process.env.ARK_VISION_CONCURRENCY || '4') || 4), // text/embed pools: ARK_TEXT_CONCURRENCY / ARK_EMBED_CONCURRENCY (engines/modelark)
  // Max time a one-shot call waits for a free slot before giving up (separate from its own
  // request deadline, so a long multi-page gate queues instead of silently skipping tail pages).
  arkQueueWaitMs: Math.max(1000, Number(process.env.ARK_QUEUE_WAIT_MS || '180000') || 180_000),
  // Per-call cost ESTIMATES for the session cost bar, from the official ModelArk price table
  // (2026-10-20). Vision/text compute the real figure from returned token usage when present
  // (engines/modelark ARK_PRICES); these are the fallbacks for replies without usage.
  arkVisionCost: Number(process.env.ARK_VISION_COST || '0.003') || 0.003,
  arkTextCost: Number(process.env.ARK_TEXT_COST || '0.004') || 0.004,
  // Seedream 5.0 Pro: $0.045 per image ≤2.61 MP (our size table stays under it), $0.09 above.
  arkImageCost: Number(process.env.ARK_IMAGE_COST || '0.045') || 0.045,
  // Skylark image embedding ≈ (w*h/784 tokens, capped at 1312) × $0.325/M ≈ $0.0004.
  arkEmbedCost: Number(process.env.ARK_EMBED_COST || '0.0005') || 0.0005,
  // Seedance USD per OUTPUT SECOND by branded model × resolution (official table 2026-10-20, no
  // video input; 1.5 = with native audio). Used for the session cost bar.
  seedanceCostPerSec: {
    // 2.5 is listed only up to 1080p (a 4K 2.5 final renders on 2.0 — see engines/seedance.ts
    // effectiveVideoModel). 1.5 accepts 4K but has no official row yet — videoCostEstimate
    // estimates it by pixel ratio (4× its 1080p rate).
    'arksai-video-25': { '480p': 0.103, '720p': 0.231, '1080p': 0.569 },
    'arksai-video-20': { '480p': 0.07, '720p': 0.15, '1080p': 0.37, '4k': 0.78 },
    'arksai-video-20-fast': { '480p': 0.07, '720p': 0.15, '1080p': 0.37, '4k': 0.78 },
    'arksai-video-15': { '480p': 0.024, '720p': 0.052, '1080p': 0.116 },
  } as Record<string, Record<string, number>>,
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
  // it's hashed to 32 bytes. Falls back to ENCRYPTION_KEY / APP_PASSWORD (the same at-rest key
  // the rest of the app uses) so connectors work without a dedicated env var — set a distinct
  // CONNECTOR_ENC_KEY only to rotate connector-token encryption independently. Empty → connectors
  // stay disabled (tokens are never stored in plaintext).
  connectorEncKey: process.env.CONNECTOR_ENC_KEY || process.env.ENCRYPTION_KEY || process.env.APP_PASSWORD || '',
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
  // Self-healing Phase 1 — nightly issue digest (detection + clustering, no auto-fix). Runs once
  // per this many hours; delivered in-app to the operator always + a webhook if set (falls back
  // to the analytics-digest webhook).
  issueDigestHours: intEnv('ISSUE_DIGEST_HOURS', 24),
  issueDigestWebhook: process.env.ISSUE_DIGEST_WEBHOOK || '',
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
  arkCodeReviewCost: Number(process.env.ARK_CODE_REVIEW_COST || '0.006') || 0.006,
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
  // The ark key may legitimately live only in app_settings (set via Admin → providers, loaded
  // AFTER this runs), so a missing env key is a warning here; index.ts re-checks after
  // loadByteplusRuntime() and logs loudly if ModelArk is still unconfigured.
  if (!config.byteplusApiKey) {
    console.warn('[config] ARK_API_KEY not set in env — expecting the ModelArk key from app_settings (Admin → providers).');
  }
  if (problems.length) {
    for (const p of problems) console.error(`[config] FATAL: ${p}`);
    process.exit(1);
  }
}

/** Secrets that only exist at runtime (e.g. the ModelArk key loaded from encrypted app_settings).
 *  Registered by their owners so secretValues() redacts them without an import cycle. */
const runtimeSecrets = new Set<string>();
export function registerRuntimeSecret(s: string): void {
  if (s) runtimeSecrets.add(s);
}

/** Env vars whose VALUE is a credential — redacted even when nothing reads them any more (e.g. a
 *  retired provider's key still sitting in /opt/arksai/.env, inherited by the agent shell). */
const SECRET_ENV_NAME = /(^|_)(API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASS)$/i;

/** Secret values that must never appear in tool output sent to the model/UI. */
export function secretValues(): string[] {
  return [
    config.githubToken,
    config.appPassword,
    config.serperApiKey,
    config.braveApiKey,
    config.sunoApiKey,
    config.byteplusApiKey,
    ...runtimeSecrets,
    config.analyticsDigestWebhook,
    config.issueDigestWebhook,
    config.metaAppSecret,
    config.googleAdsClientSecret,
    config.googleAdsDeveloperToken,
    config.tiktokClientSecret,
    config.connectorEncKey,
    config.doApiToken,
    config.githubOauthClientSecret,
    ...Object.entries(process.env)
      .filter(([name, v]) => SECRET_ENV_NAME.test(name) && typeof v === 'string' && v.length >= 12)
      .map(([, v]) => v as string),
  ].filter((s, i, all) => s && s.length >= 6 && all.indexOf(s) === i);
}
