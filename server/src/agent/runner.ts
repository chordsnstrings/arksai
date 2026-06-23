import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { computeCost, KNOWN_MODELS, type SessionMeta, type SessionMode, type TimelineItem, type ToolCallRecord } from '../../../shared/types';
import { config } from '../config';
import { bus } from '../events/bus';
import * as store from '../sessions/store';
import { DEFAULT_ORG_ID, getOrgProfile, orgScope } from '../orgs/store';
import { diffStat, repoDir } from '../sessions/workspace';
import { scrubSecrets } from '../lib/exec';
import { buildUploadNote } from '../lib/extract';
import { buildSystemPrompt } from './prompts';
import { getToolsForMode } from './tools';
import { crawlSiteTool, saveOrgProfileTool } from './tools/onboarding';
import { extractPaletteTool } from './tools/palette';
import { track } from '../analytics/track';
import { ToolError, type ToolCtx } from './tools/common';
import { deriveTitle } from './titleGen';
import { recordIncident } from '../incidents/store';
import { makeThinkFilter } from './thinkFilter';
import { Usage } from './usage';
import { checkLabel, detectStartCommand, verifyProject } from './verify';
import { probeApp } from './runtimeCheck';
import { checkDeliverable, type DeliverableKind } from './deliverableCheck';
import { processRegistry } from './processes';
import { buildExportArchive, detectRenderable, looksLikeProject, startPreviewServer } from './canvasExport';
import { escalateModel, resolveProvider, selectModel } from './router';
import { classifyTask, type TaskProfile } from './taskProfile';
import { routeExpertise } from './expertiseRouter';
import { isAutoModel, MAX_MODEL, FAST_MODEL, phaseFloor, phaseCeiling, estimateRemainingSeconds, type ProgressPhase } from '../../../shared/types';
import { calibratedTypical, recordRunDurations } from './etaCalibration';

const CONTEXT_TOKEN_BUDGET = 50_000; // generous headroom under MiniMax's large context window
const PREVIEW_CHARS = 700;
const MAX_DESIGN_ROUNDS = 2; // bounded internal design-critique iterations
const REPORT_MAX_DESIGN_ROUNDS = 2; // report mode: quality-first revise cap (deterministic pre-check keeps rounds cheap)
// Tools that emit ONE large structured output (the whole spreadsheet/deck/doc as tool-call
// args). M3 reliably over-buffers these server-side → it would burn the full 150s patience
// before falling back. When one of these starts on the PRIMARY model we shorten the deadline
// so we fall back to the fast model quickly instead (the fast coding model handles big
// structured output well). Env-tunable via MINIMAX_HEAVY_TOOL_DEADLINE_MS.
const HEAVY_GENERATORS = new Set(['generate_spreadsheet', 'generate_pptx', 'generate_doc']);

// How many slow M3 turns we tolerate (each finished on the fast model for that turn only)
// before giving up on M3 for the rest of the run. Quality-first: M3 references cells more
// accurately on a financial model, so we keep returning to it. Env-tunable.
const MAX_MINIMAX_STALLS = Math.max(1, Number(process.env.MINIMAX_MAX_STALLS || '3') || 3);

/**
 * Global concurrency limiter for MiniMax (Anthropic-endpoint) streams. M3 buffers a
 * turn's output server-side, and under CONCURRENCY it STARVES the contending streams —
 * they get keepalive pings (so gaps stay tiny and the idle timer never trips) but
 * produce NO content for minutes (the "900s hang"). Empirically: 1–3 concurrent M3
 * streams complete cleanly, 4 degrade, 6 starve. So we cap concurrent streams; excess
 * turns queue. FIFO; abort-aware so an interrupted run never holds a slot. Env-tunable.
 */
export class Semaphore {
  private avail: number;
  private waiters: Array<{ resolve: () => void; signal?: AbortSignal; onAbort?: () => void }> = [];
  constructor(n: number) {
    this.avail = Math.max(1, n);
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new Error('aborted before acquiring MiniMax slot');
    if (this.avail > 0) {
      this.avail--;
    } else {
      await new Promise<void>((resolve, reject) => {
        const w: { resolve: () => void; signal?: AbortSignal; onAbort?: () => void } = { resolve, signal };
        w.onAbort = () => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1); // never granted a slot → nothing to return
          reject(new Error('aborted while queued for a MiniMax slot'));
        };
        if (signal) signal.addEventListener('abort', w.onAbort, { once: true });
        this.waiters.push(w);
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
        next.resolve(); // hand the slot directly to the next waiter (avail stays consumed)
      } else {
        this.avail++;
      }
    };
  }
}
const MINIMAX_MAX_CONCURRENCY = Math.max(1, Number(process.env.MINIMAX_MAX_CONCURRENCY || '3') || 3);
const minimaxLimiter = new Semaphore(MINIMAX_MAX_CONCURRENCY);

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
  // incl. the UAE compliance machine files (.sif WPS, .xml PINT AE e-invoice; FAF is .csv,
  // already covered) so a generated filing is actually surfaced as a download (it wasn't).
  '**/*.{xlsx,xls,csv,pdf,docx,doc,pptx,png,jpg,jpeg,svg,zip,tar,gz,tgz,tar.gz,mp3,wav,mp4,json,sif,xml}';

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
    return items;
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
  private verifyRounds = 0;
  private designRounds = 0; // bounded gating design-critique rounds (separate budget)
  private didRuntimeTest = false; // did the agent curl a running server this run?
  private flowRequired = false; // have we already asked it to demo the flow?
  private engineCostUsd = 0; // external-engine spend this run (e.g. Suno)
  private accruedCostUsd = 0; // model spend this run, summed per concrete model
  private taskProfile!: TaskProfile; // classified at run start; drives design context + gating
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
  private minimaxAvailable = !!config.minimaxApiKey;
  // Set once M3 has stalled REPEATEDLY on this run; subsequent MiniMax turns use the
  // faster model instead (the user's "M3, but fall back if slow" choice).
  private minimaxFellBack = false;
  // Quality-first stall handling: a single slow M3 turn finishes on the fast model for
  // THAT turn only (forceFastThisTurn), then the run returns to M3 — because each staged
  // step (e.g. one spreadsheet sheet) is small, so M3 stays accurate on the next one.
  // Only after MAX_MINIMAX_STALLS do we give up on M3 for the rest of the run (the weaker
  // fast model makes more cross-reference errors on a financial model, so we keep M3 where
  // we can). Counts stalls across the run.
  private minimaxStalls = 0;
  private forceFastThisTurn = false;
  // The concrete model the orchestrator is using right now (resolved from the
  // session model, which may be the virtual 'arksai-auto').
  private activeModel = '';
  private activeApiModel = '';
  private activePricingId = '';

  constructor(private session: SessionMeta) {}

  /** Point the run at a concrete model (resolving the real MiniMax API id). */
  private setActiveModel(modelId: string) {
    const r = resolveProvider(modelId);
    this.activeModel = modelId;
    this.activeApiModel = r.apiModel;
    this.activePricingId = r.pricingId;
  }

  /** When falling back M3 → DeepSeek mid-conversation, drop M3's reasoning_content from the
   *  history before switching models: it's M3-specific and a different model can reject it.
   *  The objects are shared with `context` (same refs), so this cleans both. */
  private dropM3Reasoning(msgs: any[]) {
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
    const etaSeconds = estimateRemainingSeconds(phase, elapsedInPhase, this.session.mode, calibratedTypical(this.session.mode));
    this.emit({ type: 'progress', phase, label, pct: Math.round(this.progressPct), detail, etaSeconds });
  }

  private emit(event: Parameters<typeof bus.emit>[1]) {
    bus.emit(this.session.id, event);
  }

  /** A stronger model the current mode demands, or null. Reports + non-trivial
   *  visual code builds shouldn't run on the cheapest brain. */
  private floorModel(): string | null {
    if (this.activeModel !== FAST_MODEL) return null;
    if (this.session.mode === 'report') return MAX_MODEL;
    if (this.session.mode === 'code' && this.taskProfile?.isVisual && this.taskProfile.tier !== 'light') return MAX_MODEL;
    return null;
  }

  /** Pick the engine for the current mode: auto-route by complexity (Auto mode),
   *  then apply the per-mode floor. Called at run start and after a mode switch. */
  private routeModel(userText: string, sys: (text: string) => void) {
    if (isAutoModel(this.session.model)) {
      const pick = selectModel(userText, this.session.mode, { minimaxAvailable: this.minimaxAvailable });
      this.setActiveModel(pick.model);
      sys(`↳ Auto-routed to ${pick.reason}`);
    } else {
      this.setActiveModel(this.session.model);
    }
    const floor = this.floorModel();
    if (floor && floor !== this.activeModel) {
      this.setActiveModel(floor);
      const why = this.session.mode === 'report' ? 'Reports use a stronger model' : 'Polished UI work uses a stronger model';
      sys(`↳ ${why} — switched to ${KNOWN_MODELS[floor]?.label ?? floor}.`);
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
        .filter((f) => {
          try {
            const st = fs.statSync(path.join(upDir, f));
            return st.isFile() && st.mtimeMs >= cutoff;
          } catch {
            return false;
          }
        })
        .slice(0, 12)
        .map((f) => `uploads/${f}`);
      const note = buildUploadNote(files, this.minimaxAvailable, paletteAvailable);
      if (note) context.push({ role: 'user', content: note });
    } catch {
      /* uploads scan is best-effort */
    }
  }

  async run(userText: string): Promise<void> {
    const sessionId = this.session.id;
    const dir = repoDir(sessionId);
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
    bus.sessionChanged((await store.getSession(sessionId))!);
    this.emit({ type: 'run_started', runId: this.runId, mode: this.session.mode });
    this.progressPct = 0;
    this.emitProgress('understanding', 'Understanding your request…');

    const context = await store.getContext(sessionId);
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
      let stopReason: 'natural' | 'ceiling' | 'stall' | 'budget' | null = null;
      while (!this.abort.signal.aborted) {
        iteration++;
        if (iteration > maxIterations) {
          stopReason = 'ceiling';
          break;
        }
        if (this.usage.totalTokens > maxRunTokens) {
          stopReason = 'budget';
          break;
        }
        truncateContext(context);

        let text = '';
        let reasoning = ''; // M3 reasoning (reasoning_split) — echoed back next turn so multi-turn tool use doesn't 400
        let finishReason = ''; // 'stop' | 'length' | 'tool_calls' — 'length' on an empty turn means reasoning truncated the answer
        const toolCalls: AccToolCall[] = [];
        // Strip any inline <think>…</think> from the visible stream (M3 inline reasoning).
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
        } catch (err: any) {
          // M3 over-buffered/stalled this turn → switch to the faster MiniMax model (Flash /
          // M2.7-highspeed) and redo the turn (once). minimaxFellBack also makes
          // createMinimaxStream pick the fast model for the rest of the run.
          if (err?.minimaxStall && !this.minimaxFellBack && !this.abort.signal.aborted) {
            this.minimaxStalls++;
            if (this.minimaxStalls >= MAX_MINIMAX_STALLS) {
              // Repeatedly slow → give up on M3 for the rest of the run.
              this.minimaxFellBack = true;
              this.dropM3Reasoning(context);
              this.setActiveModel(FAST_MODEL);
              sysInfo(`↳ ArksAI Max keeps running long — finishing the rest on ArksAI Flash.`);
            } else {
              // One slow step → finish JUST this turn on the fast model, then return to Max.
              // Keep M3's reasoning + active model so the next (small, staged) turn runs on Max,
              // which references cells more accurately than the fast model.
              this.forceFastThisTurn = true;
              sysInfo(`↳ That step ran long — finishing it on ArksAI Flash, then back to ArksAI Max.`);
            }
            continue;
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
          // Echo M3's reasoning back into history — required for its multi-turn tool use.
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
          // Completion gate: in Code mode, don't finish on unverified changes —
          // run the project's checks and, if they fail, keep fixing.
          if (this.session.mode === 'code' && this.mutated && !this.abort.signal.aborted) {
            const gate = await this.runVerifyGate(dir, liveItems, context);
            if (gate === 'retry') continue;
            if (gate === 'failed') {
              finalStatus = 'error';
              stopReason = 'natural';
              break;
            }
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
          const result = await this.executeTool(call, map, dir, groupRecords);
          context.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
        liveItems.push({ kind: 'tools', id: randomUUID(), calls: groupRecords, ts: Date.now() });

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
        if (produced) {
          finalStatus = 'done';
          liveItems.push({
            kind: 'system',
            id: randomUUID(),
            level: 'info',
            text: `This one took a bit more processing than usual. Your document is ready below.`,
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
      if (
        finalStatus === 'done' &&
        this.session.mode === 'code' &&
        this.mutated &&
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
      for (const item of liveItems) await store.appendTimeline(sessionId, item);
      await store.setContext(sessionId, context);
      // Cross-chat recall: distill a compact note into THIS org's shared memory (its
      // own org ONLY) so future sessions in the org can recall what was done here.
      if (this.session.orgId && finalStatus === 'done') await this.recordOrgRecall(liveItems).catch(() => {});
      // Authoritative cost: the per-turn sum already accounts for whichever
      // model(s) the orchestrator used this run.
      await store.updateSession(sessionId, {
        status: finalStatus,
        diffStat: stat,
        totalTokens: (prev.totalTokens ?? 0) + this.usage.totalTokens,
        promptTokens: (prev.promptTokens ?? 0) + this.usage.promptTokens,
        completionTokens: (prev.completionTokens ?? 0) + this.usage.completionTokens,
        costUsd: (prev.costUsd ?? 0) + this.accruedCostUsd + this.engineCostUsd,
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
      if (finalStatus === 'done') recordRunDurations(this.session.mode, this.phaseDurations);

      this.emit({
        type: 'run_finished',
        runId: this.runId,
        status: finalStatus,
        totalTokens: this.usage.totalTokens,
        diffStat: stat,
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
          durationMs: Date.now() - this.usage.startedAt,
          totalTokens: this.usage.totalTokens,
          costUsd: Math.round((this.accruedCostUsd + this.engineCostUsd) * 1e6) / 1e6,
        },
      });
      if (openCanvasEvent) {
        this.emit({ type: 'open_canvas', ...openCanvasEvent });
      }
      const finalMeta = await store.getSession(sessionId);
      if (finalMeta) bus.sessionChanged(finalMeta);
      bus.clear(sessionId);
    }
  }

  /** Fold a usage chunk into the running totals + stream a cost update (per concrete
   *  model, so Auto mode blends correctly). Shared by the streaming + buffered paths. */
  private accrueUsage(u: any) {
    this.usage.add(u);
    const hit = u.prompt_cache_hit_tokens ?? 0;
    const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
    this.accruedCostUsd += computeCost(this.activePricingId, {
      cacheHit: hit,
      cacheMiss: miss,
      completion: u.completion_tokens ?? 0,
    });
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

  /** Retry transient API failures (network blips, 429/5xx) with backoff. All models are
   *  MiniMax, served via the ANTHROPIC-compatible endpoint (not the OpenAI one): on the
   *  OpenAI surface M3's thinking is forced ON and unbounded — it reasons for minutes and
   *  never emits a tool call (the spreadsheet hang); on /anthropic/v1/messages thinking is
   *  OFF by default, so it acts immediately. createMinimaxStream translates our OpenAI-shaped
   *  loop to/from the Anthropic wire format so the rest of the loop is unchanged. If M3 (Max)
   *  hard-fails, fall back once to the fast model (Flash) so the run keeps going. */
  private async createCompletionWithRetry(params: any): Promise<AsyncIterable<any>> {
    const delays = [2000, 4000, 8000];
    let triedFallback = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.createMinimaxStream(params);
      } catch (err) {
        if (this.abort.signal.aborted) throw err;
        // Hard failure on M3 → fall back to the fast MiniMax model once and retry.
        if (!isTransientApiError(err) && this.activeModel === MAX_MODEL && !triedFallback) {
          triedFallback = true;
          this.minimaxFellBack = true;
          this.dropM3Reasoning(params.messages);
          this.setActiveModel(FAST_MODEL);
          const note: TimelineItem = {
            kind: 'system',
            id: randomUUID(),
            level: 'info',
            text: '↳ Switching to ArksAI Flash to finish.',
            ts: Date.now(),
          };
          this.emit({ type: 'timeline_item', item: note });
          continue;
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

  /** Anthropic-compatible base for MiniMax (…/anthropic), derived from the configured /v1 base. */
  private get minimaxAnthropicBase(): string {
    return config.minimaxBaseUrl.replace(/\/v1\/?$/, '') + '/anthropic';
  }

  /**
   * Call MiniMax (M3) on its Anthropic-compatible endpoint and adapt the response back into
   * the OpenAI streaming shape the agent loop consumes. We translate our OpenAI-format
   * messages + tools to Anthropic format on the way out, and Anthropic SSE events to
   * OpenAI-style deltas on the way back — so the rest of the loop is unchanged. Thinking is
   * left OFF (the M3 default on this endpoint) for fast, decisive tool use; `max_tokens` is
   * generous so a large tool payload (e.g. a full spreadsheet spec) isn't truncated.
   */
  private async createMinimaxStream(params: any): Promise<AsyncIterable<any>> {
    const { system, messages } = toAnthropicMessages(params.messages || []);
    const tools = (params.tools || []).map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    // Report mode → use the fast coding model directly. M3 reliably STALLS on report mode's
    // GIANT single-HTML output (the report system prompt is huge and M3 buffers it → ~20min),
    // whereas the fast model produces the same magazine-grade report ~4× faster. Code mode
    // keeps M3 (it succeeds there with the 150s patience). Once M3 has stalled on a code run,
    // also switch to the fast model for the rest of that run.
    // LEGAL → the FAST model (M2.7-highspeed) in every mode. A fresh live test settled this:
    // on a long bilingual UAE contract M3 produced a 34-char STUB and then froze the gate,
    // while M2.7-highspeed produced a complete 24k-char bilingual document (8.2k Arabic chars,
    // full clauses, eloquent MSA, lawyer footer) in ~4 min. (The earlier opinion-only bake-off
    // that favoured M3 doesn't hold for real document generation — M2.7 both completes AND is
    // higher quality here.)
    const isLegal = !!this.session.task?.startsWith('legal.');
    const useFast = this.minimaxFellBack || this.forceFastThisTurn || this.session.mode === 'report' || isLegal;
    const model = useFast ? config.minimaxFallbackModel : this.activeApiModel;
    // One-turn override is consumed here: the NEXT turn returns to Max (this.activeApiModel
    // is untouched, so only this stalled step ran on the fast model).
    this.forceFastThisTurn = false;
    const body: Record<string, unknown> = { model, max_tokens: 64000, system, messages, stream: true };
    if (tools.length) body.tools = tools;
    // fetch has NO built-in timeout, and M3 can be slow to even send response headers on a
    // big prompt — so the deadline must cover BOTH the headers wait AND body streaming, or
    // the run hangs forever. Arm it BEFORE the fetch. On the PRIMARY model (M3, code mode) a
    // timeout means M3 is over-buffering → trip a STALL so the loop falls back to the fast
    // model. M3's latency is MiniMax-serving-bound (server-side buffering, ~7s first byte,
    // 24–76s gaps — service_tier:priority doesn't help), so we're PATIENT (150s) to prefer
    // M3's quality and only fall back on the genuinely slow tail; the fast model gets a
    // generous cap (it legitimately takes ~1min). Env-overridable.
    const PRIMARY_MS = Number(process.env.MINIMAX_TURN_DEADLINE_MS || '150000') || 150_000;
    const FAST_MS = Number(process.env.MINIMAX_FAST_DEADLINE_MS || '240000') || 240_000;
    const totalMs = useFast ? FAST_MS : PRIMARY_MS;
    // Acquire a global concurrency slot BEFORE arming the turn deadline (so time spent
    // queued doesn't eat the deadline). This caps concurrent M3 streams so they can't
    // starve each other server-side (the root cause of the hang). Released when the
    // stream is fully consumed / errors / aborts.
    // One-time "this is taking longer" reassurance (quality-first: we let M3 finish a big
    // generation rather than bail to a weaker model, so a turn can legitimately run ~1–2min —
    // the user should KNOW it's working, not wonder if it hung). Fires once per run.
    const slowNotice = setTimeout(() => {
      if (this.abort.signal.aborted) return;
      // Cooldown so a multi-turn big build varies the line instead of repeating every turn.
      if (Date.now() - this.lastSlowAt < 60_000) return;
      this.lastSlowAt = Date.now();
      const line = SLOW_LINES[this.slowLineIdx % SLOW_LINES.length];
      this.slowLineIdx++;
      this.emitProgress(this.progressPhase, line);
    }, 55_000);
    let release: () => void;
    try {
      release = await minimaxLimiter.acquire(this.abort.signal);
    } catch (e) {
      clearTimeout(slowNotice); // never granted a slot (aborted while queued) — don't leak the timer
      throw e;
    }
    let releasedSlot = false;
    const releaseSlot = () => {
      if (releasedSlot) return;
      releasedSlot = true;
      clearTimeout(slowNotice);
      release();
    };
    const ac = new AbortController();
    // `trip` is set by the stream adapter once streaming starts; it REJECTS the in-flight
    // read so a stall unblocks the loop even if ac.abort() doesn't propagate to a hung socket
    // read (a real undici behavior — a mid-stream abort can leave read() pending forever,
    // which is exactly the operator's "code build hangs 9 min, no fallback" symptom).
    const stall: { tripped: boolean; trip?: () => void } = { tripped: false };
    // The HEADERS wait must be raced against the deadline too, not just aborted: M3 can buffer
    // server-side for minutes before sending ANY response byte on a big prompt, and ac.abort()
    // does NOT reliably reject a pending undici fetch that's still awaiting headers — so relying
    // on the abort alone leaves the turn hung at 0 tokens forever (observed on genuine M3 use:
    // legal code-mode drafting). Mirror the read-race: reject the await when the timer fires.
    let rejectHeaders: ((e: any) => void) | null = null;
    const headersDeadline = new Promise<never>((_, rej) => {
      rejectHeaders = rej;
    });
    headersDeadline.catch(() => {}); // never an unhandled rejection
    const totalTimer = setTimeout(() => {
      stall.tripped = true;
      ac.abort();
      stall.trip?.(); // unblocks a hung stream read (once streaming has begun)
      const e: any = new Error(`MiniMax (${model}) stalled — no response headers within ${totalMs / 1000}s.`);
      e.minimaxStall = true;
      rejectHeaders?.(e); // unblocks a hung HEADERS await (before streaming begins)
    }, totalMs);
    // A user INTERRUPT (Stop) must unblock a hung fetch promptly — abort the socket, trip the
    // mid-stream read race, and reject a pending headers await. This fires ONLY on an explicit
    // user abort; it adds NO time/token heuristic, so a slow-but-healthy run is never killed.
    const onUserAbort = () => {
      ac.abort();
      stall.trip?.(); // unblocks a hung mid-stream read (set once streaming begins)
      rejectHeaders?.(new Error('interrupted by user')); // unblocks a hung headers await
    };
    if (this.abort.signal.aborted) onUserAbort();
    else this.abort.signal.addEventListener('abort', onUserAbort, { once: true });
    let resp: Response;
    try {
      resp = await Promise.race([
        fetch(`${this.minimaxAnthropicBase}/v1/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.minimaxApiKey}`,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: ac.signal,
        }),
        headersDeadline,
      ]);
    } catch (e: any) {
      clearTimeout(totalTimer);
      releaseSlot(); // free the concurrency slot on a failed/aborted request
      if (stall.tripped || e?.minimaxStall) {
        const err: any = new Error(`MiniMax (${model}) stalled — no response within ${totalMs / 1000}s.`);
        err.minimaxStall = true; // → the loop falls back to the faster model
        throw err;
      }
      throw e;
    }
    if (!resp.ok || !resp.body) {
      clearTimeout(totalTimer);
      releaseSlot();
      const detail = await resp.text().catch(() => '');
      // Carry the HTTP status so the retry/fallback classifier treats 429/5xx as
      // transient (retry) and 4xx as hard (M3 → fast model fallback).
      const err: any = new Error(`MiniMax (Anthropic) ${resp.status}: ${detail.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }
    // Idle backstop ≥ the total deadline so a still-streaming-but-slow turn isn't cut off
    // before its patience window. The idle is now CONTENT-based (pings don't reset it), so a
    // genuine no-output stall trips it while a healthy big generation streams through.
    // HEAVY-TOOL EAGER FALLBACK — DISABLED BY DEFAULT (quality-first). We used to bail a
    // heavy generate_* off M3 after 30s, but bake-offs show M3 finishes a large 3-statement
    // model in ~107s with genuinely formula-driven, domain-aware output (higher quality than
    // the fast fallback, which DeepSeek-max can't even complete). With the concurrency limiter
    // preventing the starvation that the 30s timer was guarding against, M3 completes well
    // inside the 150s content-idle window — so let it finish. Set MINIMAX_HEAVY_TOOL_DEADLINE_MS
    // to a positive value to re-enable the eager fallback if ever needed.
    const heavyEnv = process.env.MINIMAX_HEAVY_TOOL_DEADLINE_MS;
    const heavyMs = heavyEnv !== undefined ? Math.max(0, Number(heavyEnv) || 0) : 0;
    return anthropicSseToOpenAI(resp.body as any, {
      controller: ac,
      idleMs: Math.max(totalMs, 120_000),
      totalTimer,
      stall,
      isPrimary: !useFast,
      heavyNames: HEAVY_GENERATORS,
      heavyMs,
      onDone: releaseSlot, // free the concurrency slot when the stream is fully consumed
    });
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
    try {
      args = call.args ? JSON.parse(call.args) : {};
    } catch {
      args = null;
    }
    argsSummary = tool && args ? tool.summarize(args) : call.args.slice(0, 120);
    // File-producing tools all flag the run as mutated so the completion gate fires — incl.
    // the document generators / renderer (a run that ONLY calls generate_pptx must still be gated).
    if (
      ['write_file', 'edit_file', 'git_commit', 'generate_spreadsheet', 'generate_doc', 'generate_pptx', 'render_report'].includes(
        call.name,
      )
    )
      this.mutated = true;
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
        result = 'Error: tool arguments were not valid JSON';
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
        const next = escalateModel(this.activeModel, { minimaxAvailable: this.minimaxAvailable });
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

    // 1b) Document deliverables (docx/xlsx/pptx/pdf from the generate_*/render tools) —
    //     render + functional + design-review them, bounded-revise. Web apps are covered by
    //     the live probe below; this gates the FILE deliverables that probe never sees.
    if (config.designGate && !this.abort.signal.aborted) {
      const review = await this.reviewDeliverables(dir);
      const { fail, defects } = review;
      if (fail) return failFix(fail.label, fail.detail);
      this.warnIfDesignGateSkipped(review, sys);
      // Bounded revise for documents (up to 2 — the deterministic checks are cheap). A weak
      // first model often botches a formula model (hard-coded or EMPTY cells) or leaves a thin
      // deliverable; re-prompting the SAME model rarely fixes it, so in Auto mode bring in the
      // other MiniMax tier to redo it.
      if (defects.length && this.designRounds < 2) {
        this.designRounds++;
        // Bring in a different model to redo a flagged document (re-prompting the same model
        // rarely fixes a hard-coded/empty deliverable). M3's first-pass spreadsheets are often
        // hard-coded, and the fast coding model (Flash / M2.7-highspeed) is strong at structured
        // formula output — so hand M3 → Flash (strip M3's reasoning_content first).
        if (isAutoModel(this.session.model) && this.activeModel === MAX_MODEL) {
          this.dropM3Reasoning(context);
          this.minimaxFellBack = true;
          this.setActiveModel(FAST_MODEL);
          sys('info', '↳ Bringing in ArksAI Flash to fix the document.');
        }
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

    // 2) Runtime + flow — for apps, ArksAI boots it and exercises the endpoints.
    const startCmd = detectStartCommand(dir);
    if (!startCmd) {
      sys('info', report.ran ? `✓ Verified — ${report.summary}` : report.summary);
      return 'ok';
    }

    // Clean any dev server the agent left running so the probe gets the port.
    processRegistry.killAllForSession(this.session.id);
    sys('info', '⟳ Booting the app and exercising its endpoints (seeding real data)…');
    this.emitProgress('testing', 'Booting a live instance…');
    const probe = await probeApp(this.session.id, dir, startCmd, this.abort.signal, {
      visual: this.taskProfile?.isVisual,
      onPhase: (label) => this.emitProgress('testing', label),
    });
    if (probe.ui?.visualReview) this.engineCostUsd += config.minimaxVisionCost; // vision spend
    if (!probe.booted || probe.serverErrors > 0) {
      return failFix(probe.serverErrors > 0 ? 'Runtime testing' : 'Booting the app', probe.detail, 'testing');
    }
    if (probe.ui?.hardFail) {
      return failFix('The browser check', probe.detail, 'testing');
    }
    // Gating DESIGN critique (visual tasks): the agent must fix concrete defects
    // and re-render, bounded — so the user gets a polished result without
    // iterating. Then PASS-with-warnings (never block on subjective taste).
    if (
      config.designGate &&
      this.taskProfile?.isVisual &&
      probe.ui?.designVerdict === 'revise' &&
      probe.ui.designDefects?.length
    ) {
      if (this.designRounds < MAX_DESIGN_ROUNDS) {
        this.designRounds++;
        const next = escalateModel(this.activeModel, { minimaxAvailable: this.minimaxAvailable });
        if (next !== this.activeModel) this.setActiveModel(next);
        this.emitProgress('polishing', `Design review — applying refinements (round ${this.designRounds})…`);
        sys('info', `↻ Design review flagged refinements — applying them (round ${this.designRounds}).`);
        context.push({
          role: 'user',
          content:
            `A design review of the rendered UI flagged these concrete, fixable issues. The result must look ` +
            `genuinely polished, so fix them and the page will be re-reviewed:\n- ${probe.ui.designDefects.join('\n- ')}`,
        });
        return 'retry';
      }
      sys('info', `✓ Verified — ${probe.detail}\n(design review noted minor items; delivering.)`);
      return 'ok';
    }
    sys('info', `✓ Verified — ${probe.detail}`);
    return 'ok';
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
      this.engineCostUsd += config.minimaxVisionCost * (qc.visionCalls || 0);
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
    if (config.minimaxApiKey && review.checked > review.gated) {
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
    if (!startCmd && (!hasDoc || !config.minimaxApiKey)) return 'ok';

    let docReviewed = false;
    let docMinorItems = false;
    if (hasDoc && config.minimaxApiKey) {
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
        onPhase: (label) => this.emitProgress('testing', label),
      });
      if (probe.ui?.visualReview) this.engineCostUsd += config.minimaxVisionCost;
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

// ─────────────────────────────────────────────────────────────────────────────
// MiniMax (M3) Anthropic-endpoint adapters. M3 only behaves on the Anthropic
// surface (thinking off by default → fast tool use); these translate between our
// OpenAI-shaped agent loop and the Anthropic wire format, in both directions.
// ─────────────────────────────────────────────────────────────────────────────

/** Translate OpenAI-format chat messages into Anthropic `{ system, messages }`. */
export function toAnthropicMessages(oai: any[]): { system: string; messages: any[] } {
  let system = '';
  const messages: any[] = [];
  for (const m of oai) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + String(m.content ?? '');
    } else if (m.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text: String(m.content ?? '') }] });
    } else if (m.role === 'assistant') {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      for (const tc of m.tool_calls ?? []) {
        let input: any = {};
        try {
          input = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
      }
      // Anthropic requires non-empty content on every message.
      messages.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
    } else if (m.role === 'tool') {
      // Tool results are user-turn content blocks; merge consecutive ones into one user message.
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') };
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else messages.push({ role: 'user', content: [block] });
    }
  }
  return { system, messages };
}

/** Map an Anthropic stop_reason to the OpenAI finish_reason the loop expects. */
export function mapAnthropicStop(reason: string | undefined): string | undefined {
  switch (reason) {
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'end_turn':
    case 'stop_sequence':
    case 'pause_turn':
      return 'stop';
    default:
      return reason || undefined;
  }
}

/**
 * Adapt an Anthropic Messages SSE stream into the OpenAI streaming-chunk shape the runner
 * already consumes (`delta.content` / `delta.tool_calls` / `delta.reasoning_content` /
 * `finish_reason` / `usage`). Tool-call args arrive as `input_json_delta`; the Anthropic
 * content-block index doubles as the OpenAI tool_call index (the loop filters gaps).
 */
export async function* anthropicSseToOpenAI(
  body: any,
  opts?: {
    controller?: AbortController;
    idleMs?: number;
    totalTimer?: ReturnType<typeof setTimeout>;
    stall?: { tripped: boolean; trip?: () => void };
    isPrimary?: boolean;
    heavyNames?: Set<string>;
    heavyMs?: number;
    onDone?: () => void;
  },
): AsyncIterable<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let inTok = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let outTok = 0;
  // Stall guards (M3 buffers tool-arg generation server-side, and concurrent streams can
  // stall indefinitely; fetch has no timeout). The caller (createMinimaxStream) owns the
  // TOTAL-turn timer (it must cover the headers wait too) + the shared `stall` flag; here we
  // add the IDLE backstop (resets on every chunk, fires on a long SILENCE). Either tripping
  // `stall` makes the read throw `.minimaxStall` so the loop falls back to the faster model.
  const idleMs = opts?.idleMs ?? 0;
  const ctrl = opts?.controller;
  const stall: { tripped: boolean; trip?: () => void } = opts?.stall ?? { tripped: false };
  const totalTimer = opts?.totalTimer;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let heavyTimer: ReturnType<typeof setTimeout> | undefined;
  // A stall must unblock the loop even when ac.abort() fails to reject a hung socket read
  // (undici can leave a pending read() hanging after a mid-stream abort). So every read is
  // raced against this promise, which the timers REJECT — guaranteeing minimaxStall is thrown
  // and the loop falls back, instead of hanging forever with 0 tokens.
  let rejectStall: ((e: any) => void) | null = null;
  const stallPromise = new Promise<never>((_, rej) => {
    rejectStall = rej;
  });
  stallPromise.catch(() => {}); // never surfaces as an unhandled rejection
  const tripStall = () => {
    if (stall.tripped) return;
    stall.tripped = true;
    try {
      ctrl?.abort();
    } catch {
      /* abort is best-effort */
    }
    const e: any = new Error('MiniMax (M3) stalled / over-buffered the turn.');
    e.minimaxStall = true;
    rejectStall?.(e);
  };
  stall.trip = tripStall; // the caller's TOTAL-turn timer trips us through this too
  const arm = () => {
    if (!idleMs) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(tripStall, idleMs);
  };
  const usageChunk = () => ({
    prompt_tokens: inTok + cacheRead + cacheCreate,
    completion_tokens: outTok,
    prompt_cache_hit_tokens: cacheRead,
    prompt_cache_miss_tokens: inTok + cacheCreate,
  });
  try {
    arm();
    for (;;) {
    if (stall.tripped) {
      const err: any = new Error('MiniMax (M3) stalled / over-buffered the turn.');
      err.minimaxStall = true;
      throw err;
    }
    let read;
    try {
      // Race the read against the stall promise so a hung socket can't block us even if the
      // abort didn't propagate. Swallow a late read() rejection if the stall wins the race.
      const readP = reader.read();
      void readP.catch(() => {});
      read = await Promise.race([readP, stallPromise]);
    } catch (e: any) {
      if (stall.tripped || e?.minimaxStall) {
        const err: any = new Error('MiniMax (M3) stalled / over-buffered the turn.');
        err.minimaxStall = true; // the loop uses this to fall back to the faster model
        throw err;
      }
      throw e;
    }
    const { done, value } = read;
    if (done) break;
    // Streaming has started, so the TOTAL-turn timer has done its job (it guards the
    // headers wait + initial server-side buffering). From here the IDLE timer governs:
    // a steadily-streaming but LONG generation — e.g. a big report's HTML streamed as
    // render_report's tool args over several minutes — must NOT be killed just for being
    // long; only a genuine mid-stream SILENCE (idleMs) should trip. (The heavy-generator
    // accelerator below still arms its own shorter timer for M3 on the primary model.)
    clearTimeout(totalTimer);
    // NOTE: do NOT re-arm the idle timer on every raw chunk. M3, when STARVED under
    // concurrency, sends keepalive *pings* with no content — re-arming on those would
    // (and did) let a no-progress stream hang forever. We re-arm ONLY on real content
    // (text / tool-args / thinking deltas + a block start) below, so a ping-only stall
    // trips the idle backstop and falls back. (Initial arm() above starts the window.)
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (!data) continue;
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      switch (ev.type) {
        case 'message_start': {
          const u = ev.message?.usage || {};
          inTok = u.input_tokens ?? 0;
          cacheRead = u.cache_read_input_tokens ?? 0;
          cacheCreate = u.cache_creation_input_tokens ?? 0;
          break;
        }
        case 'content_block_start': {
          arm(); // real progress (a block began) → reset the content idle window
          const cb = ev.content_block;
          if (cb?.type === 'tool_use') {
            // Heavy structured generator on the PRIMARY model → shorten the deadline. M3
            // over-buffers the (large) tool-call args; rather than wait the full patience
            // window, give it a brief chance then trip the stall so the loop re-issues the
            // turn on the fast model. (A small sheet still completes within heavyMs.)
            if (opts?.isPrimary && opts?.heavyMs && ctrl && opts.heavyNames?.has(cb.name)) {
              clearTimeout(totalTimer);
              clearTimeout(heavyTimer);
              heavyTimer = setTimeout(tripStall, opts.heavyMs);
            }
            yield {
              choices: [
                { delta: { tool_calls: [{ index: ev.index, id: cb.id, type: 'function', function: { name: cb.name, arguments: '' } }] } },
              ],
            };
          }
          break;
        }
        case 'content_block_delta': {
          const d = ev.delta;
          // Real content → reset the idle window (pings/keepalives do NOT, so a starved
          // ping-only stream still trips the backstop and falls back).
          if (d?.type === 'text_delta' || d?.type === 'thinking_delta' || d?.type === 'input_json_delta') arm();
          if (d?.type === 'text_delta') yield { choices: [{ delta: { content: d.text } }] };
          else if (d?.type === 'thinking_delta') yield { choices: [{ delta: { reasoning_content: d.thinking } }] };
          else if (d?.type === 'input_json_delta')
            yield { choices: [{ delta: { tool_calls: [{ index: ev.index, function: { arguments: d.partial_json } }] } }] };
          break;
        }
        case 'message_delta': {
          if (ev.usage?.output_tokens != null) outTok = ev.usage.output_tokens;
          const fr = mapAnthropicStop(ev.delta?.stop_reason);
          if (fr) yield { choices: [{ delta: {}, finish_reason: fr }] };
          break;
        }
        case 'message_stop': {
          yield { choices: [{ delta: {} }], usage: usageChunk() };
          break;
        }
        case 'error': {
          throw new Error(`MiniMax (Anthropic) stream error: ${JSON.stringify(ev.error).slice(0, 300)}`);
        }
      }
    }
    }
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    clearTimeout(heavyTimer);
    opts?.onDone?.(); // release the global concurrency slot once the stream is fully consumed
  }
}
