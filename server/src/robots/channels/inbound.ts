import type { Robot, RobotChannelKind } from '../../../../shared/types';
import type { InboxMessage } from '../../email/client';
import { createDraft, draftExistsFor, listActiveRules, markDraftStatus } from '../store';
import { draftReplyWithActions } from '../actions';
import { replyExtrasFor } from '../personas';
import { cleanupAttachments, describeAttachments } from '../media';
import type { ChannelAdapter, ChannelInbound, ChannelWithSecrets } from './types';
import { ADAPTERS } from './registry';
export { ADAPTERS } from './registry';

/**
 * The channel-agnostic inbound handler — the email poll loop's per-message body, reused for
 * every chat/SMS channel. Same guarantees: idempotent per message id, recipient LOCKED to the
 * inbound sender, `ask` leaves the draft pending, `auto` sends immediately via the adapter,
 * escalations never auto-send.
 */

const DRAFT_TIMEOUT_MS = Number(process.env.ROBOT_DRAFT_TIMEOUT_MS || '90000') || 90_000;

/** Commander hook (Phase 4): given an inbound message from a TRUSTED commander, either handle
 *  it as a build command (return true) or fall through to the normal reply lane (false).
 *  Wired via setCommandHook to avoid a circular import with the task executor. */
export type CommandHook = (robot: Robot, ch: ChannelWithSecrets, msg: ChannelInbound) => Promise<boolean>;
let commandHook: CommandHook | null = null;
export function setCommandHook(h: CommandHook | null): void {
  commandHook = h;
}

/** Owner-notification resolution hook (robots/notify.ts) — runs AFTER the command lane, so
 *  "build me X" still wins over an outstanding ping, but "APPROVE" resolves the ping. */
export type ResolveHook = (
  robot: Robot,
  channel: RobotChannelKind,
  from: string,
  fromName: string | null,
  text: string,
  messageId: string | null,
) => Promise<boolean>;
let resolveHook: ResolveHook | null = null;
export function setResolveHook(h: ResolveHook | null): void {
  resolveHook = h;
}

/** Draft-created hook (robots/notify.ts) — pings the owner about a draft that needs them. */
export type NotifyHook = (robot: Robot, draftId: string) => Promise<void>;
let notifyHook: NotifyHook | null = null;
export function setNotifyHook(h: NotifyHook | null): void {
  notifyHook = h;
}
export function fireNotifyHook(robot: Robot, draftId: string): void {
  if (notifyHook) void notifyHook(robot, draftId).catch(() => {});
}

export interface InboundSummary {
  drafted: number;
  sent: number;
  escalated: number;
  skipped: number;
  commands: number;
  error?: string;
}

/** Convert a channel message into the reply engine's message shape. */
export function toInboxMessage(msg: ChannelInbound): InboxMessage {
  return {
    uid: 0,
    seq: 0,
    from: msg.from,
    fromName: msg.fromName || '',
    to: '',
    subject: '',
    date: new Date(msg.ts).toISOString(),
    messageId: msg.id,
    snippet: msg.text.slice(0, 160),
    text: msg.text,
  } as InboxMessage;
}

/** Process ONE inbound channel message end-to-end. Never throws. */
export async function handleChannelInbound(
  robot: Robot,
  ch: ChannelWithSecrets,
  msg: ChannelInbound,
): Promise<InboundSummary> {
  const sum: InboundSummary = { drafted: 0, sent: 0, escalated: 0, skipped: 0, commands: 0 };
  const kind = ch.channel.kind;
  try {
    // A message may be attachment-only (a photo with no caption) — still handled.
    if (!msg.from || (!msg.text.trim() && !msg.attachments?.length)) {
      sum.skipped++;
      return sum;
    }
    // Idempotent per channel message id (same guarantee as email Message-ID dedupe).
    if (msg.id && (await draftExistsFor(robot.id, msg.id))) {
      sum.skipped++;
      return sum;
    }

    // Describe any attached media FIRST (vision for photos, extraction for docs,
    // TRANSCRIPTION for voice notes) — a spoken "build me a landing page" must reach the
    // command lane exactly like a typed one. Notes also fold into the stored body so the
    // console responder sees what was sent.
    let attachmentNotes: string[] = [];
    let voiceText = '';
    if (msg.attachments?.length) {
      const mac = new AbortController();
      const mtimer = setTimeout(() => mac.abort(), DRAFT_TIMEOUT_MS);
      try {
        const digest = await describeAttachments(msg.attachments, mac.signal);
        attachmentNotes = digest.notes;
        voiceText = digest.voiceText;
      } finally {
        clearTimeout(mtimer);
        cleanupAttachments(msg.attachments);
      }
    }
    // What the sender effectively SAID: typed text + spoken words.
    const laneText = [msg.text, voiceText].filter(Boolean).join('\n').trim();

    // Commander lane first: a trusted owner message (typed or spoken) may be a build command.
    if (laneText && commandHook && (await commandHook(robot, ch, { ...msg, text: laneText }))) {
      sum.commands++;
      return sum;
    }
    // Owner-approval lane: "APPROVE" / "ignore" / direction on an outstanding ping.
    if (laneText && resolveHook && (await resolveHook(robot, kind, msg.from, msg.fromName, laneText, msg.id || null))) {
      sum.commands++;
      return sum;
    }

    const storedBody = [msg.text, ...(attachmentNotes.length ? ['', '— attachments —', ...attachmentNotes] : [])]
      .join('\n')
      .trim();
    const retrievalText = [msg.text, ...attachmentNotes].join('\n');

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DRAFT_TIMEOUT_MS);
    let outcome;
    try {
      const rules = await listActiveRules(robot.id).catch(() => []);
      const extras = await replyExtrasFor(robot, robot.orgId, retrievalText, { channel: kind, fromAddr: msg.from }).catch(
        () => ({}),
      );
      outcome = await draftReplyWithActions(robot, toInboxMessage(msg), ac.signal, rules, {
        ...extras,
        channel: kind,
        attachmentNotes: attachmentNotes.length ? attachmentNotes : undefined,
      });
    } finally {
      clearTimeout(timer);
    }

    const primary = outcome.primary;
    const draft = await createDraft({
      robotId: robot.id,
      orgId: robot.orgId,
      inboundMessageId: msg.id || null,
      inboundFrom: msg.from,
      inboundName: msg.fromName,
      inboundSubject: null,
      inboundSnippet: (msg.text || attachmentNotes[0] || '').slice(0, 160),
      inboundBody: storedBody,
      toAddr: msg.from, // LOCKED to the inbound sender
      subject: '',
      draftText: primary.text,
      modelUsed: primary.model,
      altText: outcome.alt?.text ?? null,
      altModel: outcome.alt?.model ?? null,
      escalated: primary.escalate,
      escalationReason: primary.escalate ? primary.reason : null,
      channel: kind,
    });
    sum.drafted++;
    if (primary.escalate) sum.escalated++;

    let autoSent = false;
    if (robot.autonomy === 'auto' && !primary.escalate && primary.text) {
      try {
        await ADAPTERS[kind].send(ch, msg.from, primary.text);
        await markDraftStatus(draft.id, robot.orgId, 'sent', Date.now());
        sum.sent++;
        autoSent = true;
      } catch (e: any) {
        sum.error = `auto-send failed: ${e?.message ?? e}`;
        console.error(`[robot ${robot.id}] ${kind} auto-send failed:`, sum.error);
        // Leave it pending so a human can send it.
      }
    }
    // Ping the owner about anything still needing them (never about a reply that went out).
    if (!autoSent) fireNotifyHook(robot, draft.id);
  } catch (e: any) {
    sum.error = e?.message ?? String(e);
    console.error(`[robot ${robot.id}] ${kind} inbound failed:`, sum.error);
  }
  return sum;
}
