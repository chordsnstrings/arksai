import { create } from 'zustand';
import type {
  AgentEvent,
  CustomCommand,
  GlobalEvent,
  ModelInfo,
  SessionDetail,
  SessionMeta,
  TimelineItem,
  ToolCallRecord,
} from '@shared/types';

export interface Automation {
  goalCondition?: string;
  goalRounds: number;
  loopPrompt?: string;
  loopIntervalMs?: number;
}

export interface LiveState {
  items: TimelineItem[];
  pendingAssistant: { id: string; text: string } | null;
  pendingTools: { id: string; calls: ToolCallRecord[] } | null;
  running: boolean;
  elapsed: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  runningTasks: number;
}

const emptyLive = (): LiveState => ({
  items: [],
  pendingAssistant: null,
  pendingTools: null,
  running: false,
  elapsed: 0,
  tokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  runningTasks: 1,
});

interface StoreState {
  authed: boolean | null;
  sessions: SessionMeta[];
  activeId: string | null;
  live: Record<string, LiveState>;
  models: ModelInfo[];
  commands: CustomCommand[];
  canvasOpen: boolean;
  automation: Record<string, Automation>;

  setAuthed(v: boolean): void;
  setModels(models: ModelInfo[]): void;
  setCommands(commands: CustomCommand[]): void;
  toggleCanvas(open?: boolean): void;
  setAutomation(sessionId: string, a: Automation | null): void;
  setSessions(list: SessionMeta[]): void;
  upsertSession(meta: SessionMeta): void;
  removeSession(id: string): void;
  setActive(id: string | null): void;
  loadDetail(detail: SessionDetail): void;
  addUserMessage(sessionId: string, text: string): void;
  addLocalSystem(sessionId: string, text: string, level?: 'info' | 'error'): void;
  applyEvent(sessionId: string, ev: AgentEvent): void;
  applyGlobalEvent(ev: GlobalEvent): void;
}

export const useStore = create<StoreState>((set, get) => ({
  authed: null,
  sessions: [],
  activeId: null,
  live: {},
  models: [],
  commands: [],
  canvasOpen: false,
  automation: {},

  setAuthed: (v) => set({ authed: v }),
  setModels: (models) => set({ models }),
  setCommands: (commands) => set({ commands }),
  toggleCanvas: (open) => set((s) => ({ canvasOpen: open ?? !s.canvasOpen })),
  setAutomation: (sessionId, a) =>
    set((s) => {
      const next = { ...s.automation };
      if (a) next[sessionId] = a;
      else delete next[sessionId];
      return { automation: next };
    }),
  setSessions: (list) => set({ sessions: list }),

  upsertSession: (meta) =>
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === meta.id);
      const sessions = idx >= 0 ? s.sessions.map((x) => (x.id === meta.id ? meta : x)) : [meta, ...s.sessions];
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return { sessions };
    }),

  removeSession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    })),

  setActive: (id) => set({ activeId: id }),

  loadDetail: (detail) =>
    set((s) => ({
      live: {
        ...s.live,
        [detail.meta.id]: {
          ...emptyLive(),
          items: detail.timeline,
          running: detail.meta.status === 'running',
        },
      },
    })),

  addUserMessage: (sessionId, text) =>
    mutateLive(set, sessionId, (live) => ({
      ...live,
      items: [...live.items, { kind: 'user', id: `local-${Date.now()}`, text, ts: Date.now() }],
    })),

  addLocalSystem: (sessionId, text, level = 'info') =>
    mutateLive(set, sessionId, (live) => ({
      ...live,
      items: [...live.items, { kind: 'system', id: `cmd-${Date.now()}-${Math.random()}`, level, text, ts: Date.now() }],
    })),

  applyEvent: (sessionId, ev) => {
    mutateLive(set, sessionId, (live) => reduceEvent(live, ev));
    if (ev.type === 'session_meta_updated') {
      const existing = get().sessions.find((x) => x.id === ev.meta.id);
      if (existing) get().upsertSession({ ...existing, ...ev.meta });
    }
  },

  applyGlobalEvent: (ev) => {
    if (ev.type === 'session_status') get().upsertSession(ev.session);
    else if (ev.type === 'session_deleted') get().removeSession(ev.sessionId);
  },
}));

function mutateLive(
  set: (fn: (s: StoreState) => Partial<StoreState>) => void,
  sessionId: string,
  fn: (live: LiveState) => LiveState,
) {
  set((s) => ({ live: { ...s.live, [sessionId]: fn(s.live[sessionId] ?? emptyLive()) } }));
}

/** Fold a raw agent event into the renderable timeline state. */
function reduceEvent(live: LiveState, ev: AgentEvent): LiveState {
  switch (ev.type) {
    case 'run_started':
      return {
        ...live,
        running: true,
        elapsed: 0,
        runningTasks: 1,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      };

    case 'assistant_delta': {
      // Prose after tool calls closes the current tool group.
      const items = live.pendingTools
        ? [...live.items, { kind: 'tools', id: live.pendingTools.id, calls: live.pendingTools.calls, ts: Date.now() } as TimelineItem]
        : live.items;
      const pending = live.pendingAssistant ?? { id: `pa-${Date.now()}`, text: '' };
      return {
        ...live,
        items,
        pendingTools: null,
        pendingAssistant: { ...pending, text: pending.text + ev.text },
      };
    }

    case 'assistant_message_done': {
      if (!live.pendingAssistant) return live;
      return {
        ...live,
        items: [
          ...live.items,
          { kind: 'assistant', id: ev.messageId, text: live.pendingAssistant.text, ts: Date.now() },
        ],
        pendingAssistant: null,
      };
    }

    case 'tool_call_started': {
      const group = live.pendingTools ?? { id: `pt-${Date.now()}`, calls: [] };
      return {
        ...live,
        pendingTools: {
          ...group,
          calls: [
            ...group.calls,
            { callId: ev.callId, tool: ev.tool, argsSummary: ev.argsSummary, running: true },
          ],
        },
      };
    }

    case 'tool_call_finished': {
      if (!live.pendingTools) return live;
      return {
        ...live,
        pendingTools: {
          ...live.pendingTools,
          calls: live.pendingTools.calls.map((c) =>
            c.callId === ev.callId
              ? { ...c, running: false, ok: ev.ok, durationMs: ev.durationMs, outputPreview: ev.outputPreview }
              : c,
          ),
        },
      };
    }

    case 'usage_update':
      return {
        ...live,
        tokens: ev.totalTokens,
        promptTokens: ev.promptTokens,
        completionTokens: ev.completionTokens,
        cacheHitTokens: ev.cacheHitTokens,
        cacheMissTokens: ev.cacheMissTokens,
      };

    case 'tick':
      return { ...live, elapsed: ev.elapsedSeconds, runningTasks: ev.runningTasks };

    case 'run_finished': {
      let items = live.items;
      if (live.pendingTools) {
        items = [...items, { kind: 'tools', id: live.pendingTools.id, calls: live.pendingTools.calls, ts: Date.now() }];
      }
      if (live.pendingAssistant) {
        items = [
          ...items,
          { kind: 'assistant', id: live.pendingAssistant.id, text: live.pendingAssistant.text, ts: Date.now() },
        ];
      }
      return {
        ...live,
        items,
        pendingAssistant: null,
        pendingTools: null,
        running: false,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      };
    }

    case 'run_error':
      return {
        ...live,
        items: [
          ...live.items,
          { kind: 'system', id: `err-${Date.now()}`, level: 'error', text: ev.message, ts: Date.now() },
        ],
      };

    case 'clone_progress': {
      const text =
        ev.phase === 'cloning' ? ev.detail : ev.phase === 'done' ? '✓ ' + ev.detail : `Clone error: ${ev.detail}`;
      return {
        ...live,
        items: [
          ...live.items,
          {
            kind: 'system',
            id: `clone-${ev.phase}-${Date.now()}`,
            level: ev.phase === 'error' ? 'error' : 'info',
            text,
            ts: Date.now(),
          },
        ],
      };
    }

    case 'timeline_item': {
      // Replayed events can overlap the persisted timeline — dedupe by id.
      if (live.items.some((i) => i.id === ev.item.id)) return live;
      return { ...live, items: [...live.items, ev.item] };
    }

    case 'session_meta_updated':
      return live;

    default:
      return live;
  }
}
