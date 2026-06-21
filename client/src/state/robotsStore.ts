import { create } from 'zustand';
import type { Approval, AutonomyLevel, Robot, RobotStatus, TriggerKind } from '../lib/robots';
import { roleSpec } from '../lib/robots';

/**
 * Client store for the Robots surface. Starts EMPTY (no mock data) — robots appear only when
 * the user hires one. This is UI-shell state for now; persistence + the real agent runtime is
 * the next build, so everything lives in memory for the session and the actions are the seams
 * a real `/api/robots` will plug into.
 */

const uid = () => Math.random().toString(36).slice(2, 10);

interface RobotsState {
  robots: Robot[];
  approvals: Approval[];
  hire(input: { role: string; name: string; mandate: string; autonomy: AutonomyLevel; triggers: TriggerKind[] }): Robot;
  update(id: string, patch: Partial<Robot>): void;
  remove(id: string): void;
  setStatus(id: string, status: RobotStatus): void;
  resolveApproval(id: string): void;
}

export const useRobots = create<RobotsState>((set) => ({
  robots: [],
  approvals: [],
  hire: (input) => {
    const spec = roleSpec(input.role);
    const robot: Robot = {
      id: uid(),
      role: input.role,
      name: input.name || spec?.name || 'Agent',
      mandate: input.mandate.trim(),
      status: 'idle',
      autonomy: input.autonomy,
      triggers: input.triggers.length ? input.triggers : ['manual'],
      createdAt: Date.now(),
      journal: [],
      outputs: [],
    };
    set((s) => ({ robots: [robot, ...s.robots] }));
    return robot;
  },
  update: (id, patch) => set((s) => ({ robots: s.robots.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  remove: (id) =>
    set((s) => ({ robots: s.robots.filter((r) => r.id !== id), approvals: s.approvals.filter((a) => a.robotId !== id) })),
  setStatus: (id, status) => set((s) => ({ robots: s.robots.map((r) => (r.id === id ? { ...r, status } : r)) })),
  resolveApproval: (id) => set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),
}));
