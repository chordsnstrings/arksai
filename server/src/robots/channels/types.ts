import type { RobotChannel, RobotChannelKind } from '../../../../shared/types';

/**
 * Channel-agnostic shapes for the non-email robot channels (Telegram / WhatsApp / SMS).
 * Every adapter speaks these; the poller + webhook routes route through them so the reply
 * engine, drafts, autonomy and locks stay IDENTICAL across channels.
 */

import type { InboundAttachment } from '../media';

/** One inbound message, normalized. `from` is the channel-native reply address
 *  (Telegram chat id, WhatsApp number, SMS number) — the draft's to_addr LOCKS to it. */
export interface ChannelInbound {
  /** Channel-native unique message id (dedupe key — drafts are idempotent per id). */
  id: string;
  from: string;
  fromName: string | null;
  text: string;
  ts: number;
  /** Media the sender attached (downloaded to temp; the handler describes + cleans up). */
  attachments?: InboundAttachment[];
}

/** The decrypted secret set for a channel (kind-specific keys; never leaves the server). */
export type ChannelSecrets = Record<string, string>;

/** A channel with its decrypted secrets — internal to adapters/poller, never serialized. */
export interface ChannelWithSecrets {
  channel: RobotChannel;
  secrets: ChannelSecrets;
}

export interface ChannelVerifyResult {
  ok: boolean;
  detail: string;
}

/** What every channel adapter implements. Poll-based channels (Telegram) provide
 *  fetchInbound; webhook-based ones (WhatsApp/SMS) receive pushes via routes instead. */
export interface ChannelAdapter {
  kind: RobotChannelKind;
  /** Cheap credential/connectivity check (getMe / graph lookup / balance). */
  verify(ch: ChannelWithSecrets): Promise<ChannelVerifyResult>;
  /** Send a plain text message to a channel-native address. */
  send(ch: ChannelWithSecrets, to: string, text: string): Promise<void>;
  /** Deliver a real file when the channel supports it (Telegram document, WhatsApp
   *  document-by-link). SMS falls back to a link in text. */
  sendFile?(ch: ChannelWithSecrets, to: string, filePath: string, caption?: string): Promise<void>;
  /** Send a VOICE NOTE (ogg/opus). Telegram takes a local path; WhatsApp a public URL. */
  sendVoiceNote?(ch: ChannelWithSecrets, to: string, fileOrUrl: string): Promise<void>;
  /** Poll-based inbound (Telegram getUpdates). Adapters persist their own cursor state. */
  fetchInbound?(ch: ChannelWithSecrets): Promise<ChannelInbound[]>;
}

/** Style guidance folded into the reply prompt per channel — chat is not email. */
export const CHANNEL_STYLE: Record<RobotChannelKind, string> = {
  telegram:
    'You are replying in a Telegram chat. Be conversational and concise (a few short sentences), ' +
    'no email greetings/sign-offs, no subject lines. Plain text only — no markdown headers.',
  whatsapp:
    'You are replying in a WhatsApp chat. Be conversational and concise (a few short sentences), ' +
    'no email greetings/sign-offs, no subject lines. Plain text only.',
  sms:
    'You are replying by SMS. Be brief and complete in at most ~450 characters — one compact ' +
    'message, plain text, no greetings/sign-offs, no links unless essential.',
};
