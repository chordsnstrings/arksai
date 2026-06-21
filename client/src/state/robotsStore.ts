import { create } from 'zustand';
import type { Approval, AutonomyLevel, Robot, RobotStatus, TriggerKind } from '../lib/robots';
import { roleSpec } from '../lib/robots';
import { api } from '../api/client';
import type { Robot as ApiRobot, RobotConfig, RobotAutonomy } from '@shared/types';

/**
 * Client store for the Robots console — now backed by the real `/api/orgs/:id/robots`
 * engine (per-org, durable). A robot runs as a standing EMAIL agent: it reads the org's
 * connected mailbox and drafts replies grounded in its mandate. The console's "Needs You"
 * inbox is mapped from the backend's pending reply drafts; approving one sends it (locked
 * to the original sender). The UI `Robot` shape (lib/robots) is preserved, so the console
 * components are unchanged — this store maps to/from the API model.
 */

// UI autonomy (3 levels) ↔ backend autonomy. ask_all/ask_big both draft for approval; only
// "autonomous" sends on its own. Reverse maps to ask_big (the sensible middle default).
const toApiAutonomy = (a: AutonomyLevel): RobotAutonomy => (a === 'autonomous' ? 'auto' : 'ask');
const toUiAutonomy = (a: RobotAutonomy): AutonomyLevel => (a === 'auto' ? 'autonomous' : 'ask_big');
const toUiStatus = (s: ApiRobot['status']): RobotStatus => (s === 'paused' ? 'paused' : 'idle');

type ExtConfig = RobotConfig & { dept?: string; mandate?: string; triggers?: TriggerKind[] };

function toUiRobot(r: ApiRobot): Robot {
  const cfg = (r.config || {}) as ExtConfig;
  const uiRole = cfg.dept || r.role;
  return {
    id: r.id,
    role: uiRole,
    name: r.name,
    mandate: cfg.mandate || cfg.persona || '',
    status: toUiStatus(r.status),
    autonomy: toUiAutonomy(r.autonomy),
    triggers: cfg.triggers && cfg.triggers.length ? cfg.triggers : ['event'],
    createdAt: r.createdAt,
    journal: [],
    outputs: [],
  };
}

const uid = () => Math.random().toString(36).slice(2, 10);

interface RobotsState {
  orgId: string | null;
  robots: Robot[];
  approvals: Approval[];
  loading: boolean;
  load(orgId: string): Promise<void>;
  hire(input: { role: string; name: string; mandate: string; autonomy: AutonomyLevel; triggers: TriggerKind[] }): Promise<Robot>;
  update(id: string, patch: Partial<Robot>): void;
  remove(id: string): void;
  setStatus(id: string, status: RobotStatus): void;
  resolveApproval(id: string, action?: 'send' | 'dismiss'): void;
}

export const useRobots = create<RobotsState>((set, get) => ({
  orgId: null,
  robots: [],
  approvals: [],
  loading: false,

  load: async (orgId) => {
    set({ orgId, loading: true });
    try {
      const [robots, drafts] = await Promise.all([
        api.listRobots(orgId),
        api.listDrafts(orgId, { status: 'pending' }).catch(() => []),
      ]);
      const approvals: Approval[] = drafts.map((d) => ({
        id: d.id,
        robotId: d.robotId,
        title: `Reply to ${d.inboundName || d.inboundFrom}${d.inboundSubject ? ` · ${d.inboundSubject}` : ''}`,
        why: d.escalated ? `Flagged for you: ${d.escalationReason || 'needs a human'}` : 'Draft ready to send',
        draft: d.draftText,
        at: d.createdAt,
      }));
      set({ robots: robots.map(toUiRobot), approvals, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  hire: async (input) => {
    const orgId = get().orgId;
    const spec = roleSpec(input.role);
    const config: ExtConfig = {
      dept: input.role,
      mandate: input.mandate.trim(),
      persona: input.mandate.trim(),
      triggers: input.triggers.length ? input.triggers : ['event'],
    };
    if (orgId) {
      try {
        const created = await api.createRobot(orgId, {
          name: input.name || spec?.name || 'Agent',
          role: 'custom',
          model: 'arksai-max',
          autonomy: toApiAutonomy(input.autonomy),
          config,
        });
        await api.updateRobot(orgId, created.id, { status: 'active' }).catch(() => {});
        await get().load(orgId);
        const ui = get().robots.find((r) => r.id === created.id);
        if (ui) return ui;
      } catch {
        /* fall through to a local-only robot so the UI still responds */
      }
    }
    const robot: Robot = {
      id: uid(), role: input.role, name: input.name || spec?.name || 'Agent', mandate: input.mandate.trim(),
      status: 'idle', autonomy: input.autonomy, triggers: input.triggers.length ? input.triggers : ['event'],
      createdAt: Date.now(), journal: [], outputs: [],
    };
    set((s) => ({ robots: [robot, ...s.robots] }));
    return robot;
  },

  update: (id, patch) => {
    set((s) => ({ robots: s.robots.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    const orgId = get().orgId;
    if (!orgId) return;
    const apiPatch: any = {};
    if (patch.name != null) apiPatch.name = patch.name;
    if (patch.autonomy != null) apiPatch.autonomy = toApiAutonomy(patch.autonomy);
    if (patch.mandate != null || patch.triggers != null) {
      const cur = get().robots.find((r) => r.id === id);
      apiPatch.config = {
        dept: cur?.role,
        mandate: patch.mandate ?? cur?.mandate ?? '',
        persona: patch.mandate ?? cur?.mandate ?? '',
        triggers: patch.triggers ?? cur?.triggers ?? ['event'],
      };
    }
    api.updateRobot(orgId, id, apiPatch).catch(() => {});
  },

  remove: (id) => {
    set((s) => ({ robots: s.robots.filter((r) => r.id !== id), approvals: s.approvals.filter((a) => a.robotId !== id) }));
    const orgId = get().orgId;
    if (orgId) api.deleteRobot(orgId, id).catch(() => {});
  },

  setStatus: (id, status) => {
    set((s) => ({ robots: s.robots.map((r) => (r.id === id ? { ...r, status } : r)) }));
    const orgId = get().orgId;
    if (orgId) api.updateRobot(orgId, id, { status: status === 'paused' ? 'paused' : 'active' }).catch(() => {});
  },

  resolveApproval: (id, action = 'send') => {
    set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) }));
    const orgId = get().orgId;
    if (!orgId) return;
    const p = action === 'dismiss' ? api.dismissDraft(orgId, id) : api.sendDraft(orgId, id);
    p.catch(() => {}).then(() => get().load(orgId));
  },
}));
