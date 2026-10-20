import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { computeCost, KNOWN_MODELS, type SessionMeta, type SessionMode, type TimelineItem, type ToolCallRecord } from '../../../shared/types';
import { config } from '../config';
import { bus } from '../events/bus';
import * as store from '../sessions/store';
import { DEFAULT_ORG_ID, getOrgProfile, orgScope } from '../orgs/store';
import { diffStat, repoDir, sessionDiff } from '../sessions/workspace';
import { buildReviewPrompt, parseReviewVerdict } from './codeReview';
import { buildRepoPrimer } from './repoPrimer';
import { scrubSecrets } from '../lib/exec';
import { buildUploadNote } from '../lib/extract';
import { buildSystemPrompt } from './prompts';
import { getToolsForMode } from './tools';
import { _resetInspectCount } from './tools/inspect';
import { crawlSiteTool, saveOrgProfileTool } from './tools/onboarding';
import { extractPaletteTool } from './tools/palette';
import { track } from '../analytics/track';
import { ToolError, type ToolCtx } from './tools/common';
import { deriveTitle } from './titleGen';
import { recordIncident } from '../incidents/store';
import { makeThinkFilter } from './thinkFilter';
import { Usage, cacheSplit } from './usage';
import { checkLabel, detectStartCommand, needsExternalDb, verifyProject } from './verify';
import { probeApp } from './runtimeCheck';
import { isBlockingDefect } from './uiCheck';
import { checkDeliverable, deterministicDeliverableDefects, type DeliverableKind } from './deliverableCheck';
import { processRegistry } from './processes';
import { buildExportArchive, detectRenderable, looksLikeProject, startPreviewServer } from './canvasExport';
import { auditWebHygiene } from './webHygiene';
import { escalateModel, isChatSpreadsheetAsk, isSpreadsheetBrief, resolveProvider, selectModel, stallLadder } from './router';
import { classifyTask, type TaskProfile } from './taskProfile';
import { compileDesignBrief, designBriefBlock } from './designBrief';
import { isSimpleBuild, simpleBuildGuidance, simpleBuildNudge, SIMPLE_BUILD_NUDGE_AT } from './simpleBuild';
import { byteplusKey } from './byteplusRuntime';
import { modelarkReady, endpointFor, ARK_PRICES } from '../engines/modelark';
import { checkpointResumeNote, checkpointPlanGuidance, readCheckpoints, recordCheckpoint } from './checkpoint';
import { routeExpertise } from './expertiseRouter';
import { isAutoModel, MAX_MODEL, HEAVY_GLM51_MODEL, HEAVY_DS4_MODEL, phaseFloor, phaseCeiling, estimateRemainingSeconds, type ProgressPhase } from '../../../shared/types';
import { calibratedTypical, recordRunDurations } from './etaCalibration';
import { Semaphore } from '../lib/semaphore';
import { parseToolArgs } from '../lib/toolArgs';

const CONTEXT_TOKEN_BUDGET = 50_000; // generous headroom under every ModelArk lane's context window (≥128K)
const PREVIEW_CHARS = 700;
const MAX_DESIGN_ROUNDS = 2; // bounded internal design-critique iterations
const REPORT_MAX_DESIGN_ROUNDS = 2; // report mode: quality-first revise cap (deterministic pre-check keeps rounds cheap)
// Global concurrency limiter for ModelArk agent-loop streams: the plan's concurrency/RPM caps
// QUEUE excess turns instead of returning 429s. FIFO + abort-aware (lib/semaphore). Env-tunable
// via ARK_MAX_CONCURRENCY. Re-exported for the existing Semaphore unit tests.
export { Semaphore };
const arkLimiter = new Semaphore(config.arkMaxConcurrency);

// When a turn runs long (quality-first: we let the best model finish a big generation),
// the user should KNOW it's working — with a bit of personality, not a dry spinner. One
// of these is shown when a turn passes ~55s; they reassure (it's not stuck) AND smile.
const SLOW_LINES = [
  'Still cooking — this one’s a big batch. Good things, slow oven. 🍞',
  'Hang tight — the model’s doing real work back here, not thinking about lunch.',
  'Bigger build, bigger brain. Letting it finish properly beats rushing it.',
  'Still on it — lots of numbers and pixels being wrangled behind the scenes.',
  'Quality over quick: we’re building the good version, not the flimsy fast one.',
  'Deep in the zone. 🎧 Give it a beat — this is the worth-it kind of slow.',
  'Brewing something detailed. ☕ Large outputs take a moment; it’s not stuck.',
  'Working hard, not hardly working — a meaty build is in progress.',
  'Measuring twice, cutting once. Almost there in spirit.',
  'Still going strong — the careful pass takes a little longer, promise it’s alive.',
];

interface AccToolCall {
  id: string;
  name: string;
  args: string;
}

function estimateTokens(messages: unknown): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

const DELIVERABLE_GLOB =
  // Genuine user-facing outputs only. NOT `json` — it surfaced package.json / package-lock.json /
  // tsconfig / app.json etc. as "deliverables", which confused users (the submission should be the
  // thing they asked for, not project scaffolding). Compliance machine files kept (.sif WPS,
  // .xml PINT AE e-invoice; FAF is .csv). Scaffolding that still slips through a kept extension
  // (config .xml, icon .svg, files under build dirs) is filtered by isNoiseDeliverable below.
  '**/*.{xlsx,xls,csv,pdf,docx,doc,pptx,png,jpg,jpeg,svg,zip,tar,gz,tgz,tar.gz,mp3,wav,mp4,sif,xml}';

// A file can match a deliverable EXTENSION yet be project scaffolding (config, manifests, build
// output, the bundled UI kit, icon sprites) — never surface those as download chips. Pure + tested.
const NOISE_NAMES =
  /^(package(-lock)?\.json|.*\.config\.(json|xml|js|cjs|mjs|ts)|tsconfig.*\.json|jsconfig\.json|app\.json|manifest\.json|composer\.(json|lock)|angular\.json|nest-cli\.json|components\.json|pom\.xml|web\.config|androidmanifest\.xml|strings\.xml|colors\.xml|icons?\.svg|sprite\.svg|favicon\.(svg|png|ico))$/i;
const NOISE_PATH =
  /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.output|coverage|ui-kit|report-fonts|mobile-ui-kit|\.cache|vendor|\.expo)\//i;
export function isNoiseDeliverable(rel: string): boolean {
  return NOISE_NAMES.test(rel.split('/').pop() || '') || NOISE_PATH.test('/' + rel);
}

// Build INTERMEDIATES — assets generated only to be EMBEDDED into a primary deliverable (a deck,
// report or doc), never things the user would download on their own. Surfacing them buried the real
// deliverable under a pile of icon-/chart-/preview files (the user's "why so many?" complaint).
const INTERMEDIATE_ASSET =
  /^(icon[-_]\d+(?:[-_]\d+)?\.(?:png|jpe?g|webp|svg)|slide[-_]?chart[-_]?\d*\.(?:png|jpe?g|webp|svg)|chart[-_]?\d*\.(?:png|svg))$/i;
export function isIntermediateAsset(rel: string): boolean {
  const base = rel.split('/').pop() || '';
  if (INTERMEDIATE_ASSET.test(base)) return true; // rasterised icons / slide charts that get embedded
  if (/\.preview\.html?$/i.test(base)) return true; // the .pptx / artifact preview mirror
  if (/(^|\/)charts\//i.test('/' + rel)) return true; // render_chart SVGs inlined into a report
  return false;
}

// One deliverable can be rendered several times across revise rounds, each saved with a version
// suffix (deck.pdf · deck-v2.pdf · deck-v3.pdf) — show only the LATEST of each, not every round.
// Conservative: only collapses an explicit -v2 / _v2 / (2) / -final suffix on an OTHERWISE-IDENTICAL
// base+extension, so "report-2024.pdf" and "report-2025.pdf" (distinct) are never merged.
export function dedupeVersions<T extends { name: string }>(items: T[]): T[] {
  const info = (name: string) => {
    const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase();
    const stem = ext ? name.slice(0, name.length - ext.length) : name;
    const m = /^(.*?)[-_ ]*(?:v(\d+)|\((\d+)\)|final)$/i.exec(stem);
    if (m) return { base: (m[1] || stem).toLowerCase(), ext, v: m[2] || m[3] ? Number(m[2] || m[3]) : 1.5 };
    return { base: stem.toLowerCase(), ext, v: 1 };
  };
  const best = new Map<string, { it: T; v: number; i: number }>();
  items.forEach((it, i) => {
    const { base, ext, v } = info(it.name);
    const key = base + ext;
    const cur = best.get(key);
    if (!cur || v > cur.v || (v === cur.v && i > cur.i)) best.set(key, { it, v, i });
  });
  // Preserve original ordering of the survivors.
  const keep = new Set([...best.values()].map((x) => x.it));
  return items.filter((it) => keep.has(it));
}

// Shown inline to the user when the agent re-routes itself. Warm + action-framed —
// NOT "Switched to Build (Code) mode" jargon (the user never picks modes).
const MODE_SWITCH_LINE: Record<SessionMode, string> = {
  chat: 'Let’s talk this through.',
  plan: 'Let me map out a plan first.',
  code: 'Setting things up to build this.',
  report: 'Designing this as a polished report.',
};

// Warm, mode-aware copy when a thinking model burns its whole output budget reasoning
// and produces nothing (the terminal empty-turn case) — "nothing got built" is wrong for chat.
const EMPTY_BUDGET_MSG: Record<SessionMode, string> = {
  chat: 'That answer ran long and got cut off before it finished. Ask it a bit more narrowly and I’ll get you a clean, complete answer.',
  plan: 'The plan grew too long to finish in one pass. Tell me what matters most and I’ll lay out a tighter one.',
  code: 'That one turned out a bit too big to finish in a single pass, so nothing got built yet. Try a smaller, more specific ask — or split it into a couple of pieces — and I’ll take it from there.',
  report: 'That turned out a bit too big to finish in a single pass, so the document didn’t get made yet. Try a tighter scope — or split it — and I’ll take it from there.',
};

/** Document/binary files created or modified during a run → download chips in the chat. */
async function findDeliverables(repoDirPath: string, sinceTs: number): Promise<TimelineItem[]> {
  try {
    const matches = await fg(DELIVERABLE_GLOB, {
      cwd: repoDirPath,
      ignore: ['**/node_modules/**', '**/.git/**', 'uploads/**'],
      onlyFiles: true,
      suppressErrors: true,
    });
    const items: TimelineItem[] = [];
    for (const rel of matches.slice(0, 100)) {
      if (isNoiseDeliverable(rel)) continue; // scaffolding/config, not what the user asked for
      if (isIntermediateAsset(rel)) continue; // icons/charts/preview embedded into a real deliverable
      const stat = fs.statSync(path.join(repoDirPath, rel));
      if (stat.mtimeMs >= sinceTs) {
        items.push({
          kind: 'file',
          id: randomUUID(),
          path: rel,
          name: path.basename(rel),
          size: stat.size,
          ts: Date.now(),
        });
      }
    }
    // Collapse revise-round versions (deck.pdf · deck-v2.pdf · deck-v3.pdf) → keep only the latest.
    return dedupeVersions(items as Array<TimelineItem & { name: string }>);
  } catch {
    return [];
  }
}

/** Friendly "what I'm doing now" beats for the long build/report wait — emitted on
 *  each tool call while authoring so the progress label keeps moving (the bar nudges
 *  via emitProgress) instead of sitting on one line for minutes. */
const TOOL_BEAT: Record<string, string> = {
  render_chart: 'Drawing your charts…',
  add_fonts: 'Setting the typography…',
  render_report: 'Composing the pages…',
  generate_image: 'Designing an image…',
  see_image: 'Reviewing the visuals…',
  generate_spreadsheet: 'Building the spreadsheet…',
  generate_doc: 'Writing the document…',
  generate_pptx: 'Building the deck…',
  add_ui_kit: 'Setting up the design system…',
  extract_palette: 'Reading your brand colours…',
  write_file: 'Writing the code…',
  edit_file: 'Refining the build…',
  web_search: 'Researching…',
  web_fetch: 'Reading the sources…',
  fetch_data: 'Pulling your data…',
};

/** Pick the best freshly-produced document to auto-open in the canvas. */
function pickPreviewDoc(items: TimelineItem[]): { path: string; kind: 'pdf' | 'sheet' | 'doc' | 'image' } | null {
  const files = items.filter((i): i is Extract<TimelineItem, { kind: 'file' }> => i.kind === 'file');
  const last = (re: RegExp) => {
    const m = files.filter((f) => re.test(f.name));
    return m.length ? m[m.length - 1].path : null;
  };
  const pdf = last(/\.pdf$/i);
  if (pdf) return { path: pdf, kind: 'pdf' };
  const sheet = last(/\.(xlsx|xls|csv)$/i);
  if (sheet) return { path: sheet, kind: 'sheet' };
  const doc = last(/\.(docx|doc)$/i);
  if (doc) return { path: doc, kind: 'doc' };
  // A generated image/creative (ad, social, hero) is a first-class deliverable — give it
  // the same auto-open + "it's ready" reveal as a doc, not just a bare download chip.
  const img = last(/\.(png|jpe?g|webp)$/i);
  if (img) return { path: img, kind: 'image' };
  return null;
}

/** Transient network/provider failures worth retrying; never auth errors. */
export function isTransientApiError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 400) return false;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  // Inspect the wrapped cause too: undici reports a mid-stream socket drop as
  // `TypeError: terminated` with the real reason (ERR_STREAM_PREMATURE_CLOSE /
  // UND_ERR_SOCKET / ECONNRESET) on err.cause.
  const msg = `${err?.message ?? err} ${err?.code ?? ''} ${err?.cause?.code ?? ''} ${err?.cause?.message ?? ''}`;
  return /resolve|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|private\/reserved IP|premature close|premature_close|ERR_STREAM_PREMATURE_CLOSE|terminated|other side closed|UND_ERR/i.test(
    msg,
  );
}

// Tool calls that PRODUCE the deliverable. Once one of these has run, the raw research
// tool-results from EARLIER turns are no longer needed verbatim — their data is already
// baked into the rendered HTML/spec, and the QC/revise turns work off the rendered pages,
// not the scraped sources. So we stub those stale research dumps to stop re-paying for
// them on every subsequent turn (the ~820k-token report blowup).
const DELIVERABLE_PRODUCERS = new Set([
  'render_report',
  'generate_spreadsheet',
  'generate_doc',
  'generate_pptx',
  'render_chart',
]);
/** Did one of the last few assistant turns call generate_spreadsheet? PURE. */
export function madeSpreadsheetRecently(context: any[], lookback = 12): boolean {
  return context
    .slice(-lookback)
    .some((m) => m?.role === 'assistant' && (m.tool_calls || []).some((c: any) => c?.function?.name === 'generate_spreadsheet'));
}

// Tools whose RAW output is large research data, safe to stub once it's been used.
const RESEARCH_TOOLS = new Set(['web_search', 'web_fetch', 'fetch_data']);
const RESEARCH_STUB = '[research results — used in the report, trimmed to save context]';

/** Map every tool_call_id → the tool name that produced it (from assistant turns). */
function toolNameById(context: any[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const msg of context) {
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) if (tc?.id && tc.function?.name) m.set(tc.id, tc.function.name);
    }
  }
  return m;
}

/**
 * Once a deliverable has been produced, stub the RAW research tool-results from EARLIER
 * turns so they aren't re-sent at full size on every QC/revise turn. PURE + conservative:
 *  - only stubs tool messages whose producing tool was a RESEARCH tool (web_search/web_fetch/
 *    fetch_data) and whose body is large (>200 chars);
 *  - only stubs ones that appear BEFORE the most recent deliverable-producing tool call —
 *    so the report HTML/spec, the user's brief, the system prompt and recent turns are never
 *    touched. The report's actual content is fully preserved; this only drops scraped sources.
 * Returns true if anything was stubbed. Exported for testing.
 */
export function trimStaleResearch(context: any[]): boolean {
  const names = toolNameById(context);
  // Find the index of the LAST assistant turn that produced a deliverable.
  let lastDeliverableIdx = -1;
  for (let i = 0; i < context.length; i++) {
    const msg = context[i];
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      if (msg.tool_calls.some((tc: any) => DELIVERABLE_PRODUCERS.has(tc?.function?.name))) {
        lastDeliverableIdx = i;
      }
    }
  }
  if (lastDeliverableIdx < 0) return false; // no deliverable yet → keep all research verbatim
  let changed = false;
  for (let i = 0; i < lastDeliverableIdx; i++) {
    const msg = context[i];
    if (
      msg?.role === 'tool' &&
      typeof msg.content === 'string' &&
      msg.content.length > 200 &&
      msg.content !== RESEARCH_STUB &&
      RESEARCH_TOOLS.has(names.get(msg.tool_call_id) ?? '')
    ) {
      msg.content = RESEARCH_STUB;
      changed = true;
    }
  }
  return changed;
}

/**
 * Keep the context under the model window for long-running sessions:
 * first stub stale research dumps (already baked into the deliverable), then shrink
 * remaining old tool outputs, then drop the oldest messages entirely (long chats have
 * no tool output to shrink).
 */
function truncateContext(context: any[]) {
  // Always run the targeted research-trim first — it's the primary token sink for reports
  // (it makes the QC/revise turns cheap), and it's safe regardless of the total size.
  trimStaleResearch(context);
  if (estimateTokens(context) < CONTEXT_TOKEN_BUDGET) return;
  for (const msg of context) {
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 200) {
      msg.content = `[tool output elided to save context, was ${msg.content.length} chars]`;
      if (estimateTokens(context) < CONTEXT_TOKEN_BUDGET) return;
    }
  }
  while (estimateTokens(context) >= CONTEXT_TOKEN_BUDGET && context.length > 8) {
    context.shift();
    // never leave an orphaned tool reply at the front (breaks the API format)
    while (context.length > 0 && context[0].role === 'tool') context.shift();
  }
}

export class AgentRun {
  readonly runId = randomUUID();
  private abort = new AbortController();
  private usage = new Usage();
  private runningTasks = 0;
  private mutated = false; // did this run change files? (triggers the verify gate)
  private verifiedClean = false; // the CURRENT file state passed the verify+design gate (reset on any mutation)
  private wantsPublish = false; // the agent asked to publish a version that hasn't been reviewed yet
  private producedArtifact = false; // create_artifact ran → show the preview card, but NOT the verify gate
  private verifyRounds = 0;
  private designRounds = 0; // bounded gating design-critique rounds (separate budget)
  private selfAuditRounds = 0; // cheap pre-completion deterministic self-audit rounds (separate budget — does NOT touch verify/design caps)
  private reviewRounds = 0; // bounded code-review-gate rounds (connected-repo work)
  private reviewPassed = false; // once the diff is approved, don't re-review (avoids repeat cost)
  private didRuntimeTest = false; // did the agent curl a running server this run?
  private flowRequired = false; // have we already asked it to demo the flow?
  private engineCostUsd = 0; // external-engine spend this run (e.g. Suno)
  private accruedCostUsd = 0; // model spend this run, summed per concrete model
  private taskProfile!: TaskProfile; // classified at run start; drives design context + gating
  private compiledBrief: string | null = null; // per-request expert design brief (visual builds)
  private simpleBuild = false; // light-tier code build → the simple-build fast path (lean pipeline)
  private simpleNudged = false; // one-time "ship the simplest version" nudge already sent
  private autoExpertiseApplied = false; // true once the auto-router has set this.session.task (never overwrites a picked play)
  private progressPct = 0; // monotonic 0–100 for the live progress bar (never regresses)
  private progressPhase: ProgressPhase = 'understanding';
  private phaseStartedAt = Date.now(); // when the current phase began (for the time-remaining estimate)
  private phaseDurations: Partial<Record<ProgressPhase, number>> = {}; // real seconds per phase (for ETA self-calibration)
  private slowLineIdx = Math.floor(Math.random() * SLOW_LINES.length); // rotate the funny "still working" lines
  private lastSlowAt = 0; // cooldown so long multi-turn builds vary the line without spamming
  private pendingMode: SessionMode | null = null; // set by switch_mode; applied between tool batches
  private planSubmitted = false; // set by submit_plan; ends the turn awaiting the user's nod
  private planResolved = false; // this run answers a pending plan → plan→code is allowed
  private planApproved = false; // this run is the user's "Approve & build" → must build, not re-plan
  // Consecutive mid-stream silences (reset by any completed turn) — drives the engine stall ladder.
  private llmStalls = 0;
  // "tool::error-prefix" of the most recent failed tool call — the repeat-error circuit-breaker.
  private lastToolErrorSig = '';
  // A publish passed the full pre-launch review and is LIVE — the run's terminal state.
  // After this, no verify/design gate may reopen in this run (the TaskForge run kept
  // polish→republish→review cycling AFTER a clean publish until the loop guard parked it).
  private publishedClean = false;
  // The concrete model the orchestrator is using right now (resolved from the
  // session model, which may be the virtual 'arksai-auto').
  private activeModel = '';
  private activeApiModel = '';
  private activePricingId = '';
  private activeBase = ''; // per-lane endpoint override ('' = the coding-plan endpoint)
  private activeThinking: 'enabled' | 'disabled' | undefined = undefined;
  private activeEffort: 'minimal' | 'low' | 'medium' | 'high' | undefined = undefined;
  // One-pass doctrine machinery: wrapUp = the 60% budget notice fired (gates deliver-with-warnings
  // instead of opening new revision rounds); compactions = Claude-style auto-continue windows used
  // (a checkpointed build never dies asking the user for "continue" — it compacts and keeps going).
  private wrapUp = false;
  // The 85% hard order ("publish NOW") — the 60% notice alone let a finished app burn its
  // last 40% polishing a lint warning and die unpublished (the Kiln&Co break).
  private finalWrapNudge = false;
  // This conversation produced a spreadsheet in its recent turns (chat follow-ups stay on the sheets lane).
  private sheetContext = false;
  private compactions = 0;

  constructor(private session: SessionMeta) {}

  /** Point the run at a concrete model (resolving the ModelArk model id + lane settings). */
  private setActiveModel(modelId: string) {
    const r = resolveProvider(modelId);
    this.activeModel = modelId;
    this.activeApiModel = r.apiModel;
    this.activePricingId = r.pricingId;
    this.activeBase = r.baseUrl || '';
    this.activeThinking = r.thinking;
    this.activeEffort = r.effort;
  }

  /** Before switching engines mid-conversation, drop reasoning_content from the history: it's
   *  model-specific (GLM ↔ DeepSeek ↔ Seed) and a different model can reject it. The objects are
   *  shared with `context` (same refs), so this cleans both. */
  private dropReasoning(msgs: any[]) {
    for (const m of msgs ?? []) if (m && m.role === 'assistant' && 'reasoning_content' in m) delete m.reasoning_content;
  }

  interrupt() {
    this.abort.abort();
  }

  /**
   * Auto-expertise (Phase 1): when the user just typed and no department play set
   * session.task, deterministically infer the right expert standards from the trigger
   * tables and apply them for this run (and the rest of the session). NEVER overwrites
   * an explicit picked-play task. Gated on config.autoExpertise; chat/code/report only.
   * Logs the inferred {task, confidence, source} as analytics metadata (never message text).
   */
  private applyAutoExpertise(userText: string) {
    if (!config.autoExpertise) return;
    if (this.session.task) return; // an explicit play (or an already-applied inference) wins
    if (this.session.mode === 'plan') return; // plan is a gate, not a deliverable; routes on the build turn
    const route = routeExpertise(userText, this.session.mode);
    // Phase 4 — confidence tiers (gated on config.clarifyExpertise; flip OFF to revert):
    //   HIGH   → inject the SPECIFIC task expertise silently.
    //   MEDIUM → inject the DEPARTMENT PERSONA only (expert voice, no wrong task specifics).
    //   LOW/none → inject NOTHING; the chat prompt's vague-clarify path asks ONE question.
    // The router already enforces the mis-route guard (a specific taskKey is only ever
    // returned at tier 'high'), so this just maps the tier to what we set as session.task.
    let inferred: string | null;
    if (config.clarifyExpertise) {
      if (route.tier === 'high') inferred = route.taskKey; // a confident specific task
      else if (route.tier === 'medium') inferred = route.department; // persona only
      else inferred = null; // low/none → leave it to vague-clarify; never guess
    } else {
      // Legacy behaviour (flag off): apply whatever the router surfaced.
      inferred = route.taskKey ?? route.department;
    }
    if (!inferred) return;
    this.session.task = inferred; // in-memory for this session object → survives turns + switch_mode
    this.autoExpertiseApplied = true;
    // Persist so a fresh runner (a later turn) keeps the expertise without re-routing.
    void store.updateSession(this.session.id, { task: inferred }).catch(() => {});
    track('expertise_selected', {
      orgId: this.session.orgId,
      userId: (this.session as any).createdBy ?? null,
      sessionId: this.session.id,
      props: { task: inferred, confidence: route.confidence, tier: route.tier, source: route.source },
    });
  }

  /**
   * Emit a live progress beat. The bar advertises the (deliberately visible)
   * expert work at each stage. pct is clamped monotonic: entering a phase snaps
   * up to its floor; finer beats within a phase nudge toward its ceiling — but it
   * never goes backward (a self-healing retry must read as forward motion).
   */
  private emitProgress(phase: ProgressPhase, label: string, detail?: string) {
    // Reset the phase clock when we actually move to a new phase, so the ETA measures
    // elapsed-in-THIS-phase (not the whole run). Record the phase we're leaving so its REAL
    // duration can self-calibrate future estimates (summed — a phase can recur across rounds).
    if (phase !== this.progressPhase) {
      const spent = (Date.now() - this.phaseStartedAt) / 1000;
      this.phaseDurations[this.progressPhase] = (this.phaseDurations[this.progressPhase] ?? 0) + spent;
      this.phaseStartedAt = Date.now();
    }
    this.progressPhase = phase;
    const floor = phaseFloor(phase);
    const ceil = phaseCeiling(phase);
    // Nudge a little past the current value within the band, capped at the ceiling.
    const target = Math.min(ceil, Math.max(floor, this.progressPct + 2));
    this.progressPct = Math.max(this.progressPct, target);
    const elapsedInPhase = (Date.now() - this.phaseStartedAt) / 1000;
    const etaSeconds = estimateRemainingSeconds(
      phase,
      elapsedInPhase,
      this.session.mode,
      // As specific as history allows: this mode + this kind of task (e.g.
      // code::finance.cashflow), falling back to the per-mode aggregate.
      calibratedTypical(this.session.mode, this.session.task),
    );
    this.emit({ type: 'progress', phase, label, pct: Math.round(this.progressPct), detail, etaSeconds });
  }

  private emit(event: Parameters<typeof bus.emit>[1]) {
    bus.emit(this.session.id, event);
  }

  /** A stronger lane the current mode demands, or null. Any THINKING-OFF lane (Flash, Swift — e.g.
   *  pinned by the user) is floored for work the bake-off showed it can't do: reports → Max, every
   *  build → the heavy coder (thinking-off scored 6.0 vs 8.5), spreadsheets → the bounded-reasoning
   *  lane (thinking-off produced broken models, 1.25/10) in ANY mode — chat makes them directly
   *  with generate_spreadsheet. Other chat stays on the quick lane. */
  private floorModel(userText = ''): string | null {
    if (resolveProvider(this.activeModel).thinking !== 'disabled') return null;
    if (this.session.mode === 'report') return MAX_MODEL;
    // Chat: an explicit spreadsheet ask, or ANY follow-up once this conversation has made one
    // ("now change the growth rate to 8%" re-runs generate_spreadsheet with no keyword).
    const sheet = this.session.mode === 'chat' ? isChatSpreadsheetAsk(userText) || this.sheetContext : isSpreadsheetBrief(userText);
    if (sheet) return HEAVY_DS4_MODEL;
    if (this.session.mode === 'code') return HEAVY_GLM51_MODEL;
    return null;
  }

  /** One rung of the engine stall ladder, per silent stream since the last COMPLETED turn: retry
   *  the same model (a stall is usually a transient serving hiccup) → switch to a DIFFERENT
   *  ModelArk model (router.stallLadder) → retry it → a third model → give up honestly. */
  private stallStep(context: any[]): 'retry' | 'switch' | 'give-up' {
    this.llmStalls++;
    if (this.llmStalls === 1 || this.llmStalls === 3) return 'retry';
    const alt = stallLadder(this.activeModel)[0];
    if (this.llmStalls <= 4 && alt) {
      this.dropReasoning(context); // reasoning fields are model-specific — clean before switching
      this.setActiveModel(alt);
      return 'switch';
    }
    return 'give-up';
  }

  /** Pick the engine for the current mode: auto-route by complexity (Auto mode),
   *  then apply the per-mode floor. Called at run start and after a mode switch. */
  private routeModel(userText: string, sys: (text: string) => void) {
    if (isAutoModel(this.session.model)) {
      const pick = selectModel(userText, this.session.mode);
      this.setActiveModel(pick.model);
      sys(`↳ Auto-routed to ${pick.reason}`);
    } else {
      this.setActiveModel(this.session.model);
    }
    const floor = this.floorModel(userText);
    if (floor && floor !== this.activeModel) {
      this.setActiveModel(floor);
      const why =
        floor === HEAVY_DS4_MODEL
          ? 'Spreadsheet models use the careful-reasoning engine'
          : this.session.mode === 'report'
            ? 'Reports use the deeper-reasoning engine'
            : 'Builds use the deeper-reasoning engine';
      sys(`↳ ${why} — switched to ${KNOWN_MODELS[floor]?.label ?? 'ArksAI Max'}.`);
    }
  }

  /** Inject a note so the text-only agent AUTOMATICALLY knows the user uploaded
   *  file(s) this turn and uses them — images via see_image, office/data files via
   *  their extracted sidecar, anything else via read_file. Only recent uploads, so
   *  old ones don't nag, and the derived ".extracted.txt" sidecars are skipped. */
  private noteRecentUploads(dir: string, context: any[], paletteAvailable: boolean) {
    try {
      const upDir = path.join(dir, 'uploads');
      if (!fs.existsSync(upDir)) return;
      const cutoff = Date.now() - 20 * 60_000;
      const files = fs
        .readdirSync(upDir)
        .filter((f) => !f.endsWith('.extracted.txt'))
        .map((f) => {
          try {
            const st = fs.statSync(path.join(upDir, f));
            return st.isFile() && st.mtimeMs >= cutoff ? { f, m: st.mtimeMs } : null;
          } catch {
            return null;
          }
        })
        .filter((x): x is { f: string; m: number } => !!x)
        .sort((a, b) => b.m - a.m) // most-recent first so a big multi-file upload isn't truncated
        .slice(0, 60) // headroom for several PDFs + their per-page renders
        .map((x) => `uploads/${x.f}`);
      const note = buildUploadNote(files, modelarkReady(), paletteAvailable);
      if (note) context.push({ role: 'user', content: note });
    } catch {
      /* uploads scan is best-effort */
    }
  }

  async run(userText: string): Promise<void> {
    const sessionId = this.session.id;
    const dir = repoDir(sessionId);
    _resetInspectCount(sessionId); // fresh inspect-loop budget for each run (don't leak across turns)
    // Reassignable: the agent can switch_mode mid-run, which reloads the toolset,
    // system prompt, and engine for the new mode.
    let { schemas, map } = getToolsForMode(this.session.mode);
    this.addOnboardingTools(schemas, map); // only when this is an org-onboarding session
    const liveItems: TimelineItem[] = [];
    let finalStatus: SessionMeta['status'] = 'done';
    const sysInfo = (text: string) => {
      const item: TimelineItem = { kind: 'system', id: randomUUID(), level: 'info', text, ts: Date.now() };
      liveItems.push(item);
      this.emit({ type: 'timeline_item', item });
    };

    // Anything emitted before this run (e.g. uploads) is already persisted to
    // the timeline — drop it from the replay buffer so reconnects don't dupe.
    bus.clear(sessionId);
    await store.updateSession(sessionId, { status: 'running' });
    const startMeta = (await store.getSession(sessionId))!;
    bus.sessionChanged(startMeta);
    // LIVE PROGRESS: tokens + timeline were only persisted at run END, so GET /api/sessions/:id
    // (and any in-app telemetry that reads it) showed a stale pre-run state mid-build — the bug
    // that made a thriving run look "stalled". We now flush incrementally at each turn boundary.
    const baseTok = {
      t: startMeta.totalTokens ?? 0,
      p: startMeta.promptTokens ?? 0,
      c: startMeta.completionTokens ?? 0,
      cost: startMeta.costUsd ?? 0,
    };
    let persisted = 0; // how many liveItems are already written to the DB
    const flushLive = async () => {
      try {
        for (; persisted < liveItems.length; persisted++) await store.appendTimeline(sessionId, liveItems[persisted]);
        await store.updateSession(sessionId, {
          totalTokens: baseTok.t + this.usage.totalTokens,
          promptTokens: baseTok.p + this.usage.promptTokens,
          completionTokens: baseTok.c + this.usage.completionTokens,
          costUsd: baseTok.cost + this.accruedCostUsd + this.engineCostUsd,
        });
      } catch {
        /* best-effort live persistence — never block the run */
      }
    };
    this.emit({ type: 'run_started', runId: this.runId, mode: this.session.mode });
    this.progressPct = 0;
    this.emitProgress('understanding', 'Understanding your request…');

    const context = await store.getContext(sessionId);
    this.sheetContext = madeSpreadsheetRecently(context);
    context.push({ role: 'user', content: userText });

    // Plan gate: if the previous turn presented a plan and parked the session awaiting
    // the user, THIS run is their response — clear the flag (the card disappears) and
    // unlock plan→code so an approval can proceed to the build.
    this.planResolved = this.session.awaitingPlan === true;
    // The "Approve & build" button sends this canonical message. When it's the response to a
    // pending plan, this run is a definite GO: the agent must build, NOT re-submit the plan
    // (re-submitting re-parks awaitingPlan → the card reappears and nothing builds — the
    // operator's "approve & build doesn't start building" bug, esp. when the plan ended with
    // an open question). submit_plan is blocked this run; switch_mode('code') is unlocked.
    this.planApproved = this.planResolved && /\bbuild it now\b/i.test(userText);
    if (this.session.awaitingPlan) {
      this.session.awaitingPlan = false;
      await store.setAwaitingPlan(sessionId, false).catch(() => {});
      this.emit({ type: 'session_meta_updated', meta: { id: sessionId, awaitingPlan: false } });
    }

    // Make UPLOADED FILES visible to the text-only agent: it can't see an image and
    // won't notice a freshly-dropped CSV/PDF/doc, so tell it exactly what was just
    // uploaded and how to open each — so it acts WITHOUT the user re-instructing.
    this.noteRecentUploads(dir, context, map.has('extract_palette'));

    // Classify the task once → drives the design context, gating visual QC, and
    // the quality model floor.
    this.taskProfile = classifyTask(userText, this.session.mode);

    // Auto-expertise (Phase 1): if the user just TYPED (no department play picked →
    // session.task falsy), deterministically select the right expert standards from the
    // trigger tables so expertiseFor (inside buildSystemPrompt) injects them. A picked
    // play (an explicit task) ALWAYS wins and is never overwritten. The inferred task is
    // stored on the session object so it survives subsequent turns + a switch_mode.
    this.applyAutoExpertise(userText);

    // Memory: global (every session) + this repo's project memory + an optional
    // ARKS.md in the workspace. Kept around so a mode switch can rebuild the prompt.
    let memoryBlock = await this.loadMemoryBlock(dir);
    let systemContent = buildSystemPrompt(this.session, dir, memoryBlock, this.taskProfile, userText);

    // Simple-build fast path: a light-tier code build stays lean — inject anti-over-engineering
    // guidance now, and cap design rounds + nudge to ship (below). Keeps a small ask small + fast.
    this.simpleBuild = config.simpleFastPath && isSimpleBuild(this.taskProfile, this.session.mode);
    if (this.simpleBuild) systemContent += `\n\n${simpleBuildGuidance()}`;

    // Phase 4 (checkpointed long builds): resume a build that has prior checkpoints (so finished
    // work isn't redone), else steer a fresh LARGE build to proceed in durable, resumable tasks.
    if (config.checkpointBuilds && this.session.mode === 'code') {
      const resume = checkpointResumeNote(dir);
      if (resume) systemContent += resume;
      // Standard AND heavy builds get durable steps by default (the $6 Kanban run was heavy but
      // never checkpointed and died with no durable state; only trivial/light builds skip this).
      else if (this.taskProfile?.tier !== 'light' && !this.simpleBuild) systemContent += `\n\n${checkpointPlanGuidance()}`;
      // A resumed build shows its completed-steps trail in the UI from the first second.
      this.emitCheckpoints(dir);
    }

    // Design-brief compiler: for a VISUAL build, rewrite the user's casual request into an expert
    // art-directed brief UP FRONT (one bounded ModelArk pass) and inject it — the per-request "think
    // first" step Claude does internally, the piece Auto-Brief deliberately leaves to visual work.
    // Fail-open: returns null on key-off/error/timeout and the build proceeds unchanged. Computed
    // once and re-applied across a mode switch so we never pay for it twice.
    if (this.taskProfile?.isVisual) {
      this.emit({ type: 'progress', phase: 'understanding', label: 'Shaping the design brief', pct: 4 });
      this.compiledBrief = await compileDesignBrief(userText, this.taskProfile, this.abort.signal);
      if (this.compiledBrief) systemContent += designBriefBlock(this.compiledBrief);
    }

    if (this.session.title === 'New session') {
      void this.generateTitleAsync(userText);
    }

    // Resolve the model for this run (auto-route by complexity + per-mode floors).
    this.routeModel(userText, sysInfo);

    const ticker = setInterval(() => {
      this.emit({
        type: 'tick',
        elapsedSeconds: this.usage.elapsedSeconds,
        runningTasks: Math.max(1, this.runningTasks),
      });
    }, 1000);

    const buildLabel =
      this.session.mode === 'report'
        ? 'Designing your report…'
        : this.session.mode === 'code'
          ? 'Building it…'
          : 'Working on it…';
    this.emitProgress('building', buildLabel);

    try {
      const maxIterations = config.maxIterations;
      // Hard per-run TOKEN budget — the LAST-RESORT backstop against a runaway that escapes
      // the real loop guards (the content-idle deadline, the STALL signature guard, and the
      // HEAVY_RETRY publish cap). Those now catch the actual runaway patterns, so this raw
      // ceiling must sit FAR above any legitimate build — a thorough multi-section site
      // (dozens of edits + an icons.svg + verify + publish) legitimately runs into the
      // millions of tokens, and it MUST finish in one run (no "continue"): unless the run
      // errored or genuinely looped, the user gets the complete result in one click.
      // 5M ≈ a generous backstop; env-overridable for true pathological cases.
      const maxRunTokens = Number(process.env.MAX_RUN_TOKENS || '5000000') || 5_000_000;
      const STALL_LIMIT = 6;
      const EMPTY_RETRY_LIMIT = 2; // a thinking model that truncates mid-reasoning gets a couple of nudged retries
      const STREAM_RETRY_LIMIT = 2; // a connection dropped MID-response (premature close) gets a couple of fresh retries
      // Anti-thrash backstop: a heavy, externally-validated op (publishing) re-attempted
      // beyond this in ONE run is the runaway the signature guard misses (the agent narrates
      // between attempts, so the empty-text stall sig never trips). Bounds the publish loop
      // that previously ran into the budget cutoff repeatedly. Legitimate publish→fix→
      // republish is 2–3; 4+ is thrash.
      const HEAVY_RETRY_LIMIT = 4;
      const HEAVY_RETRY_TOOLS = new Set(['publish_app']);
      const heavyRetryCalls = new Map<string, number>();
      let stallSig = '';
      let stallCount = 0;
      let emptyRetries = 0;
      let streamRetries = 0;
      let iteration = 0;
      // Claude-style auto-continue: a checkpointed build gets fresh budget WINDOWS instead of a
      // death sentence — on window exhaustion the context is COMPACTED to the checkpoint ledger +
      // remaining work, and the run continues by itself. The user never types "continue".
      const MAX_AUTO_WINDOWS = Number(process.env.AUTO_CONTINUE_WINDOWS || '2') || 2;
      let stopReason: 'natural' | 'ceiling' | 'stall' | 'budget' | null = null;
      while (!this.abort.signal.aborted) {
        iteration++;
        if (iteration > maxIterations) {
          stopReason = 'ceiling';
          break;
        }
        const windowBase = this.compactions * maxRunTokens;
        // FINISH-BEFORE-STOP: at 60% of the current window, tell the model ONCE to land the plane —
        // finish the current fix, check once, deliver. Gates also honor this.wrapUp by delivering
        // with warnings instead of opening NEW revision rounds (the notice alone proved toothless).
        if (!this.wrapUp && this.usage.totalTokens > windowBase + maxRunTokens * 0.6) {
          this.wrapUp = true;
          sysInfo('⏳ Long run — wrapping up to deliver.');
          context.push({
            role: 'user',
            content:
              'BUDGET NOTICE — WRAP UP NOW. This run has used most of its processing budget. Finish ONLY the fix you are ' +
              'currently on, run your check ONCE, then DELIVER the working result immediately. Do not start any new ' +
              'improvement, inspection, or polish. If a known minor issue remains, state it in one line instead of fixing it.',
          });
        }
        // 85%: the hard order. The 60% notice proved too soft — a finished app burned its last
        // 40% polishing a lint warning and died UNPUBLISHED. Past here, delivery is the only
        // permitted work: publish (for an app) or hand over what exists, in this turn.
        if (!this.finalWrapNudge && this.usage.totalTokens > windowBase + maxRunTokens * 0.85) {
          this.finalWrapNudge = true;
          sysInfo('⏳ Budget nearly exhausted — delivering now.');
          context.push({
            role: 'user',
            content:
              '[SYSTEM] FINAL BUDGET WARNING — DELIVER IMMEDIATELY, THIS TURN. If this is an app and it is not yet ' +
              'published, run the production build if needed and call publish_app NOW, then end with the live URL. ' +
              'For any other deliverable, hand over what exists now. Every remaining fix or polish item is FORFEIT — ' +
              'note known minor issues in one line instead of touching them. Any tool call that is not build/publish/' +
              'final-answer is a violation of this order.',
          });
        }
        if (this.usage.totalTokens > windowBase + maxRunTokens) {
          // AUTO-CONTINUE: exhaustion means "compact and keep going", not "die mid-fix and wait
          // for a human to type continue". Checkpoints are the ideal resume state, but a MUTATED
          // code workspace is durable state too — the Kiln&Co break was exactly this: app built,
          // zero checkpoints (no gate pass yet), cap hit → the run died one publish call short
          // and a HUMAN had to type "continue". Never again: any mutated code build continues.
          const cps = this.session.mode === 'code' && config.checkpointBuilds ? readCheckpoints(dir) : [];
          const workspaceDurable = this.session.mode === 'code' && this.mutated;
          if ((cps.length || workspaceDurable) && this.compactions < MAX_AUTO_WINDOWS) {
            this.compactions++;
            this.wrapUp = false;
            this.finalWrapNudge = false;
            sysInfo(
              cps.length
                ? `♻ Auto-continuing from checkpoint ${cps.length} — compacted the context to keep going (window ${this.compactions + 1}/${MAX_AUTO_WINDOWS + 1}).`
                : `♻ Auto-continuing — compacted the context to finish and deliver (window ${this.compactions + 1}/${MAX_AUTO_WINDOWS + 1}).`,
            );
            const resume = checkpointResumeNote(dir);
            context.length = 0;
            context.push({
              role: 'user',
              content:
                `${userText}\n\n(You are CONTINUING this build after an automatic context compaction — the earlier conversation was dropped to free budget; the workspace${cps.length ? ' and its git checkpoints are' : ' is'} fully intact.)${resume}\n\n` +
                `Finish the REMAINING work only: inspect the workspace to see its current state, complete what's missing, verify ONCE, and deliver. Do NOT rebuild anything already done. ` +
                `If the app is already BUILT and working, your ONLY remaining steps are: build once if needed → publish_app → end with the live URL. No polish.`,
            });
            continue;
          }
          stopReason = 'budget';
          break;
        }
        // Simple-build fast path: if a small ask is clearly over-building, nudge it to ship ONCE.
        if (this.simpleBuild && !this.simpleNudged && iteration > SIMPLE_BUILD_NUDGE_AT) {
          this.simpleNudged = true;
          context.push({ role: 'user', content: simpleBuildNudge() });
        }
        truncateContext(context);
        await flushLive(); // persist prior turn's items + running token/cost totals (live progress)

        let text = '';
        let reasoning = ''; // reasoning_content — echoed back next turn so multi-turn tool use on reasoning models doesn't 400
        let finishReason = ''; // 'stop' | 'length' | 'tool_calls' — 'length' on an empty turn means reasoning truncated the answer
        const toolCalls: AccToolCall[] = [];
        // Strip any inline <think>…</think> from the visible stream (inline reasoning).
        const stripThink = makeThinkFilter();

        try {
        const stream = await this.createCompletionWithRetry({
          model: this.activeApiModel,
          messages: [
            { role: 'system', content: systemContent },
            ...context,
          ],
          tools: schemas.length ? (schemas as any) : undefined,
          stream: true,
          stream_options: { include_usage: true },
        });
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta: any = choice?.delta;
          if (delta?.reasoning_content) reasoning += delta.reasoning_content;
          if (delta?.content) {
            const visible = stripThink(delta.content);
            if (visible) {
              text += visible;
              this.emit({ type: 'assistant_delta', runId: this.runId, text: visible });
            }
          }
          for (const tc of delta?.tool_calls ?? []) {
            const slot = (toolCalls[tc.index] ??= { id: '', name: '', args: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
          if (chunk.usage) this.accrueUsage(chunk.usage);
        }
        // The turn streamed to completion — the engine is healthy again, so a later silence
        // starts a fresh stall ladder (only CONSECUTIVE stalls count toward giving up).
        this.llmStalls = 0;
        } catch (err: any) {
          // The engine went silent mid-stream. Nothing is committed to the context until a turn
          // completes, so RECOVER instead of dying — a checkpointed build must never be killed by
          // one silent stream (this exact error killed the TaskForge run). See stallStep.
          if (err?.llmStall && !this.abort.signal.aborted) {
            this.emit({ type: 'turn_reset', runId: this.runId });
            const step = this.stallStep(context);
            if (step === 'retry') {
              sysInfo('↳ The engine went quiet — retrying that step.');
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }
            if (step === 'switch') {
              sysInfo('↳ Still quiet — switching engines to keep the build moving.');
              continue;
            }
            // 5+ consecutive stalls across several engines → genuinely stuck; fall through to the terminal error.
          }
          // The connection dropped mid-reply (a "premature close" / terminated socket).
          // Nothing is committed to the context until a turn completes, so redo the turn
          // (bounded) instead of failing the run. turn_reset clears any partial output so
          // the retry renders cleanly with no doubled text.
          if (isTransientApiError(err) && !this.abort.signal.aborted && streamRetries < STREAM_RETRY_LIMIT) {
            streamRetries++;
            this.emit({ type: 'turn_reset', runId: this.runId });
            sysInfo(`↳ The connection dropped — reconnecting (${streamRetries}/${STREAM_RETRY_LIMIT}).`);
            await new Promise((r) => setTimeout(r, 400 * streamRetries));
            continue;
          }
          throw err;
        }
        const tail = stripThink.flush();
        if (tail) {
          text += tail;
          this.emit({ type: 'assistant_delta', runId: this.runId, text: tail });
        }

        const calls = toolCalls.filter(Boolean);
        if (text.trim()) {
          const messageId = randomUUID();
          this.emit({ type: 'assistant_message_done', runId: this.runId, messageId });
          liveItems.push({ kind: 'assistant', id: messageId, text, ts: Date.now() });
        }
        context.push({
          role: 'assistant',
          content: text || null,
          // Echo the model's reasoning back into history — reasoning models need it for multi-turn tool use.
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(calls.length
            ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: c.args },
                })),
              }
            : {}),
        });

        if (calls.length === 0) {
          // Empty turn from a thinking model: it spent the whole output budget reasoning and
          // got cut off (finish_reason 'length') before emitting any content or tool call.
          // Silently ending here finishes the run with nothing built (the spreadsheet-task
          // failure). Don't: nudge it to be concise and act, then retry — bounded.
          if (!text.trim() && finishReason === 'length' && emptyRetries < EMPTY_RETRY_LIMIT && !this.abort.signal.aborted) {
            emptyRetries++;
            context.push({
              role: 'user',
              content:
                'Your previous response was cut off before you produced any answer or tool call — your internal reasoning used the entire output budget. Keep reasoning brief and decisive, then immediately call the appropriate tool to build the deliverable.',
            });
            sysInfo(`↳ Response was truncated mid-thought — retrying (${emptyRetries}/${EMPTY_RETRY_LIMIT}).`);
            continue;
          }
          // Retries exhausted but the turn is STILL empty + truncated: surface it as an error
          // rather than reporting a silent "done" with nothing built (the worst outcome).
          if (!text.trim() && finishReason === 'length' && !this.abort.signal.aborted) {
            finalStatus = 'error';
            const msg = EMPTY_BUDGET_MSG[this.session.mode] ?? EMPTY_BUDGET_MSG.code;
            this.emit({ type: 'run_error', runId: this.runId, message: msg });
            liveItems.push({ kind: 'system', id: randomUUID(), level: 'error', text: msg, ts: Date.now() });
            stopReason = 'natural';
            break;
          }
          // SILENT MID-WORK DEATH (live bug class, three occurrences on arksai.studio): the
          // model ANNOUNCES its next action and stops — "Now retake scene 2:" then nothing —
          // or returns a fully EMPTY 'stop' turn. Neither is ever a valid completion, and a
          // human typing "Continue:" recovered every case. Do that nudge automatically,
          // bounded by the same retry counter as the truncation class.
          {
            const trimmed = text.trim();
            const announcedThenStopped = /:\s*$/.test(trimmed); // a colon-terminated turn promised content/action that never came
            if ((!trimmed || announcedThenStopped) && emptyRetries < EMPTY_RETRY_LIMIT && !this.abort.signal.aborted) {
              emptyRetries++;
              context.push({
                role: 'user',
                content: trimmed
                  ? 'Continue: your last message announced the next action ("…:") but the turn ended without doing it. Pick up exactly where you left off and CALL THE TOOL now — do not re-plan, do not start over.'
                  : 'Continue: your previous turn was completely empty — no answer, no tool call. Pick up exactly where you left off and act.',
              });
              sysInfo(`↳ Turn ended mid-work — auto-continuing (${emptyRetries}/${EMPTY_RETRY_LIMIT}).`);
              continue;
            }
          }
          // Cheap pre-completion self-audit (first-try correctness): run the deterministic,
          // model-free defect checks BEFORE the expensive gate so the agent fixes a known-bad
          // result in-context (no vision call, no full re-loop). Bounded by its own counter.
          if (this.mutated && !this.abort.signal.aborted) {
            const audit = await this.runCheapSelfAudit(dir, liveItems, context);
            if (audit === 'retry') continue;
          }
          // Completion gate: in Code mode, don't finish on unverified changes —
          // run the project's checks and, if they fail, keep fixing. Skip when the
          // current state already passed the gate (e.g. the review-before-publish path
          // ran it), so we never double-review the same files.
          if (this.session.mode === 'code' && this.mutated && !this.verifiedClean && !this.abort.signal.aborted) {
            const gate = await this.runVerifyGate(dir, liveItems, context);
            if (gate === 'retry') continue;
            if (gate === 'failed') {
              finalStatus = 'error';
              stopReason = 'natural';
              break;
            }
            if (gate === 'ok') this.verifiedClean = true;
          }
          // Report mode: auto-render + design-review the produced pages and bounded-revise
          // (the gate that replaces manual see_image so quality is guaranteed, not optional).
          if (this.session.mode === 'report' && this.mutated && !this.abort.signal.aborted) {
            const gate = await this.runReportGate(dir, liveItems, context);
            if (gate === 'retry') continue;
          }
          stopReason = 'natural'; // task done, or the model is awaiting the user
          break;
        }

        const groupRecords: ToolCallRecord[] = [];
        for (const call of calls) {
          if (this.abort.signal.aborted) break;
          let result = await this.executeTool(call, map, dir, groupRecords);
          // Published + green = DONE. A clean, review-passed publish is the terminal state of a
          // build run — deliver the link and stop; never re-open checks/polish on a shipped app.
          if (call.name === 'publish_app' && result.startsWith('Published live at')) {
            this.publishedClean = true;
            this.verifiedClean = true;
            result +=
              '\n\n[SYSTEM] The build is DELIVERED — this publish passed the full pre-launch review. Give the user the URL and END the run NOW. Do not run more checks, make more edits, or publish again in this run; if you want polish ideas, mention them as optional notes.';
          }
          // Repeat-error circuit-breaker: the SAME tool failing with the SAME error means the
          // diagnosis is wrong, not the luck — models (all of them, in the 2026-07-02 judgment
          // bake-off) only reliably stop when the repetition is pointed out in the result itself.
          if (/^Error[:\s]/i.test(result)) {
            const sig = `${call.name}::${result.slice(0, 160)}`;
            if (sig === this.lastToolErrorSig) {
              result +=
                '\n\n[SYSTEM] This is the SAME error as your previous attempt. Do NOT retry the identical call. Re-read the error text above, name the root cause, and either fix the underlying state yourself or change the approach.';
            }
            this.lastToolErrorSig = sig;
          } else {
            this.lastToolErrorSig = '';
          }
          context.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
        liveItems.push({ kind: 'tools', id: randomUUID(), calls: groupRecords, ts: Date.now() });

        // REVIEW BEFORE PUBLISH: the agent asked to publish a version that hasn't passed the gate.
        // Run the FULL verify + design review now — after all tool results are recorded, so the
        // conversation order stays valid — and let publishing through only once it's clean. This is
        // the structural guarantee that the user never gets a link to a draft (no publish-then-fix).
        if (this.wantsPublish && !this.verifiedClean && this.session.mode === 'code' && this.mutated && !this.abort.signal.aborted) {
          this.wantsPublish = false;
          const gate = await this.runVerifyGate(dir, liveItems, context);
          if (gate === 'failed') {
            finalStatus = 'error';
            stopReason = 'natural';
            break;
          }
          if (gate === 'ok') {
            this.verifiedClean = true;
            context.push({
              role: 'user',
              content:
                'Pre-publish review PASSED — the app is verified and looks good. Now call publish_app once to put it live; that is the final step.',
            });
          }
          // gate === 'retry': the review injected concrete defects → loop so the agent fixes them
          // BEFORE anything goes live.
          continue;
        }

        // The agent called switch_mode: move the session into the new mode and
        // reload its toolset, system prompt, and engine — then keep going.
        if (this.pendingMode && this.pendingMode !== this.session.mode) {
          const newMode = this.pendingMode;
          this.pendingMode = null;
          this.session.mode = newMode;
          await store.updateSession(sessionId, { mode: newMode }).catch(() => {});
          this.taskProfile = classifyTask(userText, newMode); // re-classify for the new mode's floors
          ({ schemas, map } = getToolsForMode(newMode));
          this.addOnboardingTools(schemas, map);
          memoryBlock = await this.loadMemoryBlock(dir);
          systemContent = buildSystemPrompt(this.session, dir, memoryBlock, this.taskProfile, userText);
          // Carry the compiled design brief across the switch (e.g. chat→code to build); recompute
          // it if the new mode is the first to be visual (and we don't already have one).
          if (this.taskProfile?.isVisual && !this.compiledBrief) {
            this.compiledBrief = await compileDesignBrief(userText, this.taskProfile, this.abort.signal);
          }
          if (this.compiledBrief && this.taskProfile?.isVisual) systemContent += designBriefBlock(this.compiledBrief);
          // Re-evaluate the simple-build fast path for the new mode (e.g. chat→code to build).
          this.simpleBuild = config.simpleFastPath && isSimpleBuild(this.taskProfile, newMode);
          if (this.simpleBuild) systemContent += `\n\n${simpleBuildGuidance()}`;
          this.routeModel(userText, sysInfo);
          sysInfo(`↳ ${MODE_SWITCH_LINE[newMode]}`);
          this.emit({ type: 'session_meta_updated', meta: { id: sessionId, mode: newMode } });
          const meta = await store.getSession(sessionId);
          if (meta) bus.sessionChanged(meta);
          this.emitProgress(
            'building',
            newMode === 'report' ? 'Designing your report…' : newMode === 'code' ? 'Building it…' : 'Working on it…',
          );
          stallSig = ''; // a fresh mode means a fresh batch — don't false-trip the stall guard
        }

        // The agent submitted its build plan: park the session awaiting the user's
        // Approve/Revise and END the turn here — building can only start on their next
        // message (this is the structural half of the plan gate).
        if (this.planSubmitted) {
          this.session.awaitingPlan = true;
          await store.setAwaitingPlan(sessionId, true).catch(() => {});
          this.emit({ type: 'session_meta_updated', meta: { id: sessionId, awaitingPlan: true } });
          const meta = await store.getSession(sessionId);
          if (meta) bus.sessionChanged(meta);
          stopReason = 'natural';
          break;
        }

        // Stall guard: the model silently repeating the exact same tool batch
        // (e.g. re-running a failing command) is the real runaway signal.
        const sig = text.trim() ? '' : calls.map((c) => `${c.name}:${c.args}`).join('|');
        if (sig && sig === stallSig) stallCount++;
        else {
          stallSig = sig;
          stallCount = 0;
        }
        if (stallCount >= STALL_LIMIT) {
          stopReason = 'stall';
          break;
        }

        // Anti-thrash backstop for heavy externally-validated ops (publishing): cap
        // re-attempts in one run so a stuck publish can't burn into the budget cutoff.
        for (const c of calls) {
          if (HEAVY_RETRY_TOOLS.has(c.name)) heavyRetryCalls.set(c.name, (heavyRetryCalls.get(c.name) ?? 0) + 1);
        }
        if ([...heavyRetryCalls.values()].some((n) => n >= HEAVY_RETRY_LIMIT)) {
          stopReason = 'stall';
          break;
        }
      }

      if (this.abort.signal.aborted) {
        finalStatus = 'idle';
      } else if (stopReason === 'ceiling') {
        finalStatus = 'done';
        liveItems.push({
          kind: 'system',
          id: randomUUID(),
          level: 'info',
          text: `Paused after ${maxIterations} steps (safety limit). Send "continue" to keep going.`,
          ts: Date.now(),
        });
      } else if (stopReason === 'stall') {
        finalStatus = 'error';
        const msg = `I got stuck repeating the same step and want to avoid spinning — could you give me a steer on what to do next? Tell me a bit more and I’ll pick it right back up.`;
        this.emit({ type: 'run_error', runId: this.runId, message: msg });
        liveItems.push({ kind: 'system', id: randomUUID(), level: 'error', text: msg, ts: Date.now() });
        void recordIncident({
          kind: 'stall', severity: 'med', signature: `stall ${this.session.mode}`,
          title: `Run stalled (repeated step) in ${this.session.mode} mode`,
          context: { mode: this.session.mode, model: this.activeModel, task: this.session.task },
          orgId: this.session.orgId, sessionId: this.session.id,
        });
      } else if (stopReason === 'budget') {
        // GRACEFUL CAP: a good deliverable may already be on disk (the recurring "error with a
        // hidden good PDF" — a report hits the token budget AFTER a clean PDF was rendered). If
        // one exists, COMPLETE the run normally (the finally block then auto-opens it + fires the
        // completion card) and add only a soft INFO note — never hand the user an error over a
        // finished file. Only show the hard budget error when NOTHING was produced.
        const produced = await this.newestDeliverable(dir, ['.pdf', '.pptx', '.docx', '.xlsx']).catch(() => null);
        // Same grace for a BUILT WEB APP (the $6 Kiln&Co case: app complete, run died polishing
        // a warning BEFORE publish — the user got an error over a finished product). Attempt ONE
        // publish; publishSession runs its own post-publish smoke test, so a broken app comes
        // back status 'error' and we still fall through to the honest budget message.
        let publishedUrl: string | null = null;
        if (!produced && this.session.mode === 'code' && this.mutated) {
          try {
            const renderable = detectRenderable(dir);
            if (renderable.renderable) {
              sysInfo('⏳ Out of processing budget, but the app is built — publishing it so you still get your live link…');
              const { publishSession } = await import('../deploy/publish');
              const dep = await publishSession(this.session.id, this.session.title || undefined);
              if (dep?.status === 'running') publishedUrl = dep.url;
            }
          } catch (e) {
            console.warn(`[budget] rescue publish failed for ${this.session.id}: ${String(e).slice(0, 200)}`);
          }
        }
        if (produced || publishedUrl) {
          finalStatus = 'done';
          liveItems.push({
            kind: 'system',
            id: randomUUID(),
            level: 'info',
            text: publishedUrl
              ? `This one took a bit more processing than usual, but your app is built and LIVE: ${publishedUrl}`
              : `This one took a bit more processing than usual. Your document is ready below.`,
            ts: Date.now(),
          });
          console.warn(`[budget] run ${this.runId} hit the token budget (${this.usage.totalTokens} tokens) but a deliverable was produced — completing normally — session ${this.session.id}`);
        } else {
          finalStatus = 'error';
          const msg = `This task used an unusually large amount of processing (over the per-run safety budget), so I stopped to avoid runaway cost. Your work so far is saved. This usually means the request looped — tell me to continue and I’ll resume more efficiently.`;
          this.emit({ type: 'run_error', runId: this.runId, message: msg });
          liveItems.push({ kind: 'system', id: randomUUID(), level: 'error', text: msg, ts: Date.now() });
          console.warn(`[budget] run ${this.runId} hit the token budget (${this.usage.totalTokens} tokens) — session ${this.session.id}`);
          void recordIncident({
            kind: 'cost_spike', severity: 'high', signature: `budget ${this.session.mode}`,
            title: `Run exceeded the token budget (${this.usage.totalTokens} tokens) in ${this.session.mode} mode`,
            context: { mode: this.session.mode, model: this.activeModel, task: this.session.task, tokens: this.usage.totalTokens },
            orgId: this.session.orgId, sessionId: this.session.id,
          });
        }
      }
    } catch (err: any) {
      if (this.abort.signal.aborted) {
        finalStatus = 'idle';
      } else {
        finalStatus = 'error';
        const message = scrubSecrets(String(err?.message ?? err));
        this.emit({ type: 'run_error', runId: this.runId, message });
        liveItems.push({
          kind: 'system',
          id: randomUUID(),
          level: 'error',
          text: `Agent error: ${message}`,
          ts: Date.now(),
        });
        void recordIncident({
          kind: /stall|premature|terminated|timeout/i.test(message) ? 'timeout' : 'run_error',
          severity: 'high', signature: `${this.session.mode}: ${message}`,
          title: `Agent error in ${this.session.mode} mode: ${message.slice(0, 120)}`,
          detail: message,
          context: { mode: this.session.mode, model: this.activeModel, task: this.session.task },
          orgId: this.session.orgId, sessionId: this.session.id,
        });
      }
    } finally {
      clearInterval(ticker);
      if (finalStatus === 'idle') {
        liveItems.push({
          kind: 'system',
          id: randomUUID(),
          level: 'info',
          text: 'Interrupted by user.',
          ts: Date.now(),
        });
      }

      const stat = await diffStat(sessionId).catch(() => null);

      // Surface every file produced this run as a download chip.
      const deliverables = await findDeliverables(dir, this.usage.startedAt);
      for (const fileItem of deliverables) {
        liveItems.push(fileItem);
        this.emit({ type: 'timeline_item', item: fileItem });
      }

      // Decide what the canvas should auto-open + load (zero clicks for the user):
      // a renderable web app (preview a port), else the freshly produced
      // document (PDF / spreadsheet / doc). Only after a successful run.
      let openCanvasEvent: { port?: number; file?: string; kind?: 'app' | 'pdf' | 'sheet' | 'doc' | 'image' } | null = null;
      const renderable = detectRenderable(dir);
      // Show the auto-canvas + completion card when: a code-mode run mutated a real project, OR an
      // artifact was produced (in ANY mode — an artifact is a self-contained renderable; it skips the
      // verify gate but still earns the tappable preview card).
      if (
        finalStatus === 'done' &&
        ((this.session.mode === 'code' && this.mutated) || this.producedArtifact) &&
        (looksLikeProject(dir) || renderable.renderable)
      ) {
        try {
          await buildExportArchive(dir, this.session.repoName ?? 'arksai', this.abort.signal);
        } catch {}
        if (renderable.renderable) {
          const port = startPreviewServer(sessionId, dir, renderable) ?? undefined;
          openCanvasEvent = { kind: 'app', ...(port != null ? { port } : {}) };
        }
      }
      if (!openCanvasEvent && finalStatus === 'done') {
        const doc = pickPreviewDoc(deliverables);
        if (doc) openCanvasEvent = { kind: doc.kind, file: doc.path };
      }
      const prev = await store.getSession(sessionId);
      // The session may have been deleted mid-run — if so, don't resurrect it
      // by writing rows or emitting status events for it.
      if (!prev) {
        bus.clear(sessionId);
        return;
      }
      // Stamp the run's total processing time (user input → output) onto the FINAL
      // assistant message so the user can see "Completed in 3m 12s" — and it persists
      // in the timeline JSON, surviving reload.
      const runDurationMs = Date.now() - this.usage.startedAt;
      let finalAssistant: Extract<TimelineItem, { kind: 'assistant' }> | null = null;
      for (let i = liveItems.length - 1; i >= 0; i--) {
        const it = liveItems[i];
        if (it.kind === 'assistant') {
          it.durationMs = runDurationMs;
          finalAssistant = it;
          break;
        }
      }
      for (; persisted < liveItems.length; persisted++) await store.appendTimeline(sessionId, liveItems[persisted]);
      // The final assistant item may have been flushed LIVE earlier (before the duration
      // was known) — rewrite it in place so the persisted timeline carries the duration.
      if (finalAssistant) await store.updateTimelineItem(sessionId, finalAssistant);
      await store.setContext(sessionId, context);
      // Cross-chat recall: distill a compact note into THIS org's shared memory (its
      // own org ONLY) so future sessions in the org can recall what was done here.
      if (this.session.orgId && finalStatus === 'done') await this.recordOrgRecall(liveItems).catch(() => {});
      // Authoritative cost: the per-turn sum already accounts for whichever
      // model(s) the orchestrator used this run.
      await store.updateSession(sessionId, {
        status: finalStatus,
        diffStat: stat,
        // Use the run-start base (not the just-flushed `prev`) so the per-turn live flushes
        // above aren't double-counted — this.usage.* is the cumulative run total.
        totalTokens: baseTok.t + this.usage.totalTokens,
        promptTokens: baseTok.p + this.usage.promptTokens,
        completionTokens: baseTok.c + this.usage.completionTokens,
        costUsd: baseTok.cost + this.accruedCostUsd + this.engineCostUsd,
      });

      // What the run produced — drives the "it's ready" completion card.
      const deliverable =
        finalStatus === 'done' && openCanvasEvent?.kind
          ? {
              kind: openCanvasEvent.kind,
              name: openCanvasEvent.file ? openCanvasEvent.file.split('/').pop() : undefined,
            }
          : undefined;
      if (finalStatus === 'done') this.emitProgress('done', 'Ready');
      // Self-calibrate the ETA: fold this run's REAL per-phase durations into the per-mode
      // EWMA (only clean, completed runs — a failed/aborted run's phases are misleading).
      if (finalStatus === 'done') recordRunDurations(this.session.mode, this.phaseDurations, this.session.task);

      this.emit({
        type: 'run_finished',
        runId: this.runId,
        status: finalStatus,
        totalTokens: this.usage.totalTokens,
        diffStat: stat,
        durationMs: runDurationMs,
        ...(deliverable ? { deliverable } : {}),
      });
      // Analytics (metadata only, fire-and-forget): the richest usage/quality/cost signal.
      track('run_finished', {
        orgId: this.session.orgId,
        userId: (this.session as any).createdBy ?? null,
        sessionId,
        props: {
          status: finalStatus,
          mode: this.session.mode,
          model: this.activeModel,
          task: this.session.task ?? undefined,
          deliverable: deliverable?.kind,
          durationMs: runDurationMs,
          totalTokens: this.usage.totalTokens,
          costUsd: Math.round((this.accruedCostUsd + this.engineCostUsd) * 1e6) / 1e6,
        },
      });
      // Wallet: debit the org for this run's USD cost (real tenant orgs only; the operator
      // workspace isn't metered). Idempotent on the runId so a re-fire never double-charges.
      // Fire-and-forget — the work is already done; we only RECORD the charge here.
      {
        const wOrg = this.session.orgId;
        const runCost = this.accruedCostUsd + this.engineCostUsd;
        if (wOrg && wOrg !== DEFAULT_ORG_ID && runCost > 0) {
          void (async () => {
            try {
              const { debitOrg, usdToMicros } = await import('../wallet/store');
              await debitOrg(wOrg, usdToMicros(runCost), { type: 'usage', source: 'system', ref: `run:${this.runId}`, note: `${this.session.mode} run` });
            } catch (e) {
              console.error('[wallet] debit failed', e);
            }
          })();
        }
      }
      if (openCanvasEvent) {
        this.emit({ type: 'open_canvas', ...openCanvasEvent });
      }
      const finalMeta = await store.getSession(sessionId);
      if (finalMeta) bus.sessionChanged(finalMeta);
      bus.clear(sessionId);
    }
  }

  /** Fold a usage chunk into the running totals + stream a cost update (per concrete
   *  model, so Auto mode blends correctly). Shared by the streaming + buffered paths.
   *  `apiModel` = the concrete model that actually answered, when it may differ from the
   *  active lane (a CODE_REVIEW_MODEL override) — priced at ITS rate, not the lane's. */
  private accrueUsage(u: any, apiModel?: string) {
    this.usage.add(u);
    const { hit, miss } = cacheSplit(u);
    const completion = u.completion_tokens ?? 0;
    const other = apiModel && apiModel !== this.activeApiModel ? apiModel : '';
    const price = other ? ARK_PRICES[other] : undefined;
    // A concrete model off the price table is billed as a lane that serves it, else as the active lane.
    const laneId = other && !price ? Object.keys(config.modelarkModels).find((id) => config.modelarkModels[id].model === other) : undefined;
    this.accruedCostUsd += price
      ? (miss * price.input + hit * price.cached + completion * price.output) / 1e6
      : computeCost(laneId ?? this.activePricingId, { cacheHit: hit, cacheMiss: miss, completion });
    this.emit({
      type: 'usage_update',
      totalTokens: this.usage.totalTokens,
      promptTokens: this.usage.promptTokens,
      completionTokens: this.usage.completionTokens,
      cacheHitTokens: this.usage.cacheHitTokens,
      cacheMissTokens: this.usage.cacheMissTokens,
      costUsd: this.accruedCostUsd,
    });
  }

  /**
   * Stream one turn from ModelArk (OpenAI-compatible chat/completions) and yield the raw OpenAI
   * streaming chunks the loop consumes (choices[].delta + usage). Robustness, all provider-generic:
   *   • a concurrency slot (arkLimiter) so plan limits queue instead of 429-ing;
   *   • the lane's reasoning controls: `thinking` (Flash runs with it off) and `reasoning_effort`
   *     (bounds a reasoning model so it can't think for minutes and never act);
   *   • a CONTENT-based idle deadline — re-armed only by real text / reasoning / tool-call deltas,
   *     never by keepalives — with every read RACED against it (aborting alone doesn't reliably
   *     reject a pending undici read), so a silent stream trips `llmStall` → the run's engine
   *     ladder, while a healthy multi-minute generation is never cut off;
   *   • a one-time "still working" line at 55s so a long, healthy turn never looks hung;
   *   • the HTTP status on errors, so 429/5xx retry (isTransientApiError) and 4xx don't.
   */
  private async createModelarkStream(params: any): Promise<AsyncIterable<any>> {
    // The caller's model wins (e.g. a CODE_REVIEW_MODEL override); otherwise the active lane's.
    const apiModel = typeof params.model === 'string' && params.model ? params.model : this.activeApiModel;
    // An override is a different model: it gets ITS endpoint and its own defaults, never the lane's
    // thinking/effort (a GLM "effort low" must not leak onto a review model, and vice versa).
    const override = apiModel !== this.activeApiModel;
    const thinking = override ? undefined : this.activeThinking;
    const effort = override ? undefined : this.activeEffort;
    const base = override
      ? endpointFor(apiModel) === 'general'
        ? config.byteplusVideoBaseUrl.replace(/\/$/, '')
        : config.byteplusBaseUrl.replace(/\/$/, '')
      : this.activeBase || config.byteplusBaseUrl;
    const body: Record<string, unknown> = {
      model: apiModel,
      messages: params.messages || [],
      stream: true,
      stream_options: { include_usage: true },
      // Big single-file writes on the reasoning coders (~27k completion tokens INCLUDING reasoning
      // for one complete app file) — truncating tool-call args mid-JSON makes the loop retry and
      // burn tokens. Headroom is cheap; truncation is not.
      max_tokens: Number(process.env.ARK_MAX_TOKENS || process.env.BYTEPLUS_MAX_TOKENS || '40000') || 40_000,
      temperature: 0.4,
    };
    if (thinking) body.thinking = { type: thinking };
    if (effort && thinking !== 'disabled') body.reasoning_effort = effort;
    if (params.tools?.length) {
      body.tools = params.tools;
      body.tool_choice = 'auto';
    }
    const IDLE_MS = Number(process.env.ARK_IDLE_MS || process.env.BYTEPLUS_IDLE_MS || '180000') || 180_000;
    const stallError = (where: string) =>
      Object.assign(new Error(`ModelArk (${apiModel}) stalled ${where} — no output for ${IDLE_MS / 1000}s.`), { llmStall: true });

    // Concurrency slot first (time spent queued doesn't eat the idle deadline).
    let release: () => void;
    try {
      release = await arkLimiter.acquire(this.abort.signal);
    } catch (e) {
      throw new Error('interrupted by user');
    }
    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      release();
    };

    const ac = new AbortController();
    let rejectDeadline: ((e: any) => void) | null = null;
    const deadline = new Promise<never>((_, rej) => {
      rejectDeadline = rej;
    });
    deadline.catch(() => {});
    let stalled = false;
    let iterating = false; // set once the caller starts consuming the stream
    let streamReturned = false; // set once the iterable is handed back
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        ac.abort();
        rejectDeadline?.(stallError('waiting for output'));
        // A returned stream nobody ever iterates would otherwise hold its slot + timers forever.
        if (!iterating && streamReturned) cleanup();
      }, IDLE_MS);
    };
    // One-time-per-minute "this is taking longer" reassurance: a quality-first long turn is
    // fine, but the user should KNOW it's working, not wonder if it hung.
    const slowNotice = setTimeout(() => {
      if (this.abort.signal.aborted) return;
      if (Date.now() - this.lastSlowAt < 60_000) return;
      this.lastSlowAt = Date.now();
      const line = SLOW_LINES[this.slowLineIdx % SLOW_LINES.length];
      this.slowLineIdx++;
      this.emitProgress(this.progressPhase, line);
    }, 55_000);
    arm();
    const onUserAbort = () => {
      ac.abort();
      rejectDeadline?.(new Error('interrupted by user'));
    };
    if (this.abort.signal.aborted) onUserAbort();
    else this.abort.signal.addEventListener('abort', onUserAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(slowNotice);
      this.abort.signal.removeEventListener('abort', onUserAbort);
      releaseSlot();
    };
    let resp: Response;
    try {
      resp = await Promise.race([
        fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${byteplusKey()}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        }),
        deadline,
      ]);
    } catch (e: any) {
      cleanup();
      if (stalled) throw stallError('before responding');
      throw e;
    }
    if (!resp.ok || !resp.body) {
      cleanup();
      const detail = await resp.text().catch(() => '');
      throw Object.assign(new Error(`ModelArk ${resp.status} (${apiModel}): ${detail.slice(0, 300)}`), { status: resp.status });
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    async function* iterate(): AsyncGenerator<any> {
      iterating = true;
      let buf = '';
      let gotContent = false;
      try {
        for (;;) {
          // Race every read against the deadline: a stream that only sends keepalives (or
          // nothing) can't park the loop forever.
          const { value, done } = await Promise.race([reader.read(), deadline]);
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            let chunk: any;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue; // keepalive / partial line
            }
            const d = chunk?.choices?.[0]?.delta;
            // CONTENT re-arms the idle deadline; empty keepalive chunks don't.
            if (d && (d.content || d.reasoning_content || d.tool_calls?.length)) {
              arm();
              // Only VISIBLE text cancels the "still working" line — a reasoning model can think for
              // minutes before its first word, and a big tool call streams its args silently.
              if (!gotContent && d.content) {
                gotContent = true;
                clearTimeout(slowNotice);
              }
            }
            yield chunk;
          }
        }
      } catch (e) {
        if (stalled) throw stallError('mid-stream');
        throw e;
      } finally {
        cleanup();
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
      }
    }
    streamReturned = true;
    return iterate();
  }

  /** Retry transient API failures (network blips, 429/5xx) with backoff. A HARD failure (4xx —
   *  e.g. a model the key can't call, a rejected parameter) switches once to a DIFFERENT ModelArk
   *  model (router.stallLadder) so the run keeps going — the request is rebuilt for that model.
   *  Silent STALLS bubble up to the run loop's engine ladder instead. Side calls (e.g. the code
   *  review) pass escalate:false: they must never switch the build's engine. */
  private async createCompletionWithRetry(params: any, opts: { escalate?: boolean } = {}): Promise<AsyncIterable<any>> {
    const delays = [2000, 4000, 8000];
    let triedEscalate = opts.escalate === false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.createModelarkStream(params);
      } catch (err) {
        if (this.abort.signal.aborted) throw err;
        if ((err as any)?.llmStall) throw err;
        if (!isTransientApiError(err) && !triedEscalate) {
          const alt = stallLadder(this.activeModel)[0];
          if (alt) {
            triedEscalate = true;
            const prevApiModel = this.activeApiModel;
            this.dropReasoning(params.messages);
            this.setActiveModel(alt);
            // The run loop passes the lane's model explicitly — point the retry at the NEW engine
            // (an explicit override such as CODE_REVIEW_MODEL is never rewritten).
            if (!params.model || params.model === prevApiModel) params = { ...params, model: this.activeApiModel };
            this.emit({ type: 'timeline_item', item: { kind: 'system', id: randomUUID(), level: 'info', text: '↳ Switching engines to finish.', ts: Date.now() } });
            continue;
          }
        }
        if (attempt >= delays.length || !isTransientApiError(err)) throw err;
        this.emit({
          type: 'tick',
          elapsedSeconds: this.usage.elapsedSeconds,
          runningTasks: 1,
        });
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }

  private async executeTool(
    call: AccToolCall,
    map: ReturnType<typeof getToolsForMode>['map'],
    dir: string,
    records: ToolCallRecord[],
  ): Promise<string> {
    const started = Date.now();
    let args: any = {};
    let argsSummary = '';
    const tool = map.get(call.name);
    args = call.args ? parseToolArgs(call.args) : {};
    argsSummary = tool && args ? tool.summarize(args) : call.args.slice(0, 120);
    // File-producing tools all flag the run as mutated so the completion gate fires — incl.
    // the document generators / renderer (a run that ONLY calls generate_pptx must still be gated).
    if (
      ['write_file', 'edit_file', 'git_commit', 'generate_spreadsheet', 'generate_doc', 'generate_pptx', 'render_report'].includes(
        call.name,
      )
    ) {
      this.mutated = true;
      this.verifiedClean = false; // changed files → the prior review no longer applies
    }
    // An artifact is a self-contained STATIC file: it must surface the tappable preview card
    // (open_canvas + completion) but must NOT flip `mutated` — that would run the code verify gate,
    // which pushes the agent to bolt a Node server onto a single HTML file (over-build + port mess).
    if (call.name === 'create_artifact') this.producedArtifact = true;
    if (call.name === 'publish_app') this.emitProgress('publishing', 'Putting it online & checking the live URL…');
    // Finer beats while authoring so the long build/report wait visibly moves.
    else if (this.progressPhase === 'building' && TOOL_BEAT[call.name]) this.emitProgress('building', TOOL_BEAT[call.name]);
    if (call.name === 'bash' && typeof args?.command === 'string') {
      const cmd = args.command as string;
      if (/(curl|wget|http)\b/i.test(cmd) && /(localhost|127\.0\.0\.1|0\.0\.0\.0|:\d{4})/.test(cmd)) {
        this.didRuntimeTest = true;
      }
      // A bash command that WRITES files (heredoc, redirect, tee, cp/mv/touch/mkdir,
      // sed -i, npm/npx scaffolds) must flag the run as mutated — otherwise a build
      // that creates index.html via bash gets no auto-canvas + no completion card.
      if (/(>>?|<<|\btee\b|\bcp\b|\bmv\b|\btouch\b|\bmkdir\b|sed\s+-i|\bnpm\b|\bnpx\b|\bpip\b|\bgit\b)/.test(cmd)) {
        this.mutated = true;
        this.verifiedClean = false; // a file-writing bash command invalidates the prior review
      }
    }

    this.emit({
      type: 'tool_call_started',
      runId: this.runId,
      callId: call.id,
      tool: call.name,
      argsSummary,
    });

    let result: string;
    let ok = true;
    this.runningTasks++;
    try {
      if (!tool) {
        ok = false;
        result = `Error: unknown tool "${call.name}"`;
      } else if (args === null) {
        ok = false;
        result = `Error: tool arguments were not valid JSON${tool.badJsonHint ? ` — ${tool.badJsonHint}` : ''}`;
      } else if (
        call.name === 'publish_app' &&
        this.session.mode === 'code' &&
        this.mutated &&
        !this.verifiedClean
      ) {
        // REVIEW BEFORE PUBLISH: never hand the user a link to a version that hasn't passed the
        // verify + design review. Flag the intent; the post-batch gate runs the full review now,
        // and the app only goes live (the agent's next publish_app) once it's clean.
        this.wantsPublish = true;
        result =
          'Not published yet — this version must pass the automated quality review FIRST (it runs now). ' +
          'The user must never get a link to an unreviewed draft, and we never publish-then-fix. ' +
          'Fix anything the review flags; once it is clean, publishing goes through. Do not call publish_app again until then.';
      } else {
        const ctx: ToolCtx = {
          session: this.session,
          repoDir: dir,
          mode: this.session.mode,
          signal: this.abort.signal,
          requestModeSwitch: (mode: SessionMode) => {
            if (mode !== this.session.mode) this.pendingMode = mode;
          },
          submitPlan: () => {
            this.planSubmitted = true;
          },
          planResolved: this.planResolved,
          planApproved: this.planApproved,
          addCost: (usd: number) => {
            if (usd > 0) {
              this.engineCostUsd += usd;
              this.emit({
                type: 'usage_update',
                totalTokens: this.usage.totalTokens,
                promptTokens: this.usage.promptTokens,
                completionTokens: this.usage.completionTokens,
                cacheHitTokens: this.usage.cacheHitTokens,
                cacheMissTokens: this.usage.cacheMissTokens,
                costUsd: this.accruedCostUsd,
                engineCostUsd: this.engineCostUsd,
              });
            }
          },
        };
        result = await tool.run(args, ctx);
        if (result.startsWith('Error:') || result.startsWith('Blocked')) ok = false;
      }
    } catch (err: any) {
      ok = false;
      result =
        err instanceof ToolError ? `Error: ${err.message}` : `Error: ${scrubSecrets(String(err?.message ?? err))}`;
    } finally {
      this.runningTasks--;
    }

    result = scrubSecrets(result);
    const durationMs = Date.now() - started;
    const outputPreview = result.slice(0, PREVIEW_CHARS) + (result.length > PREVIEW_CHARS ? '…' : '');
    this.emit({
      type: 'tool_call_finished',
      runId: this.runId,
      callId: call.id,
      ok,
      durationMs,
      outputPreview,
    });
    // A model-called checkpoint just landed → refresh the visible build-plan trail.
    if (call.name === 'checkpoint' && ok) this.emitCheckpoints(dir);
    records.push({
      callId: call.id,
      tool: call.name,
      argsSummary,
      running: false,
      ok,
      durationMs,
      outputPreview,
    });
    return result;
  }

  /**
   * Cheap pre-completion SELF-AUDIT (first-try correctness). Runs the same DETERMINISTIC,
   * model-free defect checks the verify/report gates seed — web hygiene (missing viewport /
   * broken local asset refs) + the xlsx formula/banner/section/numeric audits — but does it
   * BEFORE the expensive gate so the agent fixes a known-bad result IN-CONTEXT instead of
   * via a full tool-loop re-run after the gate (and with NO vision call spent).
   *
   * Bounded by its OWN counter (`selfAuditRounds`, cap 2) that is fully separate from
   * `verifyRounds`/`designRounds` — it never consumes the gate's budget, and the gates still
   * run afterwards as the backstop (now usually finding nothing). Pushes ONE terse pass/fail
   * checklist on defects and returns 'retry'; 'ok' when clean or out of self-audit rounds.
   */
  private async runCheapSelfAudit(dir: string, liveItems: TimelineItem[], context: any[]): Promise<'retry' | 'ok'> {
    const MAX_SELF_AUDIT = 2;
    if (this.selfAuditRounds >= MAX_SELF_AUDIT || this.abort.signal.aborted) return 'ok';

    const defects: string[] = [];

    // Web (visual code builds): missing <meta viewport>, broken local <link>/<script>/<img> refs —
    // pure source reads, no browser. Same function the verify gate uses, run earlier + cheaper.
    if (this.session.mode === 'code' && this.taskProfile?.isVisual) {
      try {
        const renderable = detectRenderable(dir);
        const webDir = renderable.staticDir ? path.join(dir, renderable.staticDir) : dir;
        const hygiene = auditWebHygiene(webDir);
        if (hygiene.defects.length) defects.push(...hygiene.defects);
      } catch {
        /* best-effort — never block completion on the self-audit */
      }
    }

    // Spreadsheet model (any mode): hard-coded formulas, empty statement sheets, banner/section
    // rows, impossible numbers — a SheetJS read + the pure audits. No vision, no re-render.
    try {
      const xlsx = await this.newestDeliverable(dir, ['.xlsx']).catch(() => null);
      if (xlsx) {
        const XLSX: any = await import('xlsx');
        const wb = XLSX.read(fs.readFileSync(xlsx), { type: 'buffer' });
        defects.push(...deterministicDeliverableDefects({ wb }));
      }
    } catch {
      /* best-effort */
    }

    if (!defects.length) return 'ok';

    this.selfAuditRounds++;
    const sys = (text: string) => {
      const item: TimelineItem = { kind: 'system', id: randomUUID(), level: 'info', text, ts: Date.now() };
      liveItems.push(item);
      this.emit({ type: 'timeline_item', item });
    };
    this.emitProgress('polishing', `Self-check — tightening it up (pass ${this.selfAuditRounds})…`);
    sys(`↻ A quick self-check before finishing caught ${defects.length} fixable issue${defects.length > 1 ? 's' : ''} — handling ${defects.length > 1 ? 'them' : 'it'} now.`);
    context.push({
      role: 'user',
      content:
        `Before this is done, a fast automatic self-check found these concrete, fixable defects in what you just built. ` +
        `Fix ONLY these (minimal targeted edits / re-produce the affected file), then continue — they will be re-checked:\n- ${defects.join('\n- ')}`,
    });
    return 'retry';
  }

  /**
   * Verification gate. Runs the project's checks before completion. Returns:
   *  'retry'  — checks failed, a fix request was injected; keep working
   *  'failed' — failed and out of retries; finish as error
   *  'ok'     — passed or nothing to verify; finish normally
   */
  private async runVerifyGate(
    dir: string,
    liveItems: TimelineItem[],
    context: any[],
  ): Promise<'retry' | 'failed' | 'ok'> {
    // The app already published clean this run (full pre-launch review passed on the LIVE URL) —
    // that is the strongest verification that exists; nothing may reopen after it. Any republish
    // still gets publish_app's own live smoke test, so this can never ship an unchecked change.
    if (this.publishedClean) return 'ok';
    const MAX_VERIFY = 4;
    this.verifyRounds++;
    const sys = (level: 'info' | 'error', text: string) => {
      const item: TimelineItem = { kind: 'system', id: randomUUID(), level, text, ts: Date.now() };
      liveItems.push(item);
      this.emit({ type: 'timeline_item', item });
    };
    // Self-healing reads as confident forward progress, NOT a scary failure:
    // the system caught something and is hardening the result before the user
    // ever sees it. Red/error styling is reserved for a genuinely terminal stop.
    const failFix = (label: string, detail: string, phase: ProgressPhase = 'verifying'): 'retry' | 'failed' => {
      if (this.verifyRounds >= MAX_VERIFY) {
        const calm = `I couldn’t fully get ${label} to pass after a few tries — your work is saved. Tell me to try a different approach and I’ll keep going.`;
        sys('error', calm);
        this.emit({ type: 'run_error', runId: this.runId, message: calm });
        return 'failed';
      }
      const pass = this.verifyRounds + 1;
      this.emitProgress(phase, `${label} caught something — hardening it (pass ${pass})…`);
      sys('info', `↻ ${label} caught something — hardening it automatically (pass ${pass}).`);
      // Auto mode: a caught issue is the signal to bring a stronger model in.
      if (isAutoModel(this.session.model)) {
        const next = escalateModel(this.activeModel);
        if (next !== this.activeModel) {
          this.setActiveModel(next);
          sys('info', `↳ Bringing in ${KNOWN_MODELS[next]?.label ?? next} to nail it.`);
        }
      }
      context.push({
        role: 'user',
        content: `Automated verification FAILED — ${label}. The task is NOT complete until this passes. Diagnose and fix it, then it will be re-checked.\n\n${detail}`,
      });
      return 'retry';
    };

    sys('info', '⟳ Verifying — running the project checks…');
    this.emitProgress('verifying', 'Verifying it works…');

    // 1) Static checks (typecheck / lint / test / build). Each check announces
    //    itself so the user sees the system doing real, thorough work.
    const report = await verifyProject(dir, this.abort.signal, (name, status) => {
      if (status === 'start') this.emitProgress('verifying', `${checkLabel(name)}…`);
    }).catch((e) => ({
      ran: false,
      ok: true,
      checks: [],
      summary: `Static verification skipped (${String(e?.message ?? e)}).`,
    }));
    if (report.ran && !report.ok) {
      const failing = report.checks.find((c) => !c.ok)!;
      return failFix(checkLabel(failing.name), failing.output);
    }

    // 1c) Code-review gate (connected-repo work): the static checks proved it COMPILES; now a
    //     second model reads the actual DIFF for correctness bugs / regressions / security /
    //     leftover debug code — the layer the build+boot checks can't see. Bounded, fail-open, and
    //     only for a connected repo (a from-scratch build is owned by the verify + design gates).
    if (
      config.codeReviewGate &&
      this.session.repoUrl &&
      !this.reviewPassed &&
      this.reviewRounds < 2 &&
      !this.abort.signal.aborted
    ) {
      this.emitProgress('verifying', 'Reviewing the diff for correctness…');
      sys('info', '⟳ Code review — reading your diff for correctness & regressions…');
      const findings = await this.reviewDiff();
      if (findings.length) {
        this.reviewRounds++;
        return failFix(
          'Code review',
          `A review of your diff flagged concrete issues. Fix ONLY these (keep changes minimal), then it will be re-reviewed:\n- ${findings.join('\n- ')}`,
        );
      }
      this.reviewPassed = true;
      sys('info', '✓ Code review passed — no correctness issues in the diff.');
    }

    // 1b) Document deliverables (docx/xlsx/pptx/pdf from the generate_*/render tools) —
    //     render + functional + design-review them, bounded-revise. Web apps are covered by
    //     the live probe below; this gates the FILE deliverables that probe never sees.
    if (config.designGate && !this.abort.signal.aborted) {
      const review = await this.reviewDeliverables(dir);
      const { fail, defects } = review;
      if (fail) return failFix(fail.label, fail.detail);
      this.warnIfDesignGateSkipped(review, sys);
      // Bounded revise for documents (up to 2 — the deterministic checks are cheap). The redo stays
      // on the SAME engine: DeepSeek-V4-Pro won every document workload in the bake-off, and the
      // alternates (GLM-5.2, Seed) scored worst on exactly these (spreadsheets 2.2 / 2.0) — the
      // stall ladder is for silence/outages, not for quality revisions. The targeted instructions
      // below (concrete formula how-to, minimal edits) are what fix a flagged document.
      if (defects.length && this.designRounds < 2) {
        this.designRounds++;
        // A formula/empty-model failure needs a CONCRETE how-to, not just "fix it".
        const formulaIssue = defects.some((d) => /formula|hard-?cod|typed.?in|empty/i.test(d));
        const how = formulaIssue
          ? ' CRITICAL for the spreadsheet: EVERY derived/computed cell (totals, growth, net, balances, every monthly projection) MUST be a real FORMULA referencing the Assumptions/driver cells — e.g. {f:"=B2*(1+Assumptions!$B$2)"} or {f:"=SUM(B2:B13)"} via generate_spreadsheet. Replace every hard-coded OR empty derived cell with a formula and fill in all periods; a hard-coded or empty model is rejected.'
          : ' Make minimal, targeted edits to fix ONLY these — do not regenerate the whole document.';
        this.emitProgress('polishing', 'Design review — applying refinements…');
        sys('info', '↻ Design review of the document flagged refinements — applying them.');
        context.push({
          role: 'user',
          content: `A review of the rendered document flagged these concrete, fixable issues. Fix them and re-produce the file, then it will be re-reviewed:\n- ${defects.join('\n- ')}${how}`,
        });
        return 'retry';
      }
    }

    // 2) Runtime + flow — for apps, ArksAI boots it and exercises the endpoints. A STATIC
    //    site has no start command, but it must STILL be browser-checked (responsive overflow,
    //    mobile nav, contrast) — never waved through — so serve it and run the same gate.
    let probeDir = dir;
    let probeCmd = detectStartCommand(dir);
    let staticSite = false;
    if (!probeCmd) {
      const r = detectRenderable(dir);
      if (r.staticDir) {
        probeDir = path.join(dir, r.staticDir);
        probeCmd = 'python3 -m http.server 4000 --bind 0.0.0.0';
        staticSite = true;
      }
    }
    if (!probeCmd) {
      sys('info', report.ran ? `✓ Verified — ${report.summary}` : report.summary);
      return 'ok';
    }

    // Clean any dev server the agent left running so the probe gets the port.
    processRegistry.killAllForSession(this.session.id);
    sys('info', staticSite ? '⟳ Serving the site and checking it renders in a real browser…' : '⟳ Booting the app and exercising its endpoints (seeding real data)…');
    this.emitProgress('testing', staticSite ? 'Checking it renders on phone + desktop…' : 'Booting a live instance…');
    const probe = await probeApp(this.session.id, probeDir, probeCmd, this.abort.signal, {
      visual: this.taskProfile?.isVisual,
      wireframe: this.taskProfile?.type === 'wireframe',
      onPhase: (label) => this.emitProgress('testing', label),
    });
    if (probe.ui?.visualReview) this.engineCostUsd += config.arkVisionCost; // vision spend
    if (!probe.booted || probe.serverErrors > 0) {
      // A DB/infra-backed server app (Prisma+Postgres, Mongo, …) CANNOT boot in the build sandbox —
      // there's no database/env here. That's not a code defect, and hard-failing dead-loops the gate
      // and blocks finishing + publishing (where it DOES run with its real database, and the
      // post-publish smoke test validates the live URL). Static checks already passed, so accept it
      // with an honest note instead of looping "Booting the app".
      if (!staticSite && needsExternalDb(dir)) {
        sys('info', '✓ Build verified. This app needs a database to run, which the build sandbox doesn’t have — it’ll be started and checked live when you publish.');
        return 'ok';
      }
      return failFix(probe.serverErrors > 0 ? 'Runtime testing' : 'Booting the app', probe.detail, 'testing');
    }
    if (probe.ui?.hardFail) {
      return failFix('The browser check', probe.detail, 'testing');
    }
    // Deterministic mobile-web hygiene the headless browser CAN'T see — most importantly a missing
    // <meta viewport> (Playwright sets the viewport, so the page never renders desktop-width-and-
    // zoomed-out the way it does on a real phone). Gate on it too, with no browser/vision needed.
    const hygiene = auditWebHygiene(probeDir);
    if (hygiene.defects.length) {
      return failFix('Mobile web checks', hygiene.defects.map((d) => `- ${d}`).join('\n'), 'testing');
    }
    // Gating DESIGN critique (visual tasks): the agent must fix concrete defects
    // and re-render, bounded — so the user gets a polished result without
    // iterating. Then PASS-with-warnings (never block on subjective taste).
    // TIERED (operator doctrine 2026-07-02 — "never stuck fixing what doesn't need fixing"):
    // only BLOCKING defects (functional/accessibility) open a fix round; cosmetic/taste items
    // are delivered as notes. A run can no longer loop on fonts, palette or "more distinctive".
    const allDefects = probe.ui?.designDefects ?? [];
    const blockingDefects = allDefects.filter((d) => isBlockingDefect(d));
    const cosmeticDefects = allDefects.filter((d) => !isBlockingDefect(d));
    if (
      config.designGate &&
      this.taskProfile?.isVisual &&
      probe.ui?.designVerdict === 'revise' &&
      blockingDefects.length
    ) {
      // Wrap-up teeth: past the budget notice, NEVER open a new design round — deliver with the
      // notes (the $6 runs died in exactly this loop after the soft notice was ignored).
      if (!this.wrapUp && this.designRounds < (this.simpleBuild ? 1 : MAX_DESIGN_ROUNDS)) {
        this.designRounds++;
        const next = escalateModel(this.activeModel);
        if (next !== this.activeModel) this.setActiveModel(next);
        this.emitProgress('polishing', `Design review — applying refinements (round ${this.designRounds})…`);
        sys('info', `↻ Design review flagged refinements — applying them (round ${this.designRounds}).`);
        context.push({
          role: 'user',
          content:
            `A design review of the rendered UI flagged these BLOCKING issues (functional/accessibility). Fix ` +
            `EXACTLY these and nothing else — cosmetic notes are already accepted and must NOT be worked on:\n- ${blockingDefects.join('\n- ')}\n\n` +
            (cosmeticDefects.length ? `(Accepted as notes, DO NOT fix: ${cosmeticDefects.join(' · ').slice(0, 400)})\n\n` : '') +
            `HOW TO FIX (targeted edits ONLY — never regenerate a whole file for these):\n` +
            `- Contrast flags → run validate_palette and adjust the flagged token, not individual elements.\n` +
            `- Layout/overflow flags → fix the container (max-width, flex-wrap, grid minmax), not with page-level scroll hacks.\n` +
            `- A dead control → fix THAT handler; a failed request → fix THAT endpoint/path.`,
        });
        return 'retry';
      }
      sys('info', `✓ Verified — ${probe.detail}\n(design review noted items; delivering.)`);
      this.autoCheckpoint(dir);
      return 'ok';
    }
    if (cosmeticDefects.length) {
      // Cosmetic-only review → deliver with notes, NEVER a fix loop (the "stuck polishing" cure).
      sys('info', `✓ Verified — ${probe.detail}\n(design notes accepted, not blockers: ${cosmeticDefects.slice(0, 4).join(' · ').slice(0, 300)})`);
      this.autoCheckpoint(dir);
      return 'ok';
    }
    sys('info', `✓ Verified — ${probe.detail}`);
    this.autoCheckpoint(dir);
    return 'ok';
  }

  /** Harness-driven checkpoint (Replit-parity): every verified-green state is committed
   *  automatically, so durability never depends on the model remembering to call the tool. */
  private autoCheckpoint(dir: string): void {
    if (!config.checkpointBuilds || this.session.mode !== 'code' || !this.mutated) return;
    void recordCheckpoint(dir, 'auto: verified build state')
      .then(() => this.emitCheckpoints(dir))
      .catch(() => {});
  }

  /** Push the durable checkpoint ledger to the client so the build plan is VISIBLE in the UI
   *  (a step trail under the progress bar) — the user sees each milestone commit as it lands. */
  private emitCheckpoints(dir: string): void {
    try {
      const steps = readCheckpoints(dir).map((c) => ({ task: c.task, sha: c.sha, ts: c.ts }));
      if (steps.length) this.emit({ type: 'checkpoint_update', steps });
    } catch {
      /* display-only — never let it affect the run */
    }
  }

  /**
   * Code-review gate: read the session's full diff (committed + uncommitted vs the base commit) and
   * have a second model pass over it for correctness/regressions/security/leftover-debug. Returns
   * concrete findings to bounded-revise, or [] to approve. FAIL-OPEN — a broken/empty review must
   * never block a ship the verify gate already proved runs.
   */
  private async reviewDiff(): Promise<string[]> {
    try {
      const { diff, changed } = await sessionDiff(this.session.id);
      if (!changed || diff.length < 40) return [];
      const { system, user } = buildReviewPrompt(diff, { repoName: this.session.repoName });
      let text = '';
      const strip = makeThinkFilter();
      // A side call: it must never switch the BUILD's engine on failure (fail-open instead).
      const reviewModel = config.codeReviewModel || this.activeApiModel;
      const stream = await this.createCompletionWithRetry(
        {
          model: reviewModel,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: true,
          stream_options: { include_usage: true },
        },
        { escalate: false },
      );
      let billed = false;
      for await (const chunk of stream) {
        const delta: any = chunk.choices?.[0]?.delta;
        if (delta?.content) text += strip(delta.content);
        if (chunk.usage) {
          // Priced by the model that actually reviewed (CODE_REVIEW_MODEL may differ from the lane).
          this.accrueUsage(chunk.usage, reviewModel);
          billed = true;
        }
      }
      text += strip.flush();
      // The flat estimate is only a fallback for a stream that reported no usage (never on top of it).
      if (!billed) this.engineCostUsd += config.arkCodeReviewCost;
      const verdict = parseReviewVerdict(text);
      return verdict.verdict === 'revise' ? verdict.findings : [];
    } catch {
      return []; // fail-open
    }
  }

  /** Newest workspace file with one of the given extensions (the just-produced one). */
  private async newestDeliverable(dir: string, exts: string[]): Promise<string | null> {
    try {
      const matches = await fg(
        exts.map((e) => `**/*${e}`),
        { cwd: dir, ignore: ['**/node_modules/**', '**/.git/**', 'uploads/**'], onlyFiles: true, suppressErrors: true },
      );
      let best: { abs: string; mt: number } | null = null;
      for (const rel of matches) {
        const abs = path.join(dir, rel);
        const mt = fs.statSync(abs).mtimeMs;
        if (!best || mt > best.mt) best = { abs, mt };
      }
      return best?.abs ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Render + functional-check + design-review the freshly-produced document deliverables
   * (pdf / pptx / xlsx / docx) via the universal QC module. Returns the first functional
   * failure (hard) and the merged design defects (soft), so the caller can bounded-revise.
   */
  private async reviewDeliverables(
    dir: string,
  ): Promise<{ fail?: { label: string; detail: string }; defects: string[]; checked: number; gated: number }> {
    const kinds: Array<[DeliverableKind, string[]]> = [
      ['pdf', ['.pdf']],
      ['pptx', ['.pptx']],
      ['xlsx', ['.xlsx']],
      ['docx', ['.docx']],
    ];
    const defects: string[] = [];
    let fail: { label: string; detail: string } | undefined;
    let checked = 0; // visual deliverables found + run through checkDeliverable
    let gated = 0; // …of those, how many the DESIGN gate actually assessed (vision ran)
    for (const [kind, exts] of kinds) {
      if (this.abort.signal.aborted) break;
      const abs = await this.newestDeliverable(dir, exts);
      if (!abs) continue;
      const qc = await checkDeliverable(abs, kind, this.abort.signal);
      this.engineCostUsd += qc.costUsd ?? 0; // what the QC actually spent (failed calls are free)
      checked++;
      if (qc.ran) gated++;
      if (!qc.functionalOk && !fail) fail = { label: `${kind.toUpperCase()} validation`, detail: qc.functionalDetail };
      if (qc.designVerdict === 'revise' && qc.designDefects?.length) {
        const tag = path.basename(abs);
        for (const d of qc.designDefects) defects.push(`[${tag}] ${d}`);
      }
    }
    return { fail, defects: [...new Set(defects)].slice(0, 6), checked, gated };
  }

  /** When vision was EXPECTED (key set) but the design gate couldn't actually assess some
   *  produced file (render or vision failed), say so out loud — never let a visual
   *  deliverable ship as "reviewed" when the review silently didn't happen. */
  private warnIfDesignGateSkipped(
    review: { checked: number; gated: number },
    sys: (level: 'info' | 'error', text: string) => void,
  ) {
    if (modelarkReady() && review.checked > review.gated) {
      const n = review.checked - review.gated;
      sys(
        'info',
        `⚠ Couldn't run the visual design review on ${n} file${n > 1 ? 's' : ''} (the renderer or vision check was unavailable) — it's functionally valid but shipped without that polish pass, so give it a quick look.`,
      );
    }
  }

  /**
   * Report-mode completion gate: auto-render every page of the produced PDF/deck (+ any
   * docx/xlsx) and design-review it — the bounded render→critique→revise loop that REPLACES
   * the manual see_image discipline. Returns 'retry' (defects injected) or 'ok'.
   */
  private async runReportGate(dir: string, liveItems: TimelineItem[], context: any[]): Promise<'retry' | 'ok'> {
    if (this.abort.signal.aborted) return 'ok';
    const sys = (level: 'info' | 'error', text: string) => {
      const item: TimelineItem = { kind: 'system', id: randomUUID(), level, text, ts: Date.now() };
      liveItems.push(item);
      this.emit({ type: 'timeline_item', item });
    };
    const startCmd = detectStartCommand(dir);
    const hasDoc = (await this.newestDeliverable(dir, ['.pdf', '.pptx', '.docx', '.xlsx'])) !== null;
    // Nothing to gate: no app, and either no rendered doc or no vision model.
    if (!startCmd && (!hasDoc || !modelarkReady())) return 'ok';

    let docReviewed = false;
    let docMinorItems = false;
    if (hasDoc && modelarkReady()) {
      docReviewed = true;
      sys('info', '⟳ Auto-rendering every page and design-reviewing the output…');
      this.emitProgress('verifying', 'Reviewing the rendered pages…');
      const review = await this.reviewDeliverables(dir);
      const { fail, defects } = review;
      this.warnIfDesignGateSkipped(review, sys);

      // Bounded revise for documents. Reports are quality-first (the user accepts a slightly
      // slower report for Claude-grade polish), and the deterministic structural pre-check now
      // finds the cheap defects with NO model call — so each round is targeted. Allow up to 2
      // rounds gated on REAL defects, demanding MINIMAL TARGETED edits (not a full rebuild).
      if ((fail || defects.length) && this.designRounds < REPORT_MAX_DESIGN_ROUNDS) {
        this.designRounds++;
        this.emitProgress('polishing', 'Design review — refining the output…');
        sys('info', '↻ Design review flagged refinements — applying them.');
        context.push({
          role: 'user',
          content: fail
            ? `Automated review found a problem with the rendered ${fail.label}: ${fail.detail}. Make a MINIMAL targeted fix (edit the existing HTML/spec — do NOT regenerate the whole document), then re-render.`
            : `A design review of the RENDERED pages flagged these concrete, fixable issues. Make MINIMAL, TARGETED edits to the EXISTING HTML/spec with edit_file to fix ONLY these — do NOT regenerate the whole document — then re-render (render_report / the generate_* tool); it will be re-reviewed:\n- ${defects.join('\n- ')}`,
        });
        return 'retry';
      }
      docMinorItems = !!(fail || defects.length);
    }

    // An interactive app built in report mode (rare — the agent normally routes builds to
    // code) would otherwise ship with NO runtime check. Boot it + smoke-test so it can't.
    if (startCmd && !this.abort.signal.aborted) {
      processRegistry.killAllForSession(this.session.id);
      sys('info', '⟳ Booting the app and checking it runs…');
      this.emitProgress('testing', 'Booting a live instance…');
      const probe = await probeApp(this.session.id, dir, startCmd, this.abort.signal, {
        visual: this.taskProfile?.isVisual,
        wireframe: this.taskProfile?.type === 'wireframe',
        onPhase: (label) => this.emitProgress('testing', label),
      });
      if (probe.ui?.visualReview) this.engineCostUsd += config.arkVisionCost;
      if ((!probe.booted || probe.serverErrors > 0 || probe.ui?.hardFail) && this.designRounds < REPORT_MAX_DESIGN_ROUNDS) {
        this.designRounds++;
        this.emitProgress('testing', 'Fixing the app so it runs…');
        sys('info', '↻ The app didn’t run cleanly — fixing it.');
        context.push({
          role: 'user',
          content: `The interactive app built here doesn't run cleanly yet: ${probe.detail}. Fix it so it boots and the page renders without errors, then it will be re-checked.`,
        });
        return 'retry';
      }
    }

    if (docReviewed) {
      sys('info', docMinorItems ? '✓ Reviewed — minor items noted; delivering.' : '✓ Reviewed — every page renders cleanly and looks designed.');
    } else if (startCmd) {
      sys('info', '✓ Checked — the app boots and runs.');
    }
    return 'ok';
  }

  /** Build the persistent-context block: the Organization (shared brain + brand),
   *  the Project (instructions + knowledge + branding), then Memory + ARKS.md.
   *  ORG ISOLATION: a tenant org loads ONLY its own org scope — never the
   *  deployment-wide 'global', never another org. Repo memory is namespaced per
   *  org so two orgs that share a repo name never share notes. */
  private async loadMemoryBlock(dir: string): Promise<string> {
    const orgId = this.session.orgId;
    const isTenant = !!orgId && orgId !== DEFAULT_ORG_ID;
    const orgKey = orgId ? orgScope(orgId) : null;
    // Repo memory is namespaced under the org for any org-stamped session.
    const repoKey = this.session.repoName
      ? orgId
        ? `${orgScope(orgId)}:repo:${this.session.repoName}`
        : this.session.repoName
      : null;

    const scopes: string[] = [];
    if (!isTenant) scopes.push('global'); // operator's home keeps deployment-wide notes
    if (orgKey) scopes.push(orgKey);
    if (repoKey) scopes.push(repoKey);
    if (this.session.projectId) scopes.push(`project:${this.session.projectId}`);

    const entries = await store.listMemory(scopes).catch(() => []);
    const orgEntries = orgKey ? entries.filter((e) => e.scope === orgKey).map((e) => `- ${e.text}`) : [];
    const global = entries.filter((e) => e.scope === 'global').map((e) => `- ${e.text}`);
    const project = entries.filter((e) => e.scope !== 'global' && e.scope !== orgKey).map((e) => `- ${e.text}`);

    // Optional ARKS.md committed in the repo (Claude-Code-style project memory).
    try {
      const md = fs.readFileSync(path.join(dir, 'ARKS.md'), 'utf8').trim();
      if (md) project.push(md.slice(0, 4000));
    } catch {
      /* no ARKS.md */
    }

    const blocks: string[] = [];

    // Repository primer (Phase 3): when a real repo is connected, lead with a cheap, deterministic
    // orientation (stack, scripts, layout, contributor docs) so the agent starts grounded on an
    // existing codebase instead of discovering the whole layout blind via glob/grep.
    if (this.session.repoUrl) {
      try {
        const primer = buildRepoPrimer(dir, this.session.repoName);
        if (primer) blocks.push(primer);
      } catch {
        /* primer is best-effort */
      }
    }

    // Organization block: the org's shared identity + brand + recalled team context.
    // This is the org "brain" — present in EVERY session in the org, and ONLY this org.
    if (orgId) {
      const prof = await getOrgProfile(orgId).catch(() => null);
      if (prof && (prof.about || prof.branding || orgEntries.length)) {
        const lines = [
          '## Organization — shared context for everyone in this workspace (keep it within this organization)',
        ];
        if (prof.about) lines.push(`\nAbout the organization:\n${prof.about}`);
        if (prof.branding) {
          const b = prof.branding;
          const parts: string[] = [];
          if (b.accent) parts.push(`accent ${b.accent}`);
          if (b.palette?.length) parts.push(`palette ${b.palette.join(', ')}`);
          if (b.logoName) parts.push(`logo ${b.logoName}`);
          if (parts.length)
            lines.push(`\nBrand — apply CONSISTENTLY to every report/deck/doc/app UNLESS the user overrides: ${parts.join('; ')}.`);
        }
        if (orgEntries.length) lines.push(`\nFrom the team's earlier work in this workspace:\n${orgEntries.join('\n')}`);
        blocks.push(lines.join('\n'));
      }
    }

    // Project block: custom instructions + knowledge index + branding.
    if (this.session.projectId) {
      const proj = await store.getProject(this.session.projectId).catch(() => null);
      if (proj) {
        const lines = [`## Project: ${proj.name} — persistent context for every session in this project`];
        if (proj.instructions.trim()) lines.push(`\nInstructions:\n${proj.instructions.trim()}`);
        try {
          const files = fs
            .readdirSync(path.join(dir, 'knowledge'))
            .filter((f) => !f.endsWith('.extracted.txt'));
          if (files.length)
            lines.push(
              `\nKnowledge files are in knowledge/ — read them with read_file/glob/grep before answering: ${files.join(', ')}.`,
            );
        } catch {
          /* no knowledge dir */
        }
        if (proj.branding) {
          const b = proj.branding;
          const parts: string[] = [];
          if (b.accent) parts.push(`accent ${b.accent}`);
          if (b.palette?.length) parts.push(`palette ${b.palette.join(', ')}`);
          if (b.logoName) parts.push(`logo at knowledge/${b.logoName}`);
          if (parts.length) lines.push(`\nBranding — use for reports and any UI: ${parts.join('; ')}.`);
        }
        blocks.push(lines.join('\n'));
      }
    }

    // Memory block.
    if (global.length || project.length) {
      let mem = '## Memory — persistent context you must respect';
      if (global.length) mem += `\n\nAbout the user (applies to every session):\n${global.join('\n')}`;
      if (project.length)
        mem += `\n\nAbout this project${this.session.repoName ? ` (${this.session.repoName})` : ''}:\n${project.join('\n')}`;
      blocks.push(mem);
    }

    return blocks.join('\n\n');
  }

  /** Inject the onboarding-only tools when this is the org-onboarding session. They
   *  are NOT in ALL_TOOLS, so they never appear in ordinary chats. */
  private addOnboardingTools(
    schemas: ReturnType<typeof getToolsForMode>['schemas'],
    map: ReturnType<typeof getToolsForMode>['map'],
  ): void {
    if (this.session.task !== 'org.onboarding') return;
    // extract_palette lets onboarding read a LOGO's brand colours deterministically
    // (exact hex, no vision model needed) when the admin uploads one instead of a site.
    for (const t of [crawlSiteTool, saveOrgProfileTool, extractPaletteTool]) {
      schemas.push({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } });
      map.set(t.name, t);
    }
  }

  /** Append a short, deduped note about this session to the ORG's shared memory
   *  (strictly this org's scope). Bounded so it stays a useful recent digest and
   *  never grows without limit; onboarding-seeded org facts are left untouched. */
  private async recordOrgRecall(items: TimelineItem[]): Promise<void> {
    const orgId = this.session.orgId;
    if (!orgId) return;
    const last = [...items].reverse().find((i) => i.kind === 'assistant') as { text?: string } | undefined;
    const gist = String(last?.text ?? '').replace(/\s+/g, ' ').trim();
    if (gist.length < 40) return; // nothing substantive to recall
    const title = this.session.title && this.session.title !== 'New session' ? this.session.title : 'Session';
    const date = new Date().toISOString().slice(0, 10);
    const scope = orgScope(orgId);
    const existing = await store.listMemory([scope]).catch(() => []);
    if (existing.some((e) => e.text.includes(`] ${title}:`) && Date.now() - e.createdAt < 6 * 3600_000)) return;
    await store.addMemory(scope, `[${date}] ${title}: ${gist.slice(0, 240)}`);
    // Cap the dated recall notes to the most recent 60; never touch the onboarding
    // facts (which have no [date] prefix).
    const after = await store.listMemory([scope]).catch(() => []);
    const recalls = after.filter((e) => /^\[\d{4}-\d{2}-\d{2}\] /.test(e.text)).sort((a, b) => a.createdAt - b.createdAt);
    for (const e of recalls.slice(0, Math.max(0, recalls.length - 60))) await store.deleteMemory(e.id).catch(() => {});
  }

  private async generateTitleAsync(userText: string) {
    const title = deriveTitle(userText);
    if (!title) return;
    await store.updateSession(this.session.id, { title });
    bus.sessionChanged((await store.getSession(this.session.id))!);
  }
}
