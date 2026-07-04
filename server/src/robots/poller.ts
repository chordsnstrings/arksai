import { getRobotEmailAccount } from '../email/accounts';
import { readInboxForRobot, sendEmailForRobot, withTimeout, type InboxMessage } from '../email/client';
import type { Robot } from '../../../shared/types';
import { createDraft, draftExistsFor, listActiveRobots, listActiveRules, markDraftStatus, markPolled, wakeSnoozedDrafts } from './store';
import { draftReply } from './reply';
import { listChannels, withSecrets } from './channels/store';
import { ADAPTERS, handleChannelInbound } from './channels/inbound';
import { replyExtrasFor } from './personas';
import { tryCommand, watchRobotTasks } from './tasks';
import { getRobot } from './store';

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

/** A human-readable account of one poll pass — returned by the manual "check now"
 *  endpoint and useful for diagnosing why a robot "watching" the inbox stays quiet. */
export interface PollSummary {
  robotId: string;
  read: number;
  drafted: number;
  sent: number;
  escalated: number;
  skipped: number;
  /** Breakdown of WHY messages were skipped — so "check now" isn't opaque. */
  skippedReasons?: { alreadyHandled: number; fromSelf: number; noSender: number };
  reason?: string; // why nothing happened (mailbox not ready / no new mail / all handled)
  error?: string; // a real failure (read/draft/send)
  /** Per-connected-channel results (telegram etc.) from the same pass. */
  channels?: { kind: string; read: number; drafted: number; sent: number; commands: number; error?: string }[];
}

/** Poll every connected POLL-based channel (Telegram) for one robot. Never throws. */
export async function pollRobotChannelsOnce(robot: Robot): Promise<NonNullable<PollSummary['channels']>> {
  const results: NonNullable<PollSummary['channels']> = [];
  let channels;
  try {
    channels = await listChannels(robot.id);
  } catch {
    return results;
  }
  for (const c of channels) {
    if (!c.enabled) continue;
    const adapter = ADAPTERS[c.kind];
    if (!adapter?.fetchInbound) continue; // webhook-based channels push, not poll
    const entry = { kind: c.kind, read: 0, drafted: 0, sent: 0, commands: 0 } as NonNullable<PollSummary['channels']>[number];
    try {
      const ch = await withSecrets(robot.id, c.kind);
      if (!ch) continue;
      const inbound = await withTimeout(adapter.fetchInbound(ch), READ_TIMEOUT_MS, `${c.kind} read`);
      entry.read = inbound.length;
      for (const msg of inbound) {
        const sum = await handleChannelInbound(robot, ch, msg);
        entry.drafted += sum.drafted;
        entry.sent += sum.sent;
        entry.commands += sum.commands;
        if (sum.error) entry.error = sum.error;
      }
    } catch (e: any) {
      entry.error = e?.message ?? String(e);
      console.error(`[robot ${robot.id}] ${c.kind} poll failed:`, entry.error);
    }
    results.push(entry);
  }
  return results;
}

const READ_TIMEOUT_MS = Number(process.env.ROBOT_READ_TIMEOUT_MS || '25000') || 25_000;

/** Run ONE poll pass for a robot and report exactly what happened. Never throws. */
export async function pollRobotOnce(robot: Robot): Promise<PollSummary> {
  const sum: PollSummary = { robotId: robot.id, read: 0, drafted: 0, sent: 0, escalated: 0, skipped: 0 };

  // Chat/SMS channels poll independently of the mailbox — a Telegram-only robot works
  // with no email account at all.
  const channels = await pollRobotChannelsOnce(robot);
  if (channels.length) sum.channels = channels;
  const doneChannels = async () => {
    if (channels.length) await markPolled(robot.id).catch(() => {});
  };

  const account = await getRobotEmailAccount(robot.id);
  if (!account) {
    await doneChannels();
    return { ...sum, reason: channels.length ? undefined : 'No mailbox is connected for this robot.' };
  }
  if (!account.enabled) {
    await doneChannels();
    return { ...sum, reason: 'This robot’s mailbox is disabled.' };
  }
  if (!account.imapHost) {
    await doneChannels();
    return { ...sum, reason: 'No IMAP (inbound) settings are configured.' };
  }

  let messages: InboxMessage[];
  try {
    messages = await withTimeout(
      readInboxForRobot(robot.id, { unseenOnly: true, limit: MAX_PER_ROBOT }),
      READ_TIMEOUT_MS,
      'Inbox read',
    );
  } catch (e: any) {
    sum.error = e?.message ?? String(e);
    console.error(`[robot ${robot.id}] inbox read failed:`, sum.error);
    return sum;
  }
  sum.read = messages.length;
  const skips = { alreadyHandled: 0, fromSelf: 0, noSender: 0 };
  if (!messages.length) {
    sum.reason = 'No new (unread) mail to reply to. The robot only acts on UNREAD messages and never marks mail as read itself.';
  }

  for (const msg of messages) {
    if (!msg.from) {
      sum.skipped++;
      skips.noSender++;
      continue;
    }
    // Never reply to ourselves (loop guard).
    if (msg.from.toLowerCase() === account.fromEmail.toLowerCase()) {
      sum.skipped++;
      skips.fromSelf++;
      continue;
    }
    // Already handled this message?
    if (msg.messageId && (await draftExistsFor(robot.id, msg.messageId))) {
      sum.skipped++;
      skips.alreadyHandled++;
      continue;
    }

    // Commander lane: the owner's own address may be issuing a BUILD command ("make me a
    // website and send it to X"). Handled entirely inside tryCommand (ack + task + receipt);
    // everyone else — and plain commander chat — falls through to the normal reply below.
    try {
      const commandText = [msg.subject, msg.text || msg.snippet].filter(Boolean).join('\n');
      if (await tryCommand(robot, 'email', msg.from, msg.fromName || null, commandText, msg.messageId || null)) {
        sum.drafted++;
        continue;
      }
    } catch (e: any) {
      console.error(`[robot ${robot.id}] command lane failed:`, e?.message ?? e);
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DRAFT_TIMEOUT_MS);
    let outcome;
    try {
      const rules = await listActiveRules(robot.id).catch(() => []);
      const extras = await replyExtrasFor(robot, robot.orgId, msg.text || msg.snippet || '').catch(() => ({}));
      outcome = await draftReply(robot, msg, ac.signal, rules, extras);
    } catch (e: any) {
      sum.error = `draft failed: ${e?.message ?? e}`;
      console.error(`[robot ${robot.id}] draft failed:`, e?.message ?? e);
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
      inboundBody: msg.text || msg.snippet || null,
      toAddr: msg.from, // LOCKED to the inbound sender
      subject: reSubject(msg.subject),
      draftText: primary.text,
      modelUsed: primary.model,
      altText: outcome.alt?.text ?? null,
      altModel: outcome.alt?.model ?? null,
      escalated: primary.escalate,
      escalationReason: primary.escalate ? primary.reason : null,
    });
    sum.drafted++;
    if (primary.escalate) sum.escalated++;

    // Auto mode: send a clean (non-escalated) draft right away, locked to the sender.
    if (robot.autonomy === 'auto' && !primary.escalate && primary.text) {
      try {
        await sendEmailForRobot(robot.id, {
          to: msg.from,
          subject: reSubject(msg.subject),
          text: primary.text,
          inReplyTo: msg.messageId || undefined,
          references: msg.messageId || undefined,
        });
        await markDraftStatus(draft.id, robot.orgId, 'sent', Date.now());
        sum.sent++;
      } catch (e: any) {
        sum.error = `auto-send failed: ${e?.message ?? e}`;
        console.error(`[robot ${robot.id}] auto-send failed:`, e?.message ?? e);
        // Leave it pending so a human can send it.
      }
    }
  }

  // Explain a quiet pass: read mail but produced no drafts (the #1 source of "it's
  // watching but did nothing" confusion — usually everything was already handled).
  if (sum.read > 0 && sum.drafted === 0 && !sum.error) {
    sum.skippedReasons = skips;
    const parts: string[] = [];
    if (skips.alreadyHandled)
      parts.push(
        `${skips.alreadyHandled} already handled (the robot replied earlier and dedupes by Message-ID, so it won't reply twice — send a NEW email to test)`,
      );
    if (skips.fromSelf) parts.push(`${skips.fromSelf} sent by the robot itself (loop guard)`);
    if (skips.noSender) parts.push(`${skips.noSender} had no sender address`);
    sum.reason = `Read ${sum.read} message(s) but drafted none: ${parts.join('; ')}.`;
  } else if (sum.skipped > 0) {
    sum.skippedReasons = skips;
  }

  await markPolled(robot.id);
  return sum;
}

async function processRobot(robot: Robot): Promise<void> {
  await pollRobotOnce(robot);
}

export async function tick(): Promise<void> {
  await wakeSnoozedDrafts().catch(() => {}); // return any due snoozed items to "needs you"
  await watchRobotTasks(getRobot).catch((e) => console.error('[robot-tasks]', (e as any)?.message ?? e));
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
