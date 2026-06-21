import path from 'node:path';
import { resolveInWorkspace, type ToolDef } from './common';
import { getEmailAccount } from '../../email/accounts';
import { readInbox, sendEmail } from '../../email/client';

/**
 * Per-org email tools. The mailbox is connected by an org admin in Settings → Email
 * (SMTP for outbound, IMAP for inbound); credentials live encrypted in the DB, never
 * here. The tools resolve the CURRENT session's org from ctx.session.orgId — a
 * session can only ever use its own organization's mailbox.
 *
 * Safety: send_email leaves the workspace, so the agent CONFIRMS the recipient +
 * content with the user before the first send (the Stage-1 posture; the robots
 * engine adds allowlists/approval/taint later).
 */

function orgOf(ctx: { session: { orgId: string | null } }): string | null {
  return ctx.session.orgId ?? null;
}

export const sendEmailTool: ToolDef = {
  name: 'send_email',
  description:
    'Send an email from THIS organization\'s connected mailbox (SMTP). Use it to deliver a result, a ' +
    'reply, or a notification by email. You can attach files from the workspace (e.g. a generated PDF, ' +
    'deck, spreadsheet, or image) by listing their paths. The mailbox must be connected by an admin in ' +
    'Settings → Email first; if it is not, you will get a clear error. CONFIRM the recipient and the ' +
    'message with the user before sending (this leaves the workspace).',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address (or comma-separated addresses).' },
      subject: { type: 'string', description: 'Subject line.' },
      body: { type: 'string', description: 'Plain-text body of the email.' },
      html: { type: 'string', description: 'Optional HTML body (for a designed email). If omitted, body is sent as text.' },
      cc: { type: 'string', description: 'Optional CC address(es).' },
      bcc: { type: 'string', description: 'Optional BCC address(es).' },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of workspace file paths to attach (e.g. ["report.pdf"]).',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `email → ${String(a.to ?? '').slice(0, 60)}`,
  async run(args, ctx) {
    const orgId = orgOf(ctx);
    if (!orgId) return 'Error: this session is not attached to an organization, so it has no mailbox.';
    const account = await getEmailAccount(orgId);
    if (!account) return 'Error: no mailbox is connected for this organization. An admin can connect one in Settings → Email.';
    if (!account.enabled) return 'Error: this organization\'s mailbox is currently disabled.';

    const to = String(args.to ?? '').trim();
    const subject = String(args.subject ?? '').trim();
    const body = String(args.body ?? '');
    if (!to || !subject) return 'Error: a recipient (to) and a subject are required.';

    const attachments = Array.isArray(args.attachments)
      ? args.attachments.map((p: any) => {
          const abs = resolveInWorkspace(ctx.repoDir, String(p));
          return { filename: path.basename(abs), path: abs };
        })
      : [];

    try {
      const { messageId } = await sendEmail(orgId, {
        to,
        subject,
        text: body,
        html: args.html ? String(args.html) : undefined,
        cc: args.cc ? String(args.cc) : undefined,
        bcc: args.bcc ? String(args.bcc) : undefined,
        attachments,
      });
      const note = attachments.length ? ` with ${attachments.length} attachment(s)` : '';
      return `Sent email to ${to}${note} (id ${messageId}).`;
    } catch (e: any) {
      return `Error sending email: ${e?.message ?? e}`;
    }
  },
};

export const readInboxTool: ToolDef = {
  name: 'read_inbox',
  description:
    'Read the most recent inbound emails from THIS organization\'s connected mailbox (IMAP). Returns the ' +
    'sender, subject, date, and body text of recent messages so you can summarize, triage, or draft a ' +
    'reply. The mailbox must be connected by an admin in Settings → Email with IMAP settings.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'How many recent messages to fetch (default 10, max 50).' },
      unseen_only: { type: 'boolean', description: 'If true, only return unread messages.' },
    },
    required: [],
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `read inbox (${a.unseen_only ? 'unread' : 'recent'})`,
  async run(args, ctx) {
    const orgId = orgOf(ctx);
    if (!orgId) return 'Error: this session is not attached to an organization, so it has no mailbox.';
    const account = await getEmailAccount(orgId);
    if (!account) return 'Error: no mailbox is connected for this organization. An admin can connect one in Settings → Email.';
    if (!account.imapHost) return 'Error: this organization\'s mailbox has no IMAP (inbound) settings configured.';

    try {
      const messages = await readInbox(orgId, {
        limit: Number(args.limit) || 10,
        unseenOnly: !!args.unseen_only,
      });
      if (!messages.length) return 'No messages found.';
      return messages
        .map((m, i) => {
          const who = m.fromName ? `${m.fromName} <${m.from}>` : m.from;
          const date = m.date ? new Date(m.date).toLocaleString() : '';
          return `#${i + 1} from ${who}${date ? ` · ${date}` : ''}\nSubject: ${m.subject}\n${m.snippet}`;
        })
        .join('\n\n');
    } catch (e: any) {
      return `Error reading inbox: ${e?.message ?? e}`;
    }
  },
};
