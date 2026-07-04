import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Robot, RobotConfig, RobotDraft, RobotDraftChannel } from '../../../shared/types';
import { config } from '../config';
import { sendEmailForRobot } from '../email/client';
import { withSecrets } from './channels/store';
import { ADAPTERS } from './channels/registry';
import { mintRobotFileToken } from '../routes/robotFiles';
import { getRobot, markDraftStatus } from './store';
import { synthesizeSpeechBuffer, ttsAvailable } from '../engines/minimax';

/**
 * Channel-agnostic OUTBOUND helpers shared by the task lane, the owner notifier, and the
 * draft-send route: one place that knows how to put a text or a file onto any channel.
 */

export async function sendOnChannel(robot: Robot | { id: string }, channel: RobotDraftChannel, to: string, text: string): Promise<void> {
  const robotId = robot.id;
  if (channel === 'email') {
    await sendEmailForRobot(robotId, { to, subject: 'Your robot', text });
    return;
  }
  const ch = await withSecrets(robotId, channel);
  if (!ch) throw new Error(`${channel} is not connected for this robot`);
  await ADAPTERS[channel].send(ch, to, text);
}

export async function sendFileOnChannel(
  robot: Robot | { id: string },
  channel: RobotDraftChannel,
  to: string,
  abs: string,
  caption: string,
): Promise<void> {
  const robotId = robot.id;
  if (channel === 'email') {
    await sendEmailForRobot(robotId, {
      to,
      subject: caption || `Your file: ${path.basename(abs)}`,
      text: caption || 'Here is the file you asked for.',
      attachments: [{ filename: path.basename(abs), path: abs }],
    });
    return;
  }
  const ch = await withSecrets(robotId, channel);
  if (!ch) throw new Error(`${channel} is not connected for this robot`);
  const adapter = ADAPTERS[channel];
  if (channel === 'telegram' && adapter.sendFile) {
    await adapter.sendFile(ch, to, abs, caption);
    return;
  }
  // WhatsApp needs a public link; SMS can only carry a link.
  const url = `${config.publicBaseUrl.replace(/\/$/, '')}/api/robot-file/${mintRobotFileToken(abs)}`;
  if (channel === 'whatsapp' && adapter.sendFile) {
    await adapter.sendFile(ch, to, url, caption);
    return;
  }
  await adapter.send(ch, to, `${caption ? caption + ' ' : ''}${path.basename(abs)}: ${url} (link valid ~1h)`);
}

// ---- voice replies (TTS out) ----

/** Pure policy: should this reply also go out as a voice note?
 *  'mirror' (default) speaks only when the sender spoke; 'always' speaks on every chat
 *  reply; 'off' never. Email/SMS never get voice (wrong medium). */
export function wantsVoiceReply(cfg: RobotConfig | undefined, channel: RobotDraftChannel, senderSpoke: boolean): boolean {
  if (channel !== 'telegram' && channel !== 'whatsapp') return false;
  const mode = cfg?.voiceReplies ?? 'mirror';
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return senderSpoke;
}

/** Pure: trim a reply into speakable text (no markdown/code/links noise), bounded. */
export function speakableText(text: string, cap = 600): string {
  const t = text
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' (link sent in the message) ')
    .replace(/[*_#`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > cap ? `${t.slice(0, cap).replace(/\s+\S*$/, '')}…` : t;
}

/** mp3 → ogg/opus (what Telegram/WhatsApp treat as a real voice note). */
async function mp3ToOpus(mp3Path: string, outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-i', mp3Path, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', outPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`ffmpeg unavailable: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg opus failed (${code}): ${err.slice(-160)}`))));
  });
}

/**
 * Speak a reply onto a chat channel as a real voice note (in ADDITION to the text, which
 * always goes first — accessibility + the written record). Fail-soft: any problem is
 * logged and the text reply stands alone. Voice files live under data/ so WhatsApp's
 * link-based delivery can mint a token URL; cleaned after ~5 min.
 */
export async function sendVoiceOnChannel(
  robot: Robot | { id: string },
  channel: RobotDraftChannel,
  to: string,
  text: string,
): Promise<boolean> {
  if (!ttsAvailable()) return false;
  const spoken = speakableText(text);
  if (!spoken || spoken.length < 5) return false;
  const adapter = channel === 'telegram' || channel === 'whatsapp' ? ADAPTERS[channel] : null;
  if (!adapter?.sendVoiceNote) return false;
  const dir = path.join(config.dataDir, 'robot-voice');
  fs.mkdirSync(dir, { recursive: true });
  const mp3 = path.join(dir, `${randomUUID()}.mp3`);
  const ogg = path.join(dir, `${randomUUID()}.ogg`);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45_000);
    let synth;
    try {
      synth = await synthesizeSpeechBuffer(spoken, {}, ac.signal);
    } finally {
      clearTimeout(timer);
    }
    if (!synth.ok || !synth.buffer) return false;
    fs.writeFileSync(mp3, synth.buffer);
    await mp3ToOpus(mp3, ogg);
    const ch = await withSecrets(robot.id, channel as 'telegram' | 'whatsapp');
    if (!ch) return false;
    if (channel === 'telegram') {
      await adapter.sendVoiceNote(ch, to, ogg);
    } else {
      const url = `${config.publicBaseUrl.replace(/\/$/, '')}/api/robot-file/${mintRobotFileToken(ogg)}`;
      await adapter.sendVoiceNote(ch, to, url);
    }
    return true;
  } catch (e: any) {
    console.error(`[robot ${robot.id}] voice reply failed:`, e?.message ?? e);
    return false;
  } finally {
    fs.rmSync(mp3, { force: true });
    // WhatsApp fetches the ogg by link asynchronously — keep it briefly, then sweep.
    setTimeout(() => fs.rmSync(ogg, { force: true }), 5 * 60_000).unref?.();
  }
}

/**
 * Send a stored draft out on ITS OWN channel — recipient LOCKED to the stored to_addr,
 * subject/threading from the draft; the (possibly edited) text is the only variable.
 * Marks the draft sent on success. Used by the console send route AND remote approval.
 */
export async function deliverDraft(draft: RobotDraft, text?: string): Promise<void> {
  const body = text ?? draft.draftText;
  if (draft.channel && draft.channel !== 'email') {
    const adapter = ADAPTERS[draft.channel];
    const ch = adapter ? await withSecrets(draft.robotId, draft.channel) : null;
    if (!adapter || !ch) throw new Error('That channel is no longer connected for this robot.');
    await adapter.send(ch, draft.toAddr /* LOCKED */, body);
    // Voice reply per policy (mirror = the sender sent a voice note). Fire-and-forget.
    void (async () => {
      const robot = await getRobot(draft.robotId).catch(() => null);
      const senderSpoke = /voice note "[^"]*" \(transcribed\)/.test(draft.inboundBody || '');
      if (robot && wantsVoiceReply(robot.config, draft.channel, senderSpoke)) {
        await sendVoiceOnChannel(robot, draft.channel, draft.toAddr, body);
      }
    })().catch(() => {});
  } else {
    await sendEmailForRobot(draft.robotId, {
      to: draft.toAddr, // LOCKED
      subject: draft.subject,
      text: body,
      inReplyTo: draft.inboundMessageId || undefined,
      references: draft.inboundMessageId || undefined,
      // Meeting-invite lane: the prepared iCal REPLY rides along as a calendar part.
      icsReply: (draft as any).icsReply || undefined,
    });
  }
  await markDraftStatus(draft.id, draft.orgId, 'sent', Date.now());
}
