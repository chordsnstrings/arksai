import { getEmailAccount } from '../email/accounts';
import { readInbox, sendEmail, type InboxMessage } from '../email/client';
import type { Robot } from '../../../shared/types';
import { createDraft, draftExistsFor, listActiveRobots, markDraftStatus, markPolled } from './store';
import { draftReply } from './reply';

/**
 * The inbound poller: for each ACTIVE robot, read recent unread mail and produce a
 * draft reply per new message. Mirrors the schedule scheduler (a durable setInterval
 * tick). Robots are processed sequentially and messages one at a time — M3 stalls
 * under concurrency, and this keeps load gentle.
 *
 * Idempotency: we dedupe by inbound Message-ID (draftExistsFor) BEFORE calling a
 * model, so re-reading the same unread message across ticks never double-drafts and
 * never re-spends. We deliberately do NOT mark messages \\"seen\\" — that's the user's
 * mailbox state, not ours.
 *
 * Autonomy: 'ask' (and 'shadow') leave the draft pending for human approval. 'auto'
 * sends non-escalated drafts immediately — LOCKED to the inbound sender, threaded via
 * In-Reply-To. Escalated items are never auto-sent.
 */

const TICK_MS = Number(process.env.ROBOT_POLL_MS || '60000') || 60_000;
const MAX_PER_ROBOT = Number(process.env.ROBOT_MAX_PER_TICK || '5') || 5;
const DRAFT_TIMEOUT_MS = Number(process.env.ROBOT_DRAFT_TIMEOUT_MS || '90000') || 90_000;

function reSubject(s: string | undefined): string {
  const base = (s || '(no subject)').trim();
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

async function processRobot(robot: Robot): Promise<void> {
  const account = await getEmailAccount(robot.orgId);
  if (!account || !account.enabled || !account.imapHost) return;

  let messages: InboxMessage[];
  try {
    messages = await readInbox(robot.orgId, { unseenOnly: true, limit: MAX_PER_ROBOT });
  } catch (e) {
    console.error(`[robot ${robot.id}] inbox read failed:`, (e as any)?.message ?? e);
    return;
  }

  for (const msg of messages) {
    if (!msg.from) continue;
    // Never reply to ourselves (loop guard).
    if (msg.from.toLowerCase() === account.fromEmail.toLowerCase()) continue;
    // Already handled this message?
    if (msg.messageId && (await draftExistsFor(robot.id, msg.messageId))) continue;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DRAFT_TIMEOUT_MS);
    let outcome;
    try {
      outcome = await draftReply(robot, msg, ac.signal);
    } catch (e) {
      console.error(`[robot ${robot.id}] draft failed:`, (e as any)?.message ?? e);
      continue;
    } finally {
      clearTimeout(timer);
    }

    const primary = outcome.primary;
    const draft = await createDraft({
      robotId: robot.id,
      orgId: robot.orgId,
      inboundMessageId: msg.messageId || null,
      inboundFrom: msg.from,
      inboundName: msg.fromName || null,
      inboundSubject: msg.subject || null,
      inboundSnippet: msg.snippet || null,
      toAddr: msg.from, // LOCKED to the inbound sender
      subject: reSubject(msg.subject),
      draftText: primary.text,
      modelUsed: primary.model,
      altText: outcome.alt?.text ?? null,
      altModel: outcome.alt?.model ?? null,
      escalated: primary.escalate,
      escalationReason: primary.escalate ? primary.reason : null,
    });

    // Auto mode: send a clean (non-escalated) draft right away, locked to the sender.
    if (robot.autonomy === 'auto' && !primary.escalate && primary.text) {
      try {
        await sendEmail(robot.orgId, {
          to: msg.from,
          subject: reSubject(msg.subject),
          text: primary.text,
          inReplyTo: msg.messageId || undefined,
          references: msg.messageId || undefined,
        });
        await markDraftStatus(draft.id, robot.orgId, 'sent', Date.now());
      } catch (e) {
        console.error(`[robot ${robot.id}] auto-send failed:`, (e as any)?.message ?? e);
        // Leave it pending so a human can send it.
      }
    }
  }

  await markPolled(robot.id);
}

export async function tick(): Promise<void> {
  let robots: Robot[];
  try {
    robots = await listActiveRobots();
  } catch (e) {
    console.error('[robot-poller] list failed:', (e as any)?.message ?? e);
    return;
  }
  // Sequential — gentle on the mail server and on M3 (which stalls under concurrency).
  for (const robot of robots) {
    await processRobot(robot).catch((e) => console.error(`[robot ${robot.id}]`, (e as any)?.message ?? e));
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startRobotPoller(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  // A short delay after boot so the first tick doesn't race startup.
  setTimeout(() => void tick(), 12_000);
  console.log(`[robot-poller] started (every ${Math.round(TICK_MS / 1000)}s)`);
}

export function stopRobotPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
