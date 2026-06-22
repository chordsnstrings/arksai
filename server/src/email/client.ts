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
    // Fail fast: nodemailer defaults are 2min connect / 30s greeting / 10min socket, so an
    // unreachable or silent host would hang the request until a gateway cut it ("Failed to
    // fetch"). Short, explicit timeouts surface the real error instead.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

function imapClient(account: EmailAccount, secrets: EmailSecrets): ImapFlow {
  return new ImapFlow({
    host: account.imapHost!,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.imapUser || account.smtpUser || account.fromEmail, pass: secrets.imapPass },
    logger: false,
    // Same fail-fast rationale as SMTP (defaults are generous → hangs look like "Failed to fetch").
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

/** Reject a hung connection with a clear, actionable message instead of letting it stall. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} timed out after ${Math.round(ms / 1000)}s — the mail server didn't respond. ` +
              `Check the host, port and SSL setting, and that the mailbox allows external access.`,
          ),
        ),
      ms,
    );
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}

/** imapflow buries the real reason in non-message fields; pull out the most useful one. */
function imapErrText(e: any): string {
  return (
    e?.responseText ||
    e?.serverResponseCode ||
    (e?.response && typeof e.response === 'string' ? e.response : '') ||
    e?.message ||
    String(e)
  );
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
  try {
    await client.connect();
  } catch (e: any) {
    throw new Error(`connect/login to ${account.imapHost}:${account.imapPort} failed — ${imapErrText(e)}`);
  }
  try {
    let lock;
    try {
      lock = await client.getMailboxLock(mailbox);
    } catch (e: any) {
      throw new Error(`opening "${mailbox}" failed — ${imapErrText(e)}`);
    }
    try {
      const status = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null;
      const exists = status ? status.exists : 0;
      if (!exists) return [];
      let seqList: number[];
      let useUid: boolean;
      if (opts.unseenOnly) {
        try {
          const uids = await client.search({ seen: false }, { uid: true });
          if (!uids || !uids.length) return [];
          seqList = uids.slice(-limit);
          useUid = true;
        } catch (searchErr: any) {
          // Some IMAP servers reject UID SEARCH. Fall back to scanning the last N messages
          // by sequence and filtering unread via their flags.
          const scanFrom = Math.max(1, exists - Math.max(limit, 30) + 1);
          const scan: number[] = [];
          for (let s = scanFrom; s <= exists; s++) scan.push(s);
          const unread: number[] = [];
          try {
            for await (const m of client.fetch(scan.join(','), { flags: true }, { uid: false })) {
              const seen = m.flags && [...m.flags].some((f) => /seen/i.test(String(f)));
              if (!seen) unread.push(m.seq);
            }
          } catch {
            throw new Error(`searching for unread mail failed — ${imapErrText(searchErr)}`);
          }
          if (!unread.length) return [];
          seqList = unread.slice(-limit);
          useUid = false;
        }
      } else {
        const start = Math.max(1, exists - limit + 1);
        seqList = [];
        for (let s = start; s <= exists; s++) seqList.push(s);
        useUid = false;
      }
      const range = seqList.join(',');
      try {
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
      } catch (e: any) {
        throw new Error(`fetching messages failed — ${imapErrText(e)}`);
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

/** Test both legs of a connection without persisting anything. Each leg is bounded by a
 *  hard deadline AND the two run concurrently, so even a fully-unreachable host returns a
 *  clear error in ~15s (never a hang, never long enough for a gateway to cut it → no more
 *  "Failed to fetch"). */
export async function verifyAccount(account: EmailAccount, secrets: EmailSecrets): Promise<VerifyResult> {
  const checkSmtp = async (): Promise<VerifyResult['smtp']> => {
    const transport = smtpTransport(account, secrets);
    try {
      await withTimeout(transport.verify(), 15000, 'SMTP check');
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    } finally {
      try {
        transport.close();
      } catch {
        /* best effort */
      }
    }
  };

  const checkImap = async (): Promise<VerifyResult['imap']> => {
    if (!account.imapHost) return { ok: false, skipped: true };
    const client = imapClient(account, secrets);
    try {
      await withTimeout(client.connect(), 15000, 'IMAP check');
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: imapErrText(e) };
    } finally {
      // logout cleanly if connected; otherwise force the socket closed so it can't linger.
      try {
        await withTimeout(client.logout(), 5000, 'IMAP logout');
      } catch {
        try {
          client.close();
        } catch {
          /* best effort */
        }
      }
    }
  };

  const [smtp, imap] = await Promise.all([checkSmtp(), checkImap()]);
  return { smtp, imap };
}
