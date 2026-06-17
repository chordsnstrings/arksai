import OpenAI from 'openai';
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
import { generateTitle } from './titleGen';
import { makeThinkFilter } from './thinkFilter';
import { Usage } from './usage';
import { checkLabel, detectStartCommand, verifyProject } from './verify';
import { probeApp } from './runtimeCheck';
import { checkDeliverable, type DeliverableKind } from './deliverableCheck';
import { processRegistry } from './processes';
import { buildExportArchive, detectRenderable, looksLikeProject, startPreviewServer } from './canvasExport';
import { escalateModel, resolveProvider, selectModel } from './router';
import { classifyTask, type TaskProfile } from './taskProfile';
import { isAutoModel, MAX_MODEL, phaseFloor, phaseCeiling, type ProgressPhase } from '../../../shared/types';

const CONTEXT_TOKEN_BUDGET = 50_000; // deepseek-chat window is ~64k
const PREVIEW_CHARS = 700;
const MAX_DESIGN_ROUNDS = 2; // bounded internal design-critique iterations
const REPORT_MAX_DESIGN_ROUNDS = 2; // report mode: quality-first revise cap (deterministic pre-check keeps rounds cheap)
// Tools that emit ONE large structured output (the whole spreadsheet/deck/doc as tool-call
// args). M3 reliably over-buffers these server-side → it would burn the full 150s patience
// before falling back. When one of these starts on the PRIMARY model we shorten the deadline
// so we fall back to the fast model quickly instead (the fast coding model handles big
// structured output well). Env-tunable via MINIMAX_HEAVY_TOOL_DEADLINE_MS.
const HEAVY_GENERATORS = new Set(['generate_spreadsheet', 'generate_pptx', 'generate_doc']);

interface AccToolCall {
  id: string;
  name: string;
  args: string;
}

function estimateTokens(messages: unknown): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

const DELIVERABLE_GLOB =
  '**/*.{xlsx,xls,csv,pdf,docx,doc,pptx,png,jpg,jpeg,svg,zip,tar,gz,tgz,tar.gz,mp3,wav,mp4,json}';

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
function isTransientApiError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 400) return false;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const msg = String(err?.message ?? err);
  return /resolve|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|private\/reserved IP/i.test(
    msg,
  );
}

/**
 * Keep the context under the model window for long-running sessions:
 * first shrink old tool outputs, then drop the oldest messages entirely
 * (long chats have no tool output to shrink).
 */
function truncateContext(context: any[]) {
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
  private progressPct = 0; // monotonic 0–100 for the live progress bar (never regresses)
  private progressPhase: ProgressPhase = 'understanding';
  private pendingMode: SessionMode | null = null; // set by switch_mode; applied between tool batches
  private planSubmitted = false; // set by submit_plan; ends the turn awaiting the user's nod
  private planResolved = false; // this run answers a pending plan → plan→code is allowed
  private client: OpenAI; // DeepSeek (also used for title gen)
  private minimaxClient: OpenAI | null = null;
  private minimaxAvailable = !!config.minimaxApiKey;
  // Set once M3 has stalled on this run; subsequent MiniMax turns use the faster
  // fallback coding model instead (the user's "M3, but fall back if slow" choice).
  private minimaxFellBack = false;
  // The concrete model the orchestrator is using right now (resolved from the
  // session model, which may be the virtual 'arksai-auto').
  private activeModel = '';
  private activeApiModel = '';
  private activePricingId = '';
  private activeClient!: OpenAI;

  constructor(private session: SessionMeta) {
    this.client = new OpenAI({
      apiKey: config.deepseekApiKey || 'missing-key',
      baseURL: config.deepseekBaseUrl,
    });
  }

  private clientFor(provider: 'deepseek' | 'minimax'): OpenAI {
    if (provider === 'minimax') {
      if (!this.minimaxClient) {
        this.minimaxClient = new OpenAI({
          apiKey: config.minimaxApiKey || 'missing-key',
          baseURL: config.minimaxBaseUrl,
          timeout: 180_000, // M3 can be slow — bound a hung request so the DeepSeek fallback can fire
        });
      }
      return this.minimaxClient;
    }
    return this.client;
  }

  /** Point the run at a concrete model (resolving provider + real API id). */
  private setActiveModel(modelId: string) {
    const r = resolveProvider(modelId);
    this.activeModel = modelId;
    this.activeApiModel = r.apiModel;
    this.activePricingId = r.pricingId;
    this.activeClient = this.clientFor(r.provider);
  }

  /** When falling back M3 → DeepSeek mid-conversation, drop M3's reasoning_content from the
   *  history: it's M3/Anthropic-specific and DeepSeek's thinking mode 400s on it ("reasoning_content
   *  must be passed back"). The objects are shared with `context` (same refs), so this cleans both.
   *  DeepSeek then thinks fresh going forward (its own reasoning_content accumulates validly). */
  private dropM3Reasoning(msgs: any[]) {
    for (const m of msgs ?? []) if (m && m.role === 'assistant' && 'reasoning_content' in m) delete m.reasoning_content;
  }

  interrupt() {
    this.abort.abort();
  }

  /**
   * Emit a live progress beat. The bar advertises the (deliberately visible)
   * expert work at each stage. pct is clamped monotonic: entering a phase snaps
   * up to its floor; finer beats within a phase nudge toward its ceiling — but it
   * never goes backward (a self-healing retry must read as forward motion).
   */
  private emitProgress(phase: ProgressPhase, label: string, detail?: string) {
    this.progressPhase = phase;
    const floor = phaseFloor(phase);
    const ceil = phaseCeiling(phase);
    // Nudge a little past the current value within the band, capped at the ceiling.
    const target = Math.min(ceil, Math.max(floor, this.progressPct + 2));
    this.progressPct = Math.max(this.progressPct, target);
    this.emit({ type: 'progress', phase, label, pct: Math.round(this.progressPct), detail });
  }

  private emit(event: Parameters<typeof bus.emit>[1]) {
    bus.emit(this.session.id, event);
  }

  /** A stronger model the current mode demands, or null. Reports + non-trivial
   *  visual code builds shouldn't run on the cheapest brain. */
  private floorModel(): string | null {
    if (this.activeModel !== 'deepseek-v4-flash') return null;
    const strong = this.minimaxAvailable ? MAX_MODEL : 'deepseek-v4-pro';
    if (this.session.mode === 'report') return strong;
    if (this.session.mode === 'code' && this.taskProfile?.isVisual && this.taskProfile.tier !== 'light') return strong;
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

    // Memory: global (every session) + this repo's project memory + an optional
    // ARKS.md in the workspace. Kept around so a mode switch can rebuild the prompt.
    let memoryBlock = await this.loadMemoryBlock(dir);
    let systemContent = buildSystemPrompt(this.session, dir, memoryBlock, this.taskProfile);

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
      const STALL_LIMIT = 6;
      const EMPTY_RETRY_LIMIT = 2; // a thinking model that truncates mid-reasoning gets a couple of nudged retries
      let stallSig = '';
      let stallCount = 0;
      let emptyRetries = 0;
      let iteration = 0;
      let stopReason: 'natural' | 'ceiling' | 'stall' | null = null;
      while (!this.abort.signal.aborted) {
        iteration++;
        if (iteration > maxIterations) {
          stopReason = 'ceiling';
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
          if (chunk.usage) {
            const u: any = chunk.usage;
            this.usage.add(u);
            // Cost is computed per concrete model so Auto mode blends correctly.
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
        }
        } catch (err: any) {
          // M3 over-buffered/stalled this turn → fall back to the RELIABLE DeepSeek workhorse
          // and redo the turn (once). NOT to another MiniMax model: M2.7-highspeed always-thinks
          // and stalls AGAIN on tool-use turns, so the run would hang then die with nothing built
          // (the operator's 9-min code-build hang). deepseek-v4-pro finishes; the verify/report
          // gates guard quality. Mirrors the fetch-time hard-failure fallback (createCompletionWithRetry).
          if (err?.minimaxStall && !this.minimaxFellBack && resolveProvider(this.activeModel).provider === 'minimax') {
            this.minimaxFellBack = true;
            // Fall back to the NON-THINKING DeepSeek model: a thinking model (v4-pro) 400s when
            // continuing M3's history ("reasoning_content … must be passed back"), but the
            // non-thinking model imposes no such rule and reliably finishes. Strip M3's
            // reasoning_content too so the history is a clean, standard tool-use transcript.
            this.setActiveModel('deepseek-chat');
            this.dropM3Reasoning(context);
            sysInfo(`↳ ArksAI Max was slow — switching to ArksAI Flash to finish reliably.`);
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
          systemContent = buildSystemPrompt(this.session, dir, memoryBlock, this.taskProfile);
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

  /** Retry transient API failures (network blips, 429/5xx) with backoff. Uses
   *  whatever model the orchestrator is currently on; if a MiniMax call fails
   *  with a hard error (its endpoint/tool-calling is unvalidated), fall back to
   *  DeepSeek Pro once so the run keeps going. */
  private async createCompletionWithRetry(params: any): Promise<AsyncIterable<any>> {
    const delays = [2000, 4000, 8000];
    let triedFallback = false;
    for (let attempt = 0; ; attempt++) {
      try {
        // MiniMax M3 goes through the ANTHROPIC-compatible endpoint, not the OpenAI one.
        // Why it matters (verified live): on the OpenAI surface (/v1) M3's thinking is forced
        // ON and unbounded — it reasons for minutes and never emits a tool call (0 tool calls
        // in 150s on a real agent prompt), which our token budget then truncates into a silent
        // empty turn (the spreadsheet hang). Every documented thinking-control knob
        // (reasoning_effort, thinking, enable_thinking, chat_template_kwargs) is IGNORED there.
        // On the Anthropic surface (/anthropic/v1/messages) M3 thinking is OFF by default, so
        // it acts immediately — it called generate_spreadsheet in ~2.8s in the same scenario.
        // We translate our OpenAI-shaped loop to/from the Anthropic wire format (see
        // createMinimaxStream) so nothing else in the agent loop changes.
        if (resolveProvider(this.activeModel).provider === 'minimax') {
          return await this.createMinimaxStream(params);
        }
        return (await this.activeClient.chat.completions.create(
          { ...params, model: this.activeApiModel } as any,
          { signal: this.abort.signal },
        )) as unknown as AsyncIterable<any>;
      } catch (err) {
        if (this.abort.signal.aborted) throw err;
        // Hard failure on MiniMax → fall back to DeepSeek Pro and retry once.
        if (!isTransientApiError(err) && this.activeModel === MAX_MODEL && !triedFallback) {
          triedFallback = true;
          // Non-thinking DeepSeek finishes reliably when inheriting M3's history (a thinking
          // model 400s on it). params.messages share object refs with context → also cleans it.
          this.setActiveModel('deepseek-chat');
          this.dropM3Reasoning(params.messages);
          const note: TimelineItem = {
            kind: 'system',
            id: randomUUID(),
            level: 'info',
            text: '↳ MiniMax was unavailable — falling back to ArksAI Flash.',
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
    // EXCEPTION — Legal stays on M3 even in report mode. A live bake-off showed the fast
    // model (M2.7, an "always-think" coding model) spends its whole budget on a thinking
    // block and returns ZERO usable text on long legal drafting, whereas M3 produces
    // law-firm-grade bilingual output. Legal quality > the report-mode latency saving.
    const isLegal = !!this.session.task?.startsWith('legal.');
    const useFast = this.minimaxFellBack || (this.session.mode === 'report' && !isLegal);
    const model = useFast ? config.minimaxFallbackModel : this.activeApiModel;
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
    const totalMs = useFast ? 240_000 : PRIMARY_MS;
    const ac = new AbortController();
    // `trip` is set by the stream adapter once streaming starts; it REJECTS the in-flight
    // read so a stall unblocks the loop even if ac.abort() doesn't propagate to a hung socket
    // read (a real undici behavior — a mid-stream abort can leave read() pending forever,
    // which is exactly the operator's "code build hangs 9 min, no fallback" symptom).
    const stall: { tripped: boolean; trip?: () => void } = { tripped: false };
    if (this.abort.signal.aborted) ac.abort();
    else this.abort.signal.addEventListener('abort', () => ac.abort(), { once: true });
    const totalTimer = setTimeout(() => {
      stall.tripped = true;
      ac.abort();
      stall.trip?.();
    }, totalMs);
    let resp: Response;
    try {
      resp = await fetch(`${this.minimaxAnthropicBase}/v1/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.minimaxApiKey}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e: any) {
      clearTimeout(totalTimer);
      if (stall.tripped) {
        const err: any = new Error(`MiniMax (${model}) stalled — no response within ${totalMs / 1000}s.`);
        err.minimaxStall = true; // → the loop falls back to the faster model
        throw err;
      }
      throw e;
    }
    if (!resp.ok || !resp.body) {
      clearTimeout(totalTimer);
      const detail = await resp.text().catch(() => '');
      // Carry the HTTP status so the retry/fallback classifier treats 429/5xx as
      // transient (retry on M3) and 4xx as hard (fall back to DeepSeek Pro).
      const err: any = new Error(`MiniMax (Anthropic) ${resp.status}: ${detail.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }
    // Idle backstop ≥ the total deadline so a still-streaming-but-slow turn isn't cut off
    // before its patience window (M3 gaps run 24–76s; the total deadline governs).
    // On the PRIMARY model (M3, code mode), a heavy structured-output tool call gets a SHORT
    // deadline once it starts streaming — M3 over-buffers these, so we'd rather fall back to
    // the fast model in ~30s than wait the full 150s. (No effect once useFast is set.)
    const heavyMs = Number(process.env.MINIMAX_HEAVY_TOOL_DEADLINE_MS || '30000') || 30_000;
    return anthropicSseToOpenAI(resp.body as any, {
      controller: ac,
      idleMs: Math.max(totalMs, 120_000),
      totalTimer,
      stall,
      isPrimary: !useFast,
      heavyNames: HEAVY_GENERATORS,
      heavyMs,
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
      // ONE bounded revise for documents: re-authoring a whole sheet/doc/deck is expensive, so
      // a 2nd round doubles the time for diminishing returns. Cap at 1 + demand targeted edits.
      if (defects.length && this.designRounds < 1) {
        this.designRounds++;
        this.emitProgress('polishing', 'Design review — applying refinements…');
        sys('info', '↻ Design review of the document flagged refinements — applying them.');
        context.push({
          role: 'user',
          content: `A design review of the rendered document flagged these concrete, fixable issues. Make MINIMAL, TARGETED edits to fix ONLY these — do NOT regenerate the whole document — then it will be re-reviewed:\n- ${defects.join('\n- ')}`,
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
    // Always use the non-thinking alias: v4 models default to thinking mode and
    // would spend the small token budget on reasoning, returning an empty title.
    const title = await generateTitle(this.client, 'deepseek-chat', userText);
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
    arm(); // reset idle timer on activity
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
  }
}
