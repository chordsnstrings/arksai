import { q, qOne } from '../db';
import { decryptSecret, encryptSecret } from '../lib/crypto';

/**
 * Per-org email connection store. One mailbox per org. Passwords are encrypted at
 * rest (AES-256-GCM); they are NEVER returned to the client (only a `hasPassword`
 * flag is exposed via `publicAccount`). The runtime client (email/client.ts) reads
 * the decrypted password through `accountWithSecrets`.
 */

export interface EmailAccount {
  orgId: string;
  robotId?: string | null;
  fromName: string | null;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string | null;
  enabled: boolean;
  autoReply: boolean;
  verifiedAt: number | null;
  hasSmtpPass: boolean;
  hasImapPass: boolean;
  updatedAt: number;
}

/** Decrypted secrets — server-internal only, never serialized to a response. */
export interface EmailSecrets {
  smtpPass: string;
  imapPass: string;
}

function rowToAccount(r: any): EmailAccount {
  return {
    orgId: r.org_id,
    robotId: r.robot_id ?? null,
    fromName: r.from_name ?? null,
    fromEmail: r.from_email,
    smtpHost: r.smtp_host,
    smtpPort: Number(r.smtp_port),
    smtpSecure: !!Number(r.smtp_secure),
    smtpUser: r.smtp_user ?? null,
    imapHost: r.imap_host ?? null,
    imapPort: Number(r.imap_port),
    imapSecure: !!Number(r.imap_secure),
    imapUser: r.imap_user ?? null,
    enabled: !!Number(r.enabled),
    autoReply: !!Number(r.auto_reply),
    verifiedAt: r.verified_at != null ? Number(r.verified_at) : null,
    hasSmtpPass: !!r.smtp_pass,
    hasImapPass: !!r.imap_pass,
    updatedAt: Number(r.updated_at),
  };
}

export async function getEmailAccount(orgId: string): Promise<EmailAccount | null> {
  const r = await qOne('SELECT * FROM org_email_accounts WHERE org_id = $1', [orgId]);
  return r ? rowToAccount(r) : null;
}

/** Decrypt the stored secrets for runtime use. Returns empty strings if unset. */
export async function accountSecrets(orgId: string): Promise<EmailSecrets> {
  const r = await qOne('SELECT smtp_pass, imap_pass FROM org_email_accounts WHERE org_id = $1', [orgId]);
  const dec = (v: any) => {
    if (!v) return '';
    try {
      return decryptSecret(v);
    } catch {
      return '';
    }
  };
  return { smtpPass: dec(r?.smtp_pass), imapPass: dec(r?.imap_pass) };
}

export interface EmailAccountInput {
  fromName?: string | null;
  fromEmail: string;
  smtpHost: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPass?: string | null; // plaintext from the form; '' / undefined = keep existing
  imapHost?: string | null;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string | null;
  imapPass?: string | null;
  enabled?: boolean;
  autoReply?: boolean;
}

/**
 * Create or update an org's mailbox. A blank password field means "keep the
 * existing stored password" (so the client never has to re-enter it on edit).
 */
export async function upsertEmailAccount(orgId: string, input: EmailAccountInput): Promise<EmailAccount> {
  const now = Date.now();
  const existing = await qOne('SELECT smtp_pass, imap_pass FROM org_email_accounts WHERE org_id = $1', [orgId]);
  const encOrKeep = (plain: string | null | undefined, current: any): any => {
    if (plain == null || plain === '') return current ?? null;
    return encryptSecret(plain);
  };
  const smtpPass = encOrKeep(input.smtpPass, existing?.smtp_pass);
  const imapPass = encOrKeep(input.imapPass, existing?.imap_pass);

  await q(
    `INSERT INTO org_email_accounts(
       org_id, from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass,
       imap_host, imap_port, imap_secure, imap_user, imap_pass, enabled, auto_reply, verified_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT(org_id) DO UPDATE SET
       from_name = excluded.from_name, from_email = excluded.from_email,
       smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port, smtp_secure = excluded.smtp_secure,
       smtp_user = excluded.smtp_user, smtp_pass = excluded.smtp_pass,
       imap_host = excluded.imap_host, imap_port = excluded.imap_port, imap_secure = excluded.imap_secure,
       imap_user = excluded.imap_user, imap_pass = excluded.imap_pass,
       enabled = excluded.enabled, auto_reply = excluded.auto_reply, updated_at = excluded.updated_at`,
    [
      orgId,
      input.fromName ?? null,
      input.fromEmail,
      input.smtpHost,
      input.smtpPort ?? 587,
      input.smtpSecure ? 1 : 0,
      input.smtpUser ?? null,
      smtpPass,
      input.imapHost ?? null,
      input.imapPort ?? 993,
      input.imapSecure === false ? 0 : 1,
      input.imapUser ?? null,
      imapPass,
      input.enabled === false ? 0 : 1,
      input.autoReply ? 1 : 0,
      null,
      now,
      now,
    ],
  );
  return (await getEmailAccount(orgId))!;
}

export async function markVerified(orgId: string, ts: number = Date.now()): Promise<void> {
  await q('UPDATE org_email_accounts SET verified_at = $1 WHERE org_id = $2', [ts, orgId]);
}

export async function deleteEmailAccount(orgId: string): Promise<void> {
  await q('DELETE FROM org_email_accounts WHERE org_id = $1', [orgId]);
}

/** Orgs that have inbound polling enabled (Stage 2 auto-reply). */
export async function listAutoReplyAccounts(): Promise<EmailAccount[]> {
  const rows = await q(
    'SELECT * FROM org_email_accounts WHERE enabled = 1 AND auto_reply = 1 AND imap_host IS NOT NULL',
  );
  return rows.map(rowToAccount);
}

// ---------------------------------------------------------------------------
// Per-ROBOT mailbox (each robot is its own email identity; multi-tenant). Same
// shape as the org account, keyed by robot_id. Shared encrypt/keep helpers.
// ---------------------------------------------------------------------------

export async function getRobotEmailAccount(robotId: string): Promise<EmailAccount | null> {
  const r = await qOne('SELECT * FROM robot_email_accounts WHERE robot_id = $1', [robotId]);
  return r ? rowToAccount(r) : null;
}

export async function robotAccountSecrets(robotId: string): Promise<EmailSecrets> {
  const r = await qOne('SELECT smtp_pass, imap_pass FROM robot_email_accounts WHERE robot_id = $1', [robotId]);
  const dec = (v: any) => {
    if (!v) return '';
    try {
      return decryptSecret(v);
    } catch {
      return '';
    }
  };
  return { smtpPass: dec(r?.smtp_pass), imapPass: dec(r?.imap_pass) };
}

export async function upsertRobotEmailAccount(
  robotId: string,
  orgId: string,
  input: EmailAccountInput,
): Promise<EmailAccount> {
  const now = Date.now();
  const existing = await qOne('SELECT smtp_pass, imap_pass FROM robot_email_accounts WHERE robot_id = $1', [robotId]);
  const encOrKeep = (plain: string | null | undefined, current: any): any => {
    if (plain == null || plain === '') return current ?? null;
    return encryptSecret(plain);
  };
  const smtpPass = encOrKeep(input.smtpPass, existing?.smtp_pass);
  const imapPass = encOrKeep(input.imapPass, existing?.imap_pass);

  await q(
    `INSERT INTO robot_email_accounts(
       robot_id, org_id, from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass,
       imap_host, imap_port, imap_secure, imap_user, imap_pass, enabled, auto_reply, verified_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT(robot_id) DO UPDATE SET
       from_name = excluded.from_name, from_email = excluded.from_email,
       smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port, smtp_secure = excluded.smtp_secure,
       smtp_user = excluded.smtp_user, smtp_pass = excluded.smtp_pass,
       imap_host = excluded.imap_host, imap_port = excluded.imap_port, imap_secure = excluded.imap_secure,
       imap_user = excluded.imap_user, imap_pass = excluded.imap_pass,
       enabled = excluded.enabled, auto_reply = excluded.auto_reply, updated_at = excluded.updated_at`,
    [
      robotId,
      orgId,
      input.fromName ?? null,
      input.fromEmail,
      input.smtpHost,
      input.smtpPort ?? 587,
      input.smtpSecure ? 1 : 0,
      input.smtpUser ?? null,
      smtpPass,
      input.imapHost ?? null,
      input.imapPort ?? 993,
      input.imapSecure === false ? 0 : 1,
      input.imapUser ?? null,
      imapPass,
      input.enabled === false ? 0 : 1,
      input.autoReply ? 1 : 0,
      null,
      now,
      now,
    ],
  );
  return (await getRobotEmailAccount(robotId))!;
}

export async function markRobotVerified(robotId: string, ts: number = Date.now()): Promise<void> {
  await q('UPDATE robot_email_accounts SET verified_at = $1 WHERE robot_id = $2', [ts, robotId]);
}

export async function deleteRobotEmailAccount(robotId: string): Promise<void> {
  await q('DELETE FROM robot_email_accounts WHERE robot_id = $1', [robotId]);
}
