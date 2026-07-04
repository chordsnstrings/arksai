import type { Robot, RobotChannelKind } from '../../../../shared/types';
import type { InboxMessage } from '../../email/client';
import { createDraft, draftExistsFor, listActiveRules, markDraftStatus } from '../store';
import { draftReply } from '../reply';
import { replyExtrasFor } from '../personas';
import type { ChannelAdapter, ChannelInbound, ChannelWithSecrets } from './types';
import { telegramAdapter } from './telegram';
import { whatsappAdapter } from './whatsapp';
import { smsAdapter } from './sms';

/**
 * The channel-agnostic inbound handler — the email poll loop's per-message body, reused for
 * every chat/SMS channel. Same guarantees: idempotent per message id, recipient LOCKED to the
 * inbound sender, `ask` leaves the draft pending, `auto` sends immediately via the adapter,
 * escalations never auto-send.
 */

export const ADAPTERS: Record<RobotChannelKind, ChannelAdapter> = {
  telegram: telegramAdapter,
  whatsapp: whatsappAdapter,
  sms: smsAdapter,
};

const DRAFT_TIMEOUT_MS = Number(process.env.ROBOT_DRAFT_TIMEOUT_MS || '90000') || 90_000;

/** Commander hook (Phase 4): given an inbound message from a TRUSTED commander, either handle
 *  it as a build command (return true) or fall through to the normal reply lane (false).
 *  Wired via setCommandHook to avoid a circular import with the task executor. */
export type CommandHook = (robot: Robot, ch: ChannelWithSecrets, msg: ChannelInbound) => Promise<boolean>;
let commandHook: CommandHook | null = null;
export function setCommandHook(h: CommandHook | null): void {
  commandHook = h;
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
    if (!msg.from || !msg.text.trim()) {
      sum.skipped++;
      return sum;
    }
    // Idempotent per channel message id (same guarantee as email Message-ID dedupe).
    if (msg.id && (await draftExistsFor(robot.id, msg.id))) {
      sum.skipped++;
      return sum;
    }

    // Commander lane first: a trusted owner message may be a build command (Phase 4 hook).
    if (commandHook && (await commandHook(robot, ch, msg))) {
      sum.commands++;
      return sum;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DRAFT_TIMEOUT_MS);
    let outcome;
    try {
      const rules = await listActiveRules(robot.id).catch(() => []);
      const extras = await replyExtrasFor(robot, robot.orgId, msg.text).catch(() => ({}));
      outcome = await draftReply(robot, toInboxMessage(msg), ac.signal, rules, { ...extras, channel: kind });
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
      inboundSnippet: msg.text.slice(0, 160),
      inboundBody: msg.text,
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

    if (robot.autonomy === 'auto' && !primary.escalate && primary.text) {
      try {
        await ADAPTERS[kind].send(ch, msg.from, primary.text);
        await markDraftStatus(draft.id, robot.orgId, 'sent', Date.now());
        sum.sent++;
      } catch (e: any) {
        sum.error = `auto-send failed: ${e?.message ?? e}`;
        console.error(`[robot ${robot.id}] ${kind} auto-send failed:`, sum.error);
        // Leave it pending so a human can send it.
      }
    }
  } catch (e: any) {
    sum.error = e?.message ?? String(e);
    console.error(`[robot ${robot.id}] ${kind} inbound failed:`, sum.error);
  }
  return sum;
}
