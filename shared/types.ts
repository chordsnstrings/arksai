/**
 * Shared contract between server and client.
 * The AgentEvent union drives the server emitter, the SSE payloads and the
 * client timeline reducer — change it here and both sides follow.
 */

export type SessionMode = 'plan' | 'code';
export type SessionStatus = 'idle' | 'running' | 'done' | 'error';
export type ModelId = 'deepseek-chat' | 'deepseek-reasoner';

export const MODELS: ModelId[] = ['deepseek-chat', 'deepseek-reasoner'];

export interface SessionMeta {
  id: string;
  title: string;
  repoUrl: string | null;
  repoName: string | null;
  branch: string | null;
  mode: SessionMode;
  model: ModelId;
  status: SessionStatus;
  diffStat: string | null;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCallRecord {
  callId: string;
  tool: string;
  argsSummary: string;
  running: boolean;
  ok?: boolean;
  durationMs?: number;
  outputPreview?: string;
}

export type TimelineItem =
  | { kind: 'user'; id: string; text: string; ts: number }
  | { kind: 'assistant'; id: string; text: string; ts: number }
  | { kind: 'tools'; id: string; calls: ToolCallRecord[]; ts: number }
  | { kind: 'system'; id: string; level: 'info' | 'error'; text: string; ts: number };

export type AgentEvent =
  | { type: 'run_started'; runId: string; mode: SessionMode }
  | { type: 'assistant_delta'; runId: string; text: string }
  | { type: 'assistant_message_done'; runId: string; messageId: string }
  | {
      type: 'tool_call_started';
      runId: string;
      callId: string;
      tool: string;
      argsSummary: string;
    }
  | {
      type: 'tool_call_finished';
      runId: string;
      callId: string;
      ok: boolean;
      durationMs: number;
      outputPreview: string;
    }
  | {
      type: 'usage_update';
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
    }
  | { type: 'tick'; elapsedSeconds: number; runningTasks: number }
  | {
      type: 'run_finished';
      runId: string;
      status: SessionStatus;
      totalTokens: number;
      diffStat: string | null;
    }
  | { type: 'run_error'; runId: string; message: string }
  | { type: 'session_meta_updated'; meta: Partial<SessionMeta> & { id: string } }
  | { type: 'clone_progress'; phase: 'cloning' | 'done' | 'error'; detail: string };

/** Lightweight event broadcast on the global channel for the sidebar. */
export type GlobalEvent = { type: 'session_status'; session: SessionMeta } | {
  type: 'session_deleted';
  sessionId: string;
};

// ---- REST DTOs ----

export interface LoginRequest {
  password: string;
}

export interface CreateSessionRequest {
  repoUrl?: string;
  branch?: string;
  mode?: SessionMode;
  model?: ModelId;
}

export interface SendMessageRequest {
  text: string;
}

export interface PatchSessionRequest {
  mode?: SessionMode;
  model?: ModelId;
}

export interface SessionDetail {
  meta: SessionMeta;
  timeline: TimelineItem[];
}
