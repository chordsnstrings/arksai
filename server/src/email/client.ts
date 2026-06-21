import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  accountSecrets,
  getEmailAccount,
  getRobotEmailAccount,
  robotAccountSecrets,
  type EmailAccount,
  type EmailSecrets,
} from './accounts';

/**
 * Runtime SMTP/IMAP client built from a per-org connection. Outbound via nodemailer,
 * inbound via imapflow + mailparser. All functions resolve the org's stored,
 * decrypted credentials internally — callers pass only an orgId + the action.
 */

export interface OutgoingAttachment {
  filename: string;
  path: string; // absolute path on the server (already resolved inside the workspace)
}

export interface SendOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  inReplyTo?: string; // Message-ID being replied to (threads the reply)
  references?: string;
  attachments?: OutgoingAttachment[];
}

export interface InboxMessage {
  uid: number;
  seq: number;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  snippet: string;
  text: string;
}

function smtpTransport(account: EmailAccount, secrets: EmailSecrets) {
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure, // true for 465, false for 587 (STARTTLS)
    auth: account.smtpUser ? { user: account.smtpUser, pass: secrets.smtpPass } : undefined,
  });
}

function imapClient(account: EmailAccount, secrets: EmailSecrets): ImapFlow {
  return new ImapFlow({
    host: account.imapHost!,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.imapUser || account.smtpUser || account.fromEmail, pass: secrets.imapPass },
    logger: false,
  });
}

function fromHeader(account: EmailAccount): string {
  return account.fromName ? `${account.fromName} <${account.fromEmail}>` : account.fromEmail;
}

/** Core send: works off a resolved account + secrets (org- or robot-owned). */
export async function sendWithAccount(
  account: EmailAccount,
  secrets: EmailSecrets,
  opts: SendOptions,
): Promise<{ messageId: string }> {
  const attachments = (opts.attachments ?? [])
    .filter((a) => a.path && fs.existsSync(a.path))
    .map((a) => ({ filename: a.filename || path.basename(a.path), path: a.path }));

  const transport = smtpTransport(account, secrets);
  const info = await transport.sendMail({
    from: fromHeader(account),
    to: opts.to,
    cc: opts.cc || undefined,
    bcc: opts.bcc || undefined,
    replyTo: opts.replyTo || undefined,
    inReplyTo: opts.inReplyTo || undefined,
    references: opts.references || undefined,
    subject: opts.subject,
    text: opts.text || undefined,
    html: opts.html || undefined,
    attachments: attachments.length ? attachments : undefined,
  });
  return { messageId: info.messageId };
}

/** Send from an ORG mailbox (the general agent tools). */
export async function sendEmail(orgId: string, opts: SendOptions): Promise<{ messageId: string }> {
  const account = await getEmailAccount(orgId);
  if (!account) throw new Error('No email account is connected for this organization.');
  if (!account.enabled) throw new Error('This organization\'s email account is disabled.');
  return sendWithAccount(account, await accountSecrets(orgId), opts);
}

/** Send from a ROBOT's own mailbox. */
export async function sendEmailForRobot(robotId: string, opts: SendOptions): Promise<{ messageId: string }> {
  const account = await getRobotEmailAccount(robotId);
  if (!account) throw new Error('This robot has no mailbox connected.');
  if (!account.enabled) throw new Error('This robot\'s mailbox is disabled.');
  return sendWithAccount(account, await robotAccountSecrets(robotId), opts);
}

/** Core inbox read: works off a resolved account + secrets. */
export async function readInboxWithAccount(
  account: EmailAccount,
  secrets: EmailSecrets,
  opts: { limit?: number; mailbox?: string; unseenOnly?: boolean } = {},
): Promise<InboxMessage[]> {
  if (!account.imapHost) throw new Error('No IMAP (inbound) settings are configured for this mailbox.');
  const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
  const mailbox = opts.mailbox || 'INBOX';

  const client = imapClient(account, secrets);
  const out: InboxMessage[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const status = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null;
      const exists = status ? status.exists : 0;
      if (!exists) return [];
      let seqList: number[];
      if (opts.unseenOnly) {
        const uids = await client.search({ seen: false }, { uid: true });
        if (!uids || !uids.length) return [];
        seqList = uids.slice(-limit);
      } else {
        const start = Math.max(1, exists - limit + 1);
        seqList = [];
        for (let s = start; s <= exists; s++) seqList.push(s);
      }
      const range = seqList.join(',');
      const useUid = !!opts.unseenOnly;
      for await (const msg of client.fetch(range, { envelope: true, source: true, uid: true }, { uid: useUid })) {
        const parsed = await simpleParser(msg.source as Buffer);
        const fromAddr = parsed.from?.value?.[0];
        const text = (parsed.text || '').trim();
        out.push({
          uid: msg.uid,
          seq: msg.seq,
          from: fromAddr?.address || '',
          fromName: fromAddr?.name || '',
          to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : parsed.to.text) : '',
          subject: parsed.subject || '(no subject)',
          date: parsed.date ? parsed.date.toISOString() : '',
          messageId: parsed.messageId || '',
          snippet: text.replace(/\s+/g, ' ').slice(0, 240),
          text,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out.sort((a, b) => (b.date > a.date ? 1 : -1));
}

/** Read an ORG mailbox (the general agent tools). */
export async function readInbox(
  orgId: string,
  opts: { limit?: number; mailbox?: string; unseenOnly?: boolean } = {},
): Promise<InboxMessage[]> {
  const account = await getEmailAccount(orgId);
  if (!account) throw new Error('No email account is connected for this organization.');
  return readInboxWithAccount(account, await accountSecrets(orgId), opts);
}

/** Read a ROBOT's own mailbox. */
export async function readInboxForRobot(
  robotId: string,
  opts: { limit?: number; mailbox?: string; unseenOnly?: boolean } = {},
): Promise<InboxMessage[]> {
  const account = await getRobotEmailAccount(robotId);
  if (!account) throw new Error('This robot has no mailbox connected.');
  return readInboxWithAccount(account, await robotAccountSecrets(robotId), opts);
}

export interface VerifyResult {
  smtp: { ok: boolean; error?: string };
  imap: { ok: boolean; error?: string; skipped?: boolean };
}

/** Test both legs of a connection without persisting anything. */
export async function verifyAccount(account: EmailAccount, secrets: EmailSecrets): Promise<VerifyResult> {
  const result: VerifyResult = { smtp: { ok: false }, imap: { ok: false, skipped: true } };
  try {
    await smtpTransport(account, secrets).verify();
    result.smtp.ok = true;
  } catch (e: any) {
    result.smtp = { ok: false, error: e?.message || String(e) };
  }
  if (account.imapHost) {
    const client = imapClient(account, secrets);
    try {
      await client.connect();
      await client.logout();
      result.imap = { ok: true };
    } catch (e: any) {
      result.imap = { ok: false, error: e?.message || String(e) };
    }
  }
  return result;
}
