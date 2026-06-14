import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { computeCost, KNOWN_MODELS, type SessionMeta, type SessionMode, type TimelineItem, type ToolCallRecord } from '../../../shared/types';
import { config } from '../config';
import { bus } from '../events/bus';
import * as store from '../sessions/store';
import { diffStat, repoDir } from '../sessions/workspace';
import { scrubSecrets } from '../lib/exec';
import { buildSystemPrompt } from './prompts';
import { getToolsForMode } from './tools';
import { ToolError, type ToolCtx } from './tools/common';
import { generateTitle } from './titleGen';
import { Usage } from './usage';
import { checkLabel, detectStartCommand, verifyProject } from './verify';
import { probeApp } from './runtimeCheck';
import { processRegistry } from './processes';
import { buildExportArchive, detectRenderable, looksLikeProject, startPreviewServer } from './canvasExport';
import { escalateModel, resolveProvider, selectModel } from './router';
import { classifyTask, type TaskProfile } from './taskProfile';
import { isAutoModel, MAX_MODEL, phaseFloor, phaseCeiling, type ProgressPhase } from '../../../shared/types';

const CONTEXT_TOKEN_BUDGET = 50_000; // deepseek-chat window is ~64k
const PREVIEW_CHARS = 700;
const MAX_DESIGN_ROUNDS = 2; // bounded internal design-critique iterations

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

const MODE_LABELS: Record<SessionMode, string> = {
  chat: 'Chat',
  plan: 'Plan',
  code: 'Build (Code)',
  report: 'Report',
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

/** Pick the best freshly-produced document to auto-open in the canvas. */
function pickPreviewDoc(items: TimelineItem[]): { path: string; kind: 'pdf' | 'sheet' | 'doc' } | null {
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
  private client: OpenAI; // DeepSeek (also used for title gen)
  private minimaxClient: OpenAI | null = null;
  private minimaxAvailable = !!config.minimaxApiKey;
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

  /** Inject a note so the text-only agent knows an image was uploaded and (if
   *  vision is on) to see_image it. Only recent uploads, so old ones don't nag. */
  private noteUploadedImages(dir: string, context: any[]) {
    try {
      const upDir = path.join(dir, 'uploads');
      if (!fs.existsSync(upDir)) return;
      const cutoff = Date.now() - 20 * 60_000;
      const imgs = fs
        .readdirSync(upDir)
        .filter((f) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f))
        .filter((f) => {
          try {
            return fs.statSync(path.join(upDir, f)).mtimeMs >= cutoff;
          } catch {
            return false;
          }
        })
        .slice(0, 8);
      if (!imgs.length) return;
      const paths = imgs.map((f) => `uploads/${f}`).join(', ');
      context.push({
        role: 'user',
        content: this.minimaxAvailable
          ? `[System note: the user uploaded image file(s): ${paths}. You are text-only — if the request relates to them, call see_image with the path to view each one before answering. Do not guess their contents.]`
          : `[System note: image file(s) were uploaded (${paths}), but image viewing is unavailable (MINIMAX_API_KEY is not set). Tell the user you can't view images right now rather than guessing.]`,
      });
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

    // Make UPLOADED IMAGES visible to the text-only agent: it can't read an image,
    // so tell it the file exists and (if vision is on) to see_image it. Without
    // this the agent has no idea a photo was uploaded.
    this.noteUploadedImages(dir, context);

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
      let stallSig = '';
      let stallCount = 0;
      let iteration = 0;
      let stopReason: 'natural' | 'ceiling' | 'stall' | null = null;
      while (!this.abort.signal.aborted) {
        iteration++;
        if (iteration > maxIterations) {
          stopReason = 'ceiling';
          break;
        }
        truncateContext(context);

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

        let text = '';
        const toolCalls: AccToolCall[] = [];

        for await (const chunk of stream) {
          const delta: any = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            text += delta.content;
            this.emit({ type: 'assistant_delta', runId: this.runId, text: delta.content });
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

        const calls = toolCalls.filter(Boolean);
        if (text.trim()) {
          const messageId = randomUUID();
          this.emit({ type: 'assistant_message_done', runId: this.runId, messageId });
          liveItems.push({ kind: 'assistant', id: messageId, text, ts: Date.now() });
        }
        context.push({
          role: 'assistant',
          content: text || null,
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
          memoryBlock = await this.loadMemoryBlock(dir);
          systemContent = buildSystemPrompt(this.session, dir, memoryBlock, this.taskProfile);
          this.routeModel(userText, sysInfo);
          sysInfo(`↳ Switched to ${MODE_LABELS[newMode]} mode.`);
          this.emit({ type: 'session_meta_updated', meta: { id: sessionId, mode: newMode } });
          const meta = await store.getSession(sessionId);
          if (meta) bus.sessionChanged(meta);
          this.emitProgress(
            'building',
            newMode === 'report' ? 'Designing your report…' : newMode === 'code' ? 'Building it…' : 'Working on it…',
          );
          stallSig = ''; // a fresh mode means a fresh batch — don't false-trip the stall guard
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
        const msg = `Stopped: repeated the same action ${STALL_LIMIT}× with no progress — it likely needs your input.`;
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
      let openCanvasEvent: { port?: number; file?: string; kind?: 'app' | 'pdf' | 'sheet' | 'doc' } | null = null;
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
        return (await this.activeClient.chat.completions.create(
          { ...params, model: this.activeApiModel },
          { signal: this.abort.signal },
        )) as unknown as AsyncIterable<any>;
      } catch (err) {
        if (this.abort.signal.aborted) throw err;
        // Hard failure on MiniMax → fall back to DeepSeek Pro and retry once.
        if (!isTransientApiError(err) && this.activeModel === MAX_MODEL && !triedFallback) {
          triedFallback = true;
          this.setActiveModel('deepseek-v4-pro');
          const note: TimelineItem = {
            kind: 'system',
            id: randomUUID(),
            level: 'info',
            text: '↳ MiniMax was unavailable — falling back to ArksAI Pro.',
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
    if (['write_file', 'edit_file', 'git_commit'].includes(call.name)) this.mutated = true;
    if (call.name === 'publish_app') this.emitProgress('publishing', 'Putting it online & checking the live URL…');
    if (call.name === 'bash' && typeof args?.command === 'string') {
      const cmd = args.command as string;
      if (/(curl|wget|http)\b/i.test(cmd) && /(localhost|127\.0\.0\.1|0\.0\.0\.0|:\d{4})/.test(cmd)) {
        this.didRuntimeTest = true;
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
        sys('error', `✗ Couldn't get past: ${label}.`);
        this.emit({ type: 'run_error', runId: this.runId, message: `Verification still failing (${label}).` });
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

  /** Build the persistent-context block: the Project (instructions + knowledge +
   *  branding), then Memory (global + repo + project scope) + ARKS.md. */
  private async loadMemoryBlock(dir: string): Promise<string> {
    const scopes = ['global'];
    if (this.session.repoName) scopes.push(this.session.repoName);
    if (this.session.projectId) scopes.push(`project:${this.session.projectId}`);
    const entries = await store.listMemory(scopes).catch(() => []);
    const global = entries.filter((e) => e.scope === 'global').map((e) => `- ${e.text}`);
    const project = entries.filter((e) => e.scope !== 'global').map((e) => `- ${e.text}`);

    // Optional ARKS.md committed in the repo (Claude-Code-style project memory).
    try {
      const md = fs.readFileSync(path.join(dir, 'ARKS.md'), 'utf8').trim();
      if (md) project.push(md.slice(0, 4000));
    } catch {
      /* no ARKS.md */
    }

    const blocks: string[] = [];

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

  private async generateTitleAsync(userText: string) {
    // Always use the non-thinking alias: v4 models default to thinking mode and
    // would spend the small token budget on reasoning, returning an empty title.
    const title = await generateTitle(this.client, 'deepseek-chat', userText);
    if (!title) return;
    await store.updateSession(this.session.id, { title });
    bus.sessionChanged((await store.getSession(this.session.id))!);
  }
}
