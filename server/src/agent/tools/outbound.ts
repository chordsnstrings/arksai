import { fetchPublic } from '../../lib/web';
import type { ToolDef } from './common';

/**
 * Deliver a result OUTWARD to a user-provided webhook — a Slack Incoming Webhook,
 * a Zapier/Make hook, or a Discord webhook. Credential-free: the user pastes a
 * hook URL (no OAuth app). SSRF-guarded. (Sharing a built app is already covered
 * by publish_app's public URL + the download chips.)
 */
export const sendWebhookTool: ToolDef = {
  name: 'send_webhook',
  description:
    'Send a short message/summary to a user-provided webhook URL (a Slack Incoming Webhook, a ' +
    'Zapier/Make hook, or a Discord webhook) — to deliver a result, a notification, or a summary. ' +
    'The payload is JSON {text,title}. CONFIRM the webhook URL and the message with the user before ' +
    'sending (this leaves the workspace). For email/Slack-app/Drive delivery, a configured ' +
    'integration is needed instead.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The webhook URL the user provided (Slack/Zapier/Make/Discord).' },
      message: { type: 'string', description: 'The message body to send.' },
      title: { type: 'string', description: 'Optional short title/heading.' },
    },
    required: ['url', 'message'],
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `webhook → ${String(a.url ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    const url = String(args.url ?? '').trim();
    const message = String(args.message ?? '').trim();
    const title = args.title ? String(args.title).trim() : '';
    if (!url || !message) return 'Error: a webhook url and a message are required.';
    // Slack/Discord accept {text}; Zapier/Make accept arbitrary JSON. Cover both.
    const text = title ? `*${title}*\n${message}` : message;
    const payload = JSON.stringify({ text, title: title || undefined, message });
    try {
      const res = await fetchPublic(url, ctx.signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (res.status >= 400) return `Error: the webhook returned HTTP ${res.status}: ${res.body.slice(0, 200)}`;
      return `Sent to the webhook (HTTP ${res.status}).`;
    } catch (e: any) {
      return `Error: could not reach the webhook — ${e?.message ?? e}`;
    }
  },
};
