import path from 'node:path';
import type { Robot, RobotDraft, RobotDraftChannel } from '../../../shared/types';
import { config } from '../config';
import { sendEmailForRobot } from '../email/client';
import { withSecrets } from './channels/store';
import { ADAPTERS } from './channels/registry';
import { mintRobotFileToken } from '../routes/robotFiles';
import { markDraftStatus } from './store';

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
