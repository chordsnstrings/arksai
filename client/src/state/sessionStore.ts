import { create } from 'zustand';
import type {
  AgentEvent,
  CustomCommand,
  GlobalEvent,
  ModelInfo,
  Project,
  ProgressPhase,
  SessionDetail,
  SessionMeta,
  TimelineItem,
  ToolCallRecord,
} from '@shared/types';
import type { Org } from '../api/client';

export interface ProgressState {
  phase: ProgressPhase;
  label: string;
  pct: number;
  at: number;
  /** Estimated seconds remaining at the moment `at` was received (ticked down client-side). */
  etaSeconds?: number;
}
export interface CompletionState {
  kind: 'app' | 'pdf' | 'sheet' | 'doc' | 'image';
  name?: string;
}

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
  engineCostUsd: number;
  /** server-authoritative model spend this run (blends models in Auto mode) */
  modelCostUsd: number | null;
  runningTasks: number;
  /** live progress beat for the smart-work bar (null when not running) */
  progress: ProgressState | null;
  /** what the last successful run produced — drives the "it's ready" card */
  completion: CompletionState | null;
}

/** Sessions deleted this client session — never re-add them from late events. */
const deletedIds = new Set<string>();

export const emptyLive = (): LiveState => ({
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
  engineCostUsd: 0,
  modelCostUsd: null,
  runningTasks: 1,
  progress: null,
  completion: null,
});

interface StoreState {
  authed: boolean | null;
  sessions: SessionMeta[];
  projects: Project[];
  activeId: string | null;
  live: Record<string, LiveState>;
  models: ModelInfo[];
  commands: CustomCommand[];
  canvasOpen: boolean;
  /** what the canvas should auto-load (set by the open_canvas event) */
  canvasTarget: { port?: number; file?: string; kind?: 'app' | 'pdf' | 'sheet' | 'doc' | 'image'; at: number } | null;
  navOpen: boolean;
  automation: Record<string, Automation>;
  /** current user + org context from /api/auth/me (null until fetched / for the legacy operator before fetch) */
  me: {
    user: { id: string; email: string; name: string | null; isSuperadmin: boolean } | null;
    orgs: Org[];
    currentOrg: string | null;
    currentOrgOnboarded?: boolean;
    role: string | null;
    isSuperadmin: boolean;
  } | null;

  setProjects(list: Project[]): void;
  upsertProject(p: Project): void;
  removeProject(id: string): void;
  setAuthed(v: boolean): void;
  setMe(me: StoreState['me']): void;
  toggleNav(open?: boolean): void;
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
  beginRun(sessionId: string): void;
  forceStop(sessionId: string): void;
  applyEvent(sessionId: string, ev: AgentEvent): void;
  applyGlobalEvent(ev: GlobalEvent): void;
}

export const useStore = create<StoreState>((set, get) => ({
  authed: null,
  sessions: [],
  projects: [],
  activeId: null,
  live: {},
  models: [],
  commands: [],
  canvasOpen: false,
  canvasTarget: null,
  // Open by default on wide screens, collapsed on phones.
  navOpen: typeof window === 'undefined' ? true : window.innerWidth > 860,
  automation: {},
  me: null,

  setProjects: (list) => set({ projects: list }),
  upsertProject: (p) =>
    set((s) => {
      const idx = s.projects.findIndex((x) => x.id === p.id);
      const projects = idx >= 0 ? s.projects.map((x) => (x.id === p.id ? p : x)) : [p, ...s.projects];
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      return { projects };
    }),
  removeProject: (id) =>
    set((s) => ({
      projects: s.projects.filter((x) => x.id !== id),
      // detach sessions client-side so they fall back to "ungrouped"
      sessions: s.sessions.map((x) => (x.projectId === id ? { ...x, projectId: null } : x)),
    })),
  setAuthed: (v) => set({ authed: v }),
  setMe: (me) => set({ me }),
  toggleNav: (open) => set((s) => ({ navOpen: open ?? !s.navOpen })),
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
      // Never resurrect a session the user just deleted (guards against a late
      // status event arriving after the delete).
      if (deletedIds.has(meta.id)) return {};
      const idx = s.sessions.findIndex((x) => x.id === meta.id);
      const sessions = idx >= 0 ? s.sessions.map((x) => (x.id === meta.id ? meta : x)) : [meta, ...s.sessions];
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return { sessions };
    }),

  removeSession: (id) => {
    deletedIds.add(id);
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

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

  // Optimistic: the instant the user sends, show the run as live so the progress
  // bar + footer appear with zero perceptible gap (the real run_started reconciles).
  beginRun: (sessionId) =>
    mutateLive(set, sessionId, (live) => ({
      ...live,
      running: true,
      completion: null,
      progress: live.progress ?? { phase: 'understanding', label: 'Getting started…', pct: 4, at: Date.now() },
    })),

  forceStop: (sessionId) =>
    mutateLive(set, sessionId, (live) => ({ ...live, running: false, pendingAssistant: null, pendingTools: null })),

  applyEvent: (sessionId, ev) => {
    mutateLive(set, sessionId, (live) => reduceEvent(live, ev));
    if (ev.type === 'session_meta_updated') {
      const existing = get().sessions.find((x) => x.id === ev.meta.id);
      if (existing) get().upsertSession({ ...existing, ...ev.meta });
    }
    // Auto-open AND auto-load the finished artifact in the canvas — only for the
    // session the user is looking at, so a background run doesn't yank the view.
    if (ev.type === 'open_canvas' && get().activeId === sessionId) {
      set({ canvasTarget: { port: ev.port, file: ev.file, kind: ev.kind, at: Date.now() } });
      get().toggleCanvas(true);
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
        engineCostUsd: 0,
        modelCostUsd: null,
        progress: null,
        completion: null,
      };

    case 'progress':
      return {
        ...live,
        // Monotonic: the displayed phase always advances; pct never regresses
        // (a self-healing retry must read as forward motion).
        progress: { phase: ev.phase, label: ev.label, pct: Math.max(live.progress?.pct ?? 0, ev.pct), at: Date.now(), etaSeconds: ev.etaSeconds },
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

    case 'turn_reset': {
      // The turn dropped mid-stream and is being redone — discard the partial
      // assistant text and any half-streamed tool group so the retry is clean.
      return { ...live, pendingAssistant: null, pendingTools: null };
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
        engineCostUsd: ev.engineCostUsd ?? live.engineCostUsd,
        modelCostUsd: ev.costUsd ?? live.modelCostUsd,
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
        engineCostUsd: 0,
        modelCostUsd: null,
        progress: null,
        // Stash what the run produced so the chat can show the "it's ready" card.
        completion: ev.status === 'done' && ev.deliverable ? ev.deliverable : live.completion,
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
    case 'open_canvas':
      return live;

    default:
      return live;
  }
}
