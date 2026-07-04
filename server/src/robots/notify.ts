import { randomUUID } from 'node:crypto';
import type { Robot, RobotDraft, RobotDraftChannel } from '../../../shared/types';
import { q, qOne } from '../db';
import { createDraft, getDraft, markDraftStatus, normalizeAddr } from './store';
import { listCommanders } from './tasks';
import { regenerateDraft } from './reply';
import { deliverDraft, sendOnChannel } from './outbound';
import { setNotifyHook, setResolveHook } from './channels/inbound';

/**
 * OWNER NOTIFICATIONS + remote approval — the "the robot pings YOU where you live" layer.
 *
 * When a draft needs a human (escalated always; pending too when config.notify==='all'),
 * every notify-enabled commander gets a ping on their own channel with the context and the
 * proposed reply. The owner can then answer FROM THAT CHAT:
 *   - "approve" / "send" / "yes"  → the stored draft goes out (recipient still LOCKED)
 *   - "ignore" / "dismiss" / "no" → the draft is dismissed
 *   - anything else               → treated as direction: the reply is re-drafted to follow
 *                                   it and sent, then confirmed back.
 * Safety: only listed commanders are ever pinged or listened to; resolution always acts on
 * the robot's stored draft (never a new recipient); the owner's own chats with the robot
 * never generate pings about themselves.
 */

const APPROVE_RE = /^\s*(approve|send( it)?|yes|ok(ay)?|go( ahead)?|👍)\s*[.!]?\s*$/i;
const DISMISS_RE = /^\s*(ignore|dismiss|skip|no|drop( it)?|don'?t (send|reply))\s*[.!]?\s*$/i;
const REGEN_TIMEOUT_MS = 60_000;

export interface RobotNotification {
  id: string;
  robotId: string;
  orgId: string;
  draftId: string;
  channel: RobotDraftChannel;
  address: string;
  createdAt: number;
  resolvedAt: number | null;
}

function rowToNotification(r: any): RobotNotification {
  return {
    id: r.id,
    robotId: r.robot_id,
    orgId: r.org_id,
    draftId: r.draft_id,
    channel: r.channel,
    address: r.address,
    createdAt: Number(r.created_at),
    resolvedAt: r.resolved_at != null ? Number(r.resolved_at) : null,
  };
}

async function alreadyNotified(draftId: string): Promise<boolean> {
  const r = await qOne('SELECT id FROM robot_notifications WHERE draft_id = $1', [draftId]);
  return !!r;
}

export async function resolveNotification(id: string): Promise<void> {
  await q('UPDATE robot_notifications SET resolved_at = $1 WHERE id = $2', [Date.now(), id]);
}

/** The newest unresolved ping sent TO this address on this channel for this robot. */
export async function latestUnresolvedFor(
  robotId: string,
  channel: RobotDraftChannel,
  address: string,
): Promise<RobotNotification | null> {
  const rows = await q(
    'SELECT * FROM robot_notifications WHERE robot_id = $1 AND channel = $2 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 20',
    [robotId, channel],
  );
  const want = normalizeAddr(address);
  const hit = rows.map(rowToNotification).find((n) => normalizeAddr(n.address) === want);
  return hit ?? null;
}

function pingText(robot: Robot, draft: RobotDraft): string {
  const who = draft.inboundName || draft.inboundFrom;
  const what = (draft.inboundBody || draft.inboundSnippet || '').replace(/\s+/g, ' ').slice(0, 280);
  const header = draft.escalated
    ? `🔔 ${robot.name}: ${who} needs you${draft.escalationReason ? ` — ${draft.escalationReason}` : ''}.`
    : `🔔 ${robot.name}: a reply to ${who} is waiting for your approval.`;
  const lines = [header, '', `They wrote: "${what}"`];
  if (draft.draftText) lines.push('', `My draft: "${draft.draftText.replace(/\s+/g, ' ').slice(0, 380)}"`);
  lines.push(
    '',
    draft.draftText
      ? 'Reply APPROVE to send it, IGNORE to drop it, or tell me how to respond and I\'ll send that.'
      : 'Tell me how to respond and I\'ll send that, or reply IGNORE to drop it.',
  );
  return lines.join('\n');
}

/**
 * Ping the owner(s) about a draft that needs them. Never throws; one ping set per draft.
 * Skipped when: notifications are off, the draft doesn't qualify for the level, the sender
 * IS one of the owner's own addresses, or the draft was already pinged.
 */
export async function notifyOwnersOfDraft(robot: Robot, draft: RobotDraft): Promise<number> {
  try {
    const level = robot.config?.notify ?? 'escalations';
    if (level === 'off') return 0;
    if (!draft.escalated && !(level === 'all' && draft.status === 'pending')) return 0;
    const commanders = await listCommanders(robot.id);
    const targets = commanders.filter((c) => c.notify);
    if (!targets.length) return 0;
    // Never ping the owner about their OWN conversation with the robot.
    const fromNorm = normalizeAddr(draft.inboundFrom);
    if (commanders.some((c) => normalizeAddr(c.address) === fromNorm)) return 0;
    if (await alreadyNotified(draft.id)) return 0;

    const text = pingText(robot, draft);
    let sent = 0;
    for (const t of targets) {
      try {
        await sendOnChannel(robot, t.channel, t.address, text);
        await q(
          'INSERT INTO robot_notifications(id, robot_id, org_id, draft_id, channel, address, created_at, resolved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)',
          [randomUUID(), robot.id, robot.orgId, draft.id, t.channel, t.address, Date.now()],
        );
        sent++;
      } catch (e: any) {
        console.error(`[robot ${robot.id}] owner ping via ${t.channel} failed:`, e?.message ?? e);
      }
    }
    return sent;
  } catch (e: any) {
    console.error(`[robot ${robot.id}] notifyOwners failed:`, e?.message ?? e);
    return 0;
  }
}

/** Record the owner's remote instruction as a SENT receipt draft (audit + message dedupe). */
async function receipt(
  robot: Robot,
  channel: RobotDraftChannel,
  from: string,
  fromName: string | null,
  text: string,
  inboundMessageId: string | null,
  outcome: string,
): Promise<void> {
  try {
    const d = await createDraft({
      robotId: robot.id,
      orgId: robot.orgId,
      inboundMessageId,
      inboundFrom: from,
      inboundName: fromName,
      inboundSubject: null,
      inboundSnippet: text.slice(0, 160),
      inboundBody: text,
      toAddr: from,
      subject: '',
      draftText: outcome,
      modelUsed: 'owner-approval',
      escalated: false,
      channel: channel === 'email' ? 'email' : channel,
    });
    await markDraftStatus(d.id, robot.orgId, 'sent', Date.now());
  } catch {
    /* audit best-effort */
  }
}

/**
 * Try to interpret an inbound message from a NOTIFIED OWNER as a resolution of their newest
 * unresolved ping. Returns true when the message was consumed by this lane.
 */
export async function tryResolveNotification(
  robot: Robot,
  channel: RobotDraftChannel,
  from: string,
  fromName: string | null,
  text: string,
  inboundMessageId: string | null,
): Promise<boolean> {
  const notif = await latestUnresolvedFor(robot.id, channel, from).catch(() => null);
  if (!notif) return false;
  const draft = await getDraft(notif.draftId);
  const confirm = (t: string) => sendOnChannel(robot, channel, from, t).catch(() => {});

  // The draft may have been handled in the console meanwhile — resolve + tell them.
  if (!draft || (draft.status !== 'pending' && draft.status !== 'escalated')) {
    await resolveNotification(notif.id);
    if (draft?.status === 'sent') {
      await confirm('That one was already handled in the console ✓');
      await receipt(robot, channel, from, fromName, text, inboundMessageId, 'Already handled in the console.');
      return true;
    }
    return false; // fall through to the normal lanes — the ping is stale, the message may be something else
  }

  const who = draft.inboundName || draft.inboundFrom;
  if (APPROVE_RE.test(text)) {
    try {
      if (!draft.draftText) {
        await confirm(`There's no draft to send for ${who} yet — tell me what to reply and I'll send that.`);
        return true;
      }
      await deliverDraft(draft);
      await resolveNotification(notif.id);
      await confirm(`Sent ✓ — my draft went to ${who}.`);
      await receipt(robot, channel, from, fromName, text, inboundMessageId, `Approved — draft sent to ${who}.`);
    } catch (e: any) {
      await confirm(`Couldn't send it: ${e?.message ?? e}`);
    }
    return true;
  }
  if (DISMISS_RE.test(text)) {
    await markDraftStatus(draft.id, draft.orgId, 'dismissed');
    await resolveNotification(notif.id);
    await confirm(`Dropped — no reply will be sent to ${who}.`);
    await receipt(robot, channel, from, fromName, text, inboundMessageId, `Dismissed the ${who} thread.`);
    return true;
  }

  // Anything else = direction: re-draft the reply to follow it, send, confirm.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REGEN_TIMEOUT_MS);
  try {
    const out = await regenerateDraft(robot, draft, text, ac.signal);
    if (!out.text) {
      await confirm(`I couldn't draft that (${out.reason || 'no model available'}) — open ArksAI to respond, or try different wording.`);
      return true;
    }
    await deliverDraft(draft, out.text);
    await resolveNotification(notif.id);
    await confirm(`Sent ✓ — replied to ${who} as you asked.`);
    await receipt(robot, channel, from, fromName, text, inboundMessageId, `Owner-directed reply sent to ${who}:\n${out.text.slice(0, 400)}`);
  } catch (e: any) {
    await confirm(`Couldn't send that: ${e?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  return true;
}

/** Boot wiring: point the channel inbound handler's notify + resolve hooks here. */
export function installNotifyHooks(): void {
  setResolveHook((robot, channel, from, fromName, text, messageId) =>
    tryResolveNotification(robot, channel, from, fromName, text, messageId),
  );
  setNotifyHook(async (robot, draftId) => {
    const draft = await getDraft(draftId).catch(() => null);
    if (draft) await notifyOwnersOfDraft(robot, draft);
  });
}
