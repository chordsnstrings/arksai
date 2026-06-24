import type { Deployment, HomeSnapshot, RobotDraft, Schedule, SessionMeta } from '@shared/types';
import type { useStore } from '../state/sessionStore';

type Me = ReturnType<typeof useStore.getState>['me'];

/** One thing that needs the user's attention, surfaced in the Home "Needs you" zone and
 *  the Activity "Needs you" tab. Kept deliberately small + uniform so every surface agrees. */
export interface AttentionItem {
  id: string;
  kind: 'draft' | 'failed-deploy' | 'low-balance';
  title: string;
  detail: string;
  at: number;
}

/** A finished scheduled delivery (the Activity "Delivered" tab). */
export interface DeliveredItem {
  id: string; // session id
  title: string;
  at: number;
}

const draftTitle = (d: RobotDraft) =>
  `Reply to ${d.inboundName || d.inboundFrom}${d.inboundSubject ? ` · ${d.inboundSubject}` : ''}`;

/** Everything that needs the user, newest first: pending robot drafts, failed publishes,
 *  and a low/empty wallet. Pure — same inputs, same output, so badges and panels match. */
export function needsYou(home: HomeSnapshot | null, me: Me): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const d of home?.pendingDrafts ?? []) {
    items.push({
      id: `draft:${d.id}`,
      kind: 'draft',
      title: draftTitle(d),
      detail: d.escalated ? `Flagged: ${d.escalationReason || 'needs a human'}` : 'Draft ready to approve & send',
      at: d.createdAt,
    });
  }
  for (const dep of failedDeployments(home)) {
    items.push({
      id: `deploy:${dep.slug}`,
      kind: 'failed-deploy',
      title: `“${dep.name}” didn’t publish`,
      detail: 'The live link hit a snag — reopen its chat to fix & republish.',
      at: dep.updatedAt,
    });
  }
  const w = me?.wallet;
  if (w && w.lowBalance) {
    items.push({
      id: 'wallet:low',
      kind: 'low-balance',
      title: w.balanceUsd <= 0 ? 'Your workspace is out of credit' : 'Low balance',
      detail: w.balanceUsd <= 0 ? 'Top up the wallet to keep building.' : 'Top up soon to avoid interruptions.',
      at: Date.now(),
    });
  }
  return items.sort((a, b) => b.at - a.at);
}

export function failedDeployments(home: HomeSnapshot | null): Deployment[] {
  return (home?.deployments ?? []).filter((d) => d.status === 'error');
}

/** Live (running) deployments — the "Running for you" zone. */
export function liveDeployments(home: HomeSnapshot | null): Deployment[] {
  return (home?.deployments ?? []).filter((d) => d.status === 'running');
}

/** Enabled schedules, soonest next-run first. */
export function activeSchedules(home: HomeSnapshot | null): Schedule[] {
  return (home?.schedules ?? []).filter((s) => s.enabled).sort((a, b) => a.nextRunAt - b.nextRunAt);
}

/** Active (running) robots. */
export function activeRobots(home: HomeSnapshot | null) {
  return (home?.robots ?? []).filter((r) => r.status === 'active');
}

/** Completed scheduled deliveries (newest first) — the Activity "Delivered" tab. */
export function delivered(sessions: SessionMeta[]): DeliveredItem[] {
  return sessions
    .filter((s) => s.task === 'scheduled' && s.status === 'done')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({ id: s.id, title: s.title, at: s.updatedAt }));
}

/** The Activity badge: open attention items + deliveries the user hasn't looked at since
 *  `seenAt`. Attention items are an inbox count (they clear when resolved); deliveries clear
 *  when the user opens Activity. */
export function activityBadge(
  home: HomeSnapshot | null,
  me: Me,
  sessions: SessionMeta[],
  seenAt: number,
): number {
  const attention = needsYou(home, me).length;
  const newDeliveries = delivered(sessions).filter((d) => d.at > seenAt).length;
  return attention + newDeliveries;
}
