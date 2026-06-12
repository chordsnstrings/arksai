import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { computeCost, type SessionMeta, type TimelineItem, type ToolCallRecord } from '../../../shared/types';
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
import { detectStartCommand, verifyProject } from './verify';
import { bootAndCheck } from './runtimeCheck';

const CONTEXT_TOKEN_BUDGET = 50_000; // deepseek-chat window is ~64k
const PREVIEW_CHARS = 700;

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
  private didRuntimeTest = false; // did the agent curl a running server this run?
  private flowRequired = false; // have we already asked it to demo the flow?
  private client: OpenAI;

  constructor(private session: SessionMeta) {
    this.client = new OpenAI({
      apiKey: config.deepseekApiKey || 'missing-key',
      baseURL: config.deepseekBaseUrl,
    });
  }

  interrupt() {
    this.abort.abort();
  }

  private emit(event: Parameters<typeof bus.emit>[1]) {
    bus.emit(this.session.id, event);
  }

  async run(userText: string): Promise<void> {
    const sessionId = this.session.id;
    const dir = repoDir(sessionId);
    const { schemas, map } = getToolsForMode(this.session.mode);
    const liveItems: TimelineItem[] = [];
    let finalStatus: SessionMeta['status'] = 'done';

    // Anything emitted before this run (e.g. uploads) is already persisted to
    // the timeline — drop it from the replay buffer so reconnects don't dupe.
    bus.clear(sessionId);
    await store.updateSession(sessionId, { status: 'running' });
    bus.sessionChanged((await store.getSession(sessionId))!);
    this.emit({ type: 'run_started', runId: this.runId, mode: this.session.mode });

    const context = await store.getContext(sessionId);
    context.push({ role: 'user', content: userText });

    // Memory: global (every session) + this repo's project memory + an optional
    // ARKS.md in the workspace. Loaded once and injected into the system prompt.
    const systemContent = buildSystemPrompt(this.session, dir, await this.loadMemoryBlock(dir));

    if (this.session.title === 'New session') {
      void this.generateTitleAsync(userText);
    }

    const ticker = setInterval(() => {
      this.emit({
        type: 'tick',
        elapsedSeconds: this.usage.elapsedSeconds,
        runningTasks: Math.max(1, this.runningTasks),
      });
    }, 1000);

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
          model: this.session.model,
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
            this.usage.add(chunk.usage as any);
            this.emit({
              type: 'usage_update',
              totalTokens: this.usage.totalTokens,
              promptTokens: this.usage.promptTokens,
              completionTokens: this.usage.completionTokens,
              cacheHitTokens: this.usage.cacheHitTokens,
              cacheMissTokens: this.usage.cacheMissTokens,
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
      for (const fileItem of await findDeliverables(dir, this.usage.startedAt)) {
        liveItems.push(fileItem);
        this.emit({ type: 'timeline_item', item: fileItem });
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
      const runCost = computeCost(this.session.model, {
        cacheHit: this.usage.cacheHitTokens,
        cacheMiss: this.usage.cacheMissTokens,
        completion: this.usage.completionTokens,
      });
      await store.updateSession(sessionId, {
        status: finalStatus,
        diffStat: stat,
        totalTokens: (prev.totalTokens ?? 0) + this.usage.totalTokens,
        promptTokens: (prev.promptTokens ?? 0) + this.usage.promptTokens,
        completionTokens: (prev.completionTokens ?? 0) + this.usage.completionTokens,
        costUsd: (prev.costUsd ?? 0) + runCost,
      });

      this.emit({
        type: 'run_finished',
        runId: this.runId,
        status: finalStatus,
        totalTokens: this.usage.totalTokens,
        diffStat: stat,
      });
      const finalMeta = await store.getSession(sessionId);
      if (finalMeta) bus.sessionChanged(finalMeta);
      bus.clear(sessionId);
    }
  }

  /** Retry transient API failures (network blips, 429/5xx) with backoff. */
  private async createCompletionWithRetry(params: any): Promise<AsyncIterable<any>> {
    const delays = [2000, 4000, 8000];
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.client.chat.completions.create(params, {
          signal: this.abort.signal,
        })) as unknown as AsyncIterable<any>;
      } catch (err) {
        if (this.abort.signal.aborted || attempt >= delays.length || !isTransientApiError(err)) {
          throw err;
        }
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
    const failFix = (label: string, detail: string): 'retry' | 'failed' => {
      sys('error', `✗ Verification failed: ${label}`);
      if (this.verifyRounds >= MAX_VERIFY) {
        this.emit({ type: 'run_error', runId: this.runId, message: `Verification still failing (${label}).` });
        return 'failed';
      }
      context.push({
        role: 'user',
        content: `Automated verification FAILED — ${label}. The task is NOT complete until this passes. Diagnose and fix it, then it will be re-checked.\n\n${detail}`,
      });
      return 'retry';
    };

    sys('info', '⟳ Verifying — running the project checks…');

    // 1) Static checks (typecheck / lint / test / build).
    const report = await verifyProject(dir, this.abort.signal).catch((e) => ({
      ran: false,
      ok: true,
      checks: [],
      summary: `Static verification skipped (${String(e?.message ?? e)}).`,
    }));
    if (report.ran && !report.ok) {
      const failing = report.checks.find((c) => !c.ok)!;
      return failFix(failing.name, failing.output);
    }

    // 2) Runtime + flow — only for apps (something to boot).
    const startCmd = detectStartCommand(dir);
    if (!startCmd) {
      sys('info', report.ran ? `✓ Verified — ${report.summary}` : report.summary);
      return 'ok';
    }

    if (this.didRuntimeTest) {
      sys('info', `✓ Verified — checks passed and the running app was exercised end-to-end.`);
      return 'ok';
    }

    // The agent hasn't exercised the live app. Ask it to once.
    if (!this.flowRequired) {
      this.flowRequired = true;
      sys('info', '⟳ App not yet exercised — requesting an end-to-end flow check…');
      context.push({
        role: 'user',
        content:
          `Static checks pass, but you have NOT demonstrated the app actually runs. Before completing you MUST: ` +
          `start the app with bash_background, then use bash + curl to exercise the main flow with real data ` +
          `(e.g. POST a record then GET it back, or hit the key pages) and show the request and response. ` +
          `Start command looks like: ${startCmd}. Then finish.`,
      });
      return 'retry';
    }

    // Backstop: it still didn't test, so boot it ourselves and check it serves.
    sys('info', '⟳ Booting the app to confirm it runs…');
    const rt = await bootAndCheck(this.session.id, dir, startCmd, this.abort.signal);
    if (!rt.booted) return failFix('the app does not run', rt.detail);
    sys('info', `✓ Verified — ${rt.detail} (boot confirmed by ArksAI).`);
    return 'ok';
  }

  /** Build the "## Memory" block: global + this repo's project memory + ARKS.md. */
  private async loadMemoryBlock(dir: string): Promise<string> {
    const scopes = ['global'];
    if (this.session.repoName) scopes.push(this.session.repoName);
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

    if (global.length === 0 && project.length === 0) return '';
    let block = '## Memory — persistent context you must respect';
    if (global.length) block += `\n\nAbout the user (applies to every session):\n${global.join('\n')}`;
    if (project.length)
      block += `\n\nAbout this project${this.session.repoName ? ` (${this.session.repoName})` : ''}:\n${project.join('\n')}`;
    return block;
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
