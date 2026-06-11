import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import type { SessionMeta, TimelineItem, ToolCallRecord } from '../../../shared/types';
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

const MAX_ITERATIONS = 40;
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

/** Shrink oldest tool outputs when the context approaches the model window. */
function truncateContext(context: any[]) {
  if (estimateTokens(context) < CONTEXT_TOKEN_BUDGET) return;
  for (const msg of context) {
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 200) {
      msg.content = `[tool output elided to save context, was ${msg.content.length} chars]`;
      if (estimateTokens(context) < CONTEXT_TOKEN_BUDGET) return;
    }
  }
}

export class AgentRun {
  readonly runId = randomUUID();
  private abort = new AbortController();
  private usage = new Usage();
  private runningTasks = 0;
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
    store.updateSession(sessionId, { status: 'running' });
    bus.sessionChanged(store.getSession(sessionId)!);
    this.emit({ type: 'run_started', runId: this.runId, mode: this.session.mode });

    const context = store.getContext(sessionId);
    context.push({ role: 'user', content: userText });

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
      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        if (this.abort.signal.aborted) break;
        truncateContext(context);

        const stream = await this.client.chat.completions.create(
          {
            model: this.session.model,
            messages: [
              { role: 'system', content: buildSystemPrompt(this.session, dir) },
              ...context,
            ],
            tools: schemas.length ? (schemas as any) : undefined,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: this.abort.signal },
        );

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
            this.usage.add(chunk.usage);
            this.emit({
              type: 'usage_update',
              totalTokens: this.usage.totalTokens,
              promptTokens: this.usage.promptTokens,
              completionTokens: this.usage.completionTokens,
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

        if (calls.length === 0) break; // natural end of turn

        const groupRecords: ToolCallRecord[] = [];
        for (const call of calls) {
          if (this.abort.signal.aborted) break;
          const result = await this.executeTool(call, map, dir, groupRecords);
          context.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
        liveItems.push({ kind: 'tools', id: randomUUID(), calls: groupRecords, ts: Date.now() });

        if (iteration === MAX_ITERATIONS) {
          this.emit({
            type: 'run_error',
            runId: this.runId,
            message: `Iteration limit (${MAX_ITERATIONS}) reached — stopping.`,
          });
          liveItems.push({
            kind: 'system',
            id: randomUUID(),
            level: 'error',
            text: `Iteration limit (${MAX_ITERATIONS}) reached.`,
            ts: Date.now(),
          });
          finalStatus = 'error';
        }
      }
      if (this.abort.signal.aborted) finalStatus = 'idle';
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
      for (const item of liveItems) store.appendTimeline(sessionId, item);
      store.setContext(sessionId, context);
      store.updateSession(sessionId, {
        status: finalStatus,
        diffStat: stat,
        totalTokens: (store.getSession(sessionId)?.totalTokens ?? 0) + this.usage.totalTokens,
      });

      this.emit({
        type: 'run_finished',
        runId: this.runId,
        status: finalStatus,
        totalTokens: this.usage.totalTokens,
        diffStat: stat,
      });
      bus.sessionChanged(store.getSession(sessionId)!);
      bus.clear(sessionId);
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

  private async generateTitleAsync(userText: string) {
    const title = await generateTitle(this.client, 'deepseek-chat', userText);
    if (!title) return;
    store.updateSession(this.session.id, { title });
    bus.sessionChanged(store.getSession(this.session.id)!);
  }
}
