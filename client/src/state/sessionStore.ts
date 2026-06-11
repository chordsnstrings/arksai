import { create } from 'zustand';
import type {
  AgentEvent,
  GlobalEvent,
  SessionDetail,
  SessionMeta,
  TimelineItem,
  ToolCallRecord,
} from '@shared/types';

export interface LiveState {
  items: TimelineItem[];
  pendingAssistant: { id: string; text: string } | null;
  pendingTools: { id: string; calls: ToolCallRecord[] } | null;
  running: boolean;
  elapsed: number;
  tokens: number;
  runningTasks: number;
}

const emptyLive = (): LiveState => ({
  items: [],
  pendingAssistant: null,
  pendingTools: null,
  running: false,
  elapsed: 0,
  tokens: 0,
  runningTasks: 1,
});

interface StoreState {
  authed: boolean | null;
  sessions: SessionMeta[];
  activeId: string | null;
  live: Record<string, LiveState>;

  setAuthed(v: boolean): void;
  setSessions(list: SessionMeta[]): void;
  upsertSession(meta: SessionMeta): void;
  removeSession(id: string): void;
  setActive(id: string | null): void;
  loadDetail(detail: SessionDetail): void;
  addUserMessage(sessionId: string, text: string): void;
  applyEvent(sessionId: string, ev: AgentEvent): void;
  applyGlobalEvent(ev: GlobalEvent): void;
}

export const useStore = create<StoreState>((set, get) => ({
  authed: null,
  sessions: [],
  activeId: null,
  live: {},

  setAuthed: (v) => set({ authed: v }),
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
          tokens: detail.meta.totalTokens,
        },
      },
    })),

  addUserMessage: (sessionId, text) =>
    mutateLive(set, sessionId, (live) => ({
      ...live,
      items: [...live.items, { kind: 'user', id: `local-${Date.now()}`, text, ts: Date.now() }],
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
      return { ...live, running: true, elapsed: 0, runningTasks: 1 };

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
      return { ...live, tokens: ev.totalTokens };

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
      return { ...live, items, pendingAssistant: null, pendingTools: null, running: false };
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

    case 'session_meta_updated':
      return live;

    default:
      return live;
  }
}
