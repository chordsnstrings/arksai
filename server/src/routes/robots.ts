import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CreateRobotRequest, RobotRole } from '../../../shared/types';
import { roleInOrg } from '../orgs/store';
import {
  addForwardTarget,
  createRobot,
  createRule,
  deleteForwardTarget,
  deleteRobot,
  deleteRule,
  getDraft,
  getRobot,
  isAllowedForwardTarget,
  listDrafts,
  listForwardTargets,
  listRobots,
  listRules,
  markDraftStatus,
  setDraftText,
  snoozeDraft,
  updateRobot,
} from '../robots/store';
import { draftReply, regenerateDraft } from '../robots/reply';
import { pollRobotOnce } from '../robots/poller';
import { sendEmailForRobot, verifyAccount } from '../email/client';
import { detectEmailConfig } from '../email/autoconfig';
import type { InboxMessage } from '../email/client';
import {
  deleteRobotEmailAccount,
  getRobotEmailAccount,
  markRobotVerified,
  robotAccountSecrets,
  upsertRobotEmailAccount,
  type EmailAccount,
} from '../email/accounts';
import {
  deleteChannel,
  listChannels,
  markChannelVerified,
  upsertChannel,
  withSecrets,
} from '../robots/channels/store';
import { ADAPTERS } from '../robots/channels/inbound';
import type { RobotChannelKind } from '../../../shared/types';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  addKbDoc,
  createPersona,
  deleteKbDoc,
  deletePersona,
  listKbDocs,
  listPersonas,
  replyExtrasFor,
  updatePersona,
} from '../robots/personas';
import { extractText } from '../lib/extract';
import { sanitizeFilename } from './upload';
import { addCommander, deleteCommander, listCommanders, listTasks } from '../robots/tasks';
import { deliverDraft } from '../robots/outbound';
import { createJob, deleteJob, listJobs } from '../robots/jobs';
import { deleteAction, listActions, upsertAction } from '../robots/actions';
import { robotStats } from '../robots/analytics';
import { config } from '../config';

/**
 * Robots + drafts API, org-scoped. Any member of the org (or the operator) can manage
 * their org's robots. A draft's recipient is LOCKED at creation to the inbound sender —
 * the send endpoint ignores any client-supplied address and uses the stored to_addr.
 */

const ROLES: RobotRole[] = ['customer_service', 'personal_assistant', 'custom'];
const orgId = (req: FastifyRequest) => (req.params as { id: string }).id;

async function canAccess(req: FastifyRequest, oid: string): Promise<boolean> {
  const id = req.identity;
  if (!id) return false;
  if (id.isSuperadmin) return true;
  return (await roleInOrg(id.userId, oid)) != null;
}

export function registerRobotRoutes(app: FastifyInstance) {
  const guard = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const ok = await canAccess(req, orgId(req));
    if (!ok) reply.code(403).send({ error: 'Not a member of this organization.' });
    return ok;
  };

  // ---- robots ----
  app.get('/api/orgs/:id/robots', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { robots: await listRobots(orgId(req)) };
  });

  app.post('/api/orgs/:id/robots', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as Partial<CreateRobotRequest>) || {};
    if (!b.name || !b.role || !ROLES.includes(b.role)) {
      return reply.code(400).send({ error: 'A name and a valid role are required.' });
    }
    const TYPES = ['email', 'scheduled', 'ads', 'monitor', 'social'];
    const robot = await createRobot(orgId(req), {
      name: String(b.name).slice(0, 80),
      type: b.type && TYPES.includes(b.type) ? b.type : undefined,
      role: b.role,
      model: b.model,
      autonomy: b.autonomy,
      config: b.config,
    });
    return { robot };
  });

  app.get('/api/orgs/:id/robots/:rid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { robot };
  });

  app.put('/api/orgs/:id/robots/:rid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as any) || {};
    const robot = await updateRobot((req.params as any).rid, orgId(req), {
      name: b.name,
      role: b.role,
      status: b.status,
      autonomy: b.autonomy,
      model: b.model,
      config: b.config,
    });
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { robot };
  });

  app.delete('/api/orgs/:id/robots/:rid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteRobot((req.params as any).rid, orgId(req));
    return { ok: true };
  });

  // ---- per-robot mailbox (each robot is its own email identity) ----
  app.get('/api/orgs/:id/robots/:rid/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { account: await getRobotEmailAccount(robot.id) };
  });

  app.put('/api/orgs/:id/robots/:rid/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    if (!b.fromEmail || !b.smtpHost) {
      return reply.code(400).send({ error: 'A from address and an SMTP host are required.' });
    }
    const account = await upsertRobotEmailAccount(robot.id, orgId(req), {
      fromName: b.fromName ?? null,
      fromEmail: String(b.fromEmail).trim(),
      smtpHost: String(b.smtpHost).trim(),
      smtpPort: Number(b.smtpPort) || 587,
      smtpSecure: !!b.smtpSecure,
      smtpUser: b.smtpUser ?? null,
      smtpPass: b.smtpPass ?? null,
      imapHost: b.imapHost ? String(b.imapHost).trim() : null,
      imapPort: Number(b.imapPort) || 993,
      imapSecure: b.imapSecure !== false,
      imapUser: b.imapUser ?? null,
      imapPass: b.imapPass ?? null,
      enabled: b.enabled !== false,
      autoReply: !!b.autoReply,
    });
    return { account };
  });

  app.post('/api/orgs/:id/robots/:rid/email/autoconfig', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const email = String(((req.body as any) || {}).email || '').trim();
    if (!email.includes('@')) return reply.code(400).send({ error: 'A valid email address is required.' });
    return { config: await detectEmailConfig(email) };
  });

  app.post('/api/orgs/:id/robots/:rid/email/test', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    if (!b.smtpHost || !b.fromEmail) {
      return reply.code(400).send({ error: 'A from address and an SMTP host are required to test.' });
    }
    const stored = await robotAccountSecrets(robot.id);
    const account: EmailAccount = {
      orgId: orgId(req), robotId: robot.id,
      fromName: b.fromName ?? null, fromEmail: String(b.fromEmail).trim(),
      smtpHost: String(b.smtpHost).trim(), smtpPort: Number(b.smtpPort) || 587, smtpSecure: !!b.smtpSecure,
      smtpUser: b.smtpUser ?? null,
      imapHost: b.imapHost ? String(b.imapHost).trim() : null, imapPort: Number(b.imapPort) || 993,
      imapSecure: b.imapSecure !== false, imapUser: b.imapUser ?? null,
      enabled: true, autoReply: !!b.autoReply, verifiedAt: null,
      hasSmtpPass: !!(b.smtpPass || stored.smtpPass), hasImapPass: !!(b.imapPass || stored.imapPass),
      updatedAt: Date.now(),
    };
    const secrets = { smtpPass: b.smtpPass || stored.smtpPass, imapPass: b.imapPass || stored.imapPass };
    const result = await verifyAccount(account, secrets);
    if (result.smtp.ok && (result.imap.ok || result.imap.skipped)) await markRobotVerified(robot.id).catch(() => {});
    return { result };
  });

  app.delete('/api/orgs/:id/robots/:rid/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    await deleteRobotEmailAccount(robot.id);
    return { ok: true };
  });

  // ---- per-robot messaging channels (telegram / whatsapp / sms) ----
  const CHANNEL_KINDS: RobotChannelKind[] = ['telegram', 'whatsapp', 'sms'];
  const channelKind = (req: FastifyRequest): RobotChannelKind | null => {
    const k = (req.params as any).kind;
    return CHANNEL_KINDS.includes(k) ? (k as RobotChannelKind) : null;
  };

  app.get('/api/orgs/:id/robots/:rid/channels', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { channels: await listChannels(robot.id, orgId(req)) };
  });

  // Connect/update a channel. Secrets are WRITE-ONLY: an omitted/empty secret keeps the
  // stored value; reads never return them. Kind-specific required fields are validated here.
  app.put('/api/orgs/:id/robots/:rid/channels/:kind', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const kind = channelKind(req);
    if (!kind) return reply.code(400).send({ error: 'Unknown channel kind.' });
    const b = (req.body as any) || {};
    const secrets: Record<string, string> = {};
    const meta: Record<string, string> = {};
    if (kind === 'telegram') {
      if (b.botToken) secrets.botToken = String(b.botToken);
    } else if (kind === 'whatsapp') {
      if (b.accessToken) secrets.accessToken = String(b.accessToken);
      if (b.appSecret) secrets.appSecret = String(b.appSecret);
      if (b.phoneNumberId) meta.phoneNumberId = String(b.phoneNumberId).trim();
      if (b.verifyToken) meta.verifyToken = String(b.verifyToken).trim();
    } else if (kind === 'meta') {
      if (b.pageAccessToken) secrets.pageAccessToken = String(b.pageAccessToken);
      if (b.appSecret) secrets.appSecret = String(b.appSecret);
      if (b.pageId) meta.pageId = String(b.pageId).trim();
      if (b.igUserId) meta.igUserId = String(b.igUserId).trim();
      if (b.pageName) meta.pageName = String(b.pageName).trim();
      if (b.verifyToken) meta.verifyToken = String(b.verifyToken).trim();
    } else {
      if (b.apiId) secrets.apiId = String(b.apiId);
      if (b.apiPassword) secrets.apiPassword = String(b.apiPassword);
      if (b.senderId) meta.senderId = String(b.senderId).trim();
      if (b.channelNumber) meta.channelNumber = String(b.channelNumber).trim();
      meta.provider = 'smsala';
    }
    const existing = (await listChannels(robot.id)).find((c) => c.kind === kind);
    // SMS + WhatsApp inbound arrive on PUBLIC webhook routes — a per-channel random key in
    // the URL is the gate (SMSALA signs nothing). Minted once, shown in the console.
    if (!existing?.meta?.hookKey) meta.hookKey = randomBytes(18).toString('base64url');
    const channel = await upsertChannel(robot.id, orgId(req), kind, {
      label: b.label !== undefined ? (b.label ? String(b.label) : null) : undefined,
      secrets,
      meta,
      enabled: b.enabled !== false,
    });
    return { channel };
  });

  // Test the channel's credentials live (getMe / graph / balance) and stamp verified.
  app.post('/api/orgs/:id/robots/:rid/channels/:kind/test', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const kind = channelKind(req);
    if (!kind) return reply.code(400).send({ error: 'Unknown channel kind.' });
    const ch = await withSecrets(robot.id, kind);
    if (!ch) return reply.code(404).send({ error: 'That channel is not connected yet.' });
    const adapter = ADAPTERS[kind];
    if (!adapter) return reply.code(400).send({ error: 'That channel type is not available yet.' });
    const result = await adapter.verify(ch);
    if (result.ok) await markChannelVerified(robot.id, kind).catch(() => {});
    return { result };
  });

  app.delete('/api/orgs/:id/robots/:rid/channels/:kind', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const kind = channelKind(req);
    if (!kind) return reply.code(400).send({ error: 'Unknown channel kind.' });
    await deleteChannel(robot.id, orgId(req), kind);
    return { ok: true };
  });

  // ---- commanders (the owner's own addresses that may issue build commands) ----
  const DRAFT_CHANNELS = ['email', 'telegram', 'whatsapp', 'sms'];
  app.get('/api/orgs/:id/robots/:rid/commanders', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { commanders: await listCommanders(robot.id, orgId(req)) };
  });
  app.post('/api/orgs/:id/robots/:rid/commanders', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    const channel = String(b.channel ?? '').trim();
    const address = String(b.address ?? '').trim();
    if (!DRAFT_CHANNELS.includes(channel) || !address) {
      return reply.code(400).send({ error: 'A commander needs a channel (email/telegram/whatsapp/sms) and an address.' });
    }
    const commander = await addCommander(
      robot.id,
      orgId(req),
      channel as any,
      address,
      b.label ? String(b.label) : null,
      b.notify !== false,
    );
    return { commander };
  });
  app.delete('/api/orgs/:id/robots/:rid/commanders/:cid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteCommander((req.params as any).cid, orgId(req));
    return { ok: true };
  });

  // ---- build tasks the robot ran on command (audit feed) ----
  app.get('/api/orgs/:id/robots/:rid/tasks', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { tasks: await listTasks(robot.id, orgId(req)) };
  });

  // ---- proactive routines (digest / scheduled brief) ----
  app.get('/api/orgs/:id/robots/:rid/jobs', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { jobs: await listJobs(robot.id, orgId(req)) };
  });
  app.post('/api/orgs/:id/robots/:rid/jobs', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    const kind = b.kind === 'brief' ? 'brief' : b.kind === 'digest' ? 'digest' : null;
    const atTime = String(b.atTime ?? '').trim();
    if (!kind || !/^\d{1,2}:\d{2}$/.test(atTime)) {
      return reply.code(400).send({ error: 'A routine needs a kind (digest/brief) and a time (HH:MM).' });
    }
    if (kind === 'brief' && !String(b.prompt ?? '').trim()) {
      return reply.code(400).send({ error: 'A scheduled brief needs the build instruction.' });
    }
    const job = await createJob(robot.id, orgId(req), {
      kind,
      cadence: b.cadence === 'weekly' ? 'weekly' : 'daily',
      atTime,
      weekday: b.cadence === 'weekly' ? Math.min(6, Math.max(0, Number(b.weekday) || 0)) : null,
      tz: b.tz ? String(b.tz) : null,
      prompt: b.prompt ? String(b.prompt).slice(0, 4000) : null,
      deliverTo: Array.isArray(b.deliverTo) ? b.deliverTo : [],
    });
    return { job };
  });
  app.delete('/api/orgs/:id/robots/:rid/jobs/:jobId', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteJob((req.params as any).jobId, orgId(req));
    return { ok: true };
  });

  // ---- gated actions (org-defined HTTPS lookups) ----
  app.get('/api/orgs/:id/robots/:rid/actions', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { actions: await listActions(robot.id, orgId(req)) };
  });
  app.put('/api/orgs/:id/robots/:rid/actions', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    try {
      const action = await upsertAction(robot.id, orgId(req), {
        name: String(b.name ?? ''),
        description: String(b.description ?? ''),
        method: b.method === 'POST' ? 'POST' : 'GET',
        urlTemplate: String(b.urlTemplate ?? ''),
        headers: b.headers && typeof b.headers === 'object' ? b.headers : undefined,
        params: Array.isArray(b.params) ? b.params : [],
        bodyTemplate: b.bodyTemplate ? String(b.bodyTemplate) : null,
        mode: b.mode === 'auto' ? 'auto' : 'ask',
        enabled: b.enabled !== false,
      });
      return { action };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message ?? String(e) });
    }
  });
  app.delete('/api/orgs/:id/robots/:rid/actions/:actionId', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteAction((req.params as any).actionId, orgId(req));
    return { ok: true };
  });

  // ---- per-robot performance stats (metadata only) ----
  app.get('/api/orgs/:id/robots/:rid/stats', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { stats: await robotStats(robot.id) };
  });

  // ---- personas (org-level, reusable voices) ----
  app.get('/api/orgs/:id/personas', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { personas: await listPersonas(orgId(req)) };
  });
  app.post('/api/orgs/:id/personas', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as any) || {};
    const name = String(b.name ?? '').trim();
    const voice = String(b.voice ?? '').trim();
    if (!name || !voice) return reply.code(400).send({ error: 'A persona needs a name and its voice/tone text.' });
    const persona = await createPersona(orgId(req), {
      name,
      voice,
      description: b.description ? String(b.description) : null,
      language: b.language ? String(b.language) : null,
      signature: b.signature ? String(b.signature) : null,
    });
    return { persona };
  });
  app.put('/api/orgs/:id/personas/:pid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as any) || {};
    const persona = await updatePersona((req.params as any).pid, orgId(req), {
      name: b.name != null ? String(b.name) : undefined,
      voice: b.voice != null ? String(b.voice) : undefined,
      description: b.description !== undefined ? (b.description ? String(b.description) : null) : undefined,
      language: b.language !== undefined ? (b.language ? String(b.language) : null) : undefined,
      signature: b.signature !== undefined ? (b.signature ? String(b.signature) : null) : undefined,
    });
    if (!persona) return reply.code(404).send({ error: 'Unknown persona.' });
    return { persona };
  });
  app.delete('/api/orgs/:id/personas/:pid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deletePersona((req.params as any).pid, orgId(req));
    return { ok: true };
  });

  // ---- per-robot knowledge base ----
  app.get('/api/orgs/:id/robots/:rid/kb', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { docs: await listKbDocs(robot.id, orgId(req)) };
  });

  // Add knowledge: JSON {name, text} for pasted text, OR multipart file upload
  // (txt/md/csv/pdf/docx — extracted server-side).
  app.post('/api/orgs/:id/robots/:rid/kb', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    try {
      if (req.isMultipart?.()) {
        const added: any[] = [];
        for await (const part of (req as any).files()) {
          const safe = sanitizeFilename(part.filename);
          const tmp = path.join(os.tmpdir(), `kb-${Date.now()}-${safe}`);
          await pipeline(part.file, fs.createWriteStream(tmp));
          try {
            const ext = path.extname(safe).toLowerCase();
            let text: string | null = null;
            if (['.txt', '.md', '.csv'].includes(ext)) text = fs.readFileSync(tmp, 'utf8');
            else text = await extractText(tmp);
            if (!text || text.startsWith('[extraction failed')) {
              return reply.code(400).send({ error: `Could not read ${safe} — upload txt/md/csv/pdf/docx or paste the text.` });
            }
            added.push(await addKbDoc(robot.id, orgId(req), safe, text));
          } finally {
            fs.rmSync(tmp, { force: true });
          }
        }
        if (!added.length) return reply.code(400).send({ error: 'No files received.' });
        return { docs: added };
      }
      const b = (req.body as any) || {};
      const name = String(b.name ?? '').trim() || 'Pasted notes';
      const text = String(b.text ?? '').trim();
      if (!text) return reply.code(400).send({ error: 'Provide the knowledge text (or upload a file).' });
      return { docs: [await addKbDoc(robot.id, orgId(req), name, text)] };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message ?? String(e) });
    }
  });

  app.delete('/api/orgs/:id/robots/:rid/kb/:docId', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteKbDoc((req.params as any).docId, orgId(req));
    return { ok: true };
  });

  // Generate a draft from a SAMPLE inbound message — onboarding preview + the
  // M3-vs-DeepSeek bake-off, without waiting for real mail to arrive.
  app.post('/api/orgs/:id/robots/:rid/preview', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    const sample: InboxMessage = {
      uid: 0, seq: 0,
      from: String(b.from || 'sample@customer.com'),
      fromName: String(b.fromName || 'Sample Sender'),
      to: '', messageId: '', date: new Date().toISOString(),
      subject: String(b.subject || 'A question'),
      snippet: '', text: String(b.body || b.text || ''),
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const extras = await replyExtrasFor(robot, orgId(req), sample.text || '').catch(() => ({}));
      const outcome = await draftReply(robot, sample, ac.signal, undefined, extras);
      return { outcome };
    } catch (e: any) {
      return reply.code(502).send({ error: `Draft failed: ${e?.message ?? e}` });
    } finally {
      clearTimeout(timer);
    }
  });

  // Check the inbox NOW (don't wait for the 60s tick). Runs one poll pass and reports
  // exactly what happened — read N, drafted N, sent N, or the real error — so a robot
  // that "watches" but stays quiet is diagnosable and the user has manual control.
  app.post('/api/orgs/:id/robots/:rid/poll', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    if (robot.status !== 'active') return reply.code(400).send({ error: 'Activate the robot first — only active robots check their inbox.' });
    return { summary: await pollRobotOnce(robot) };
  });

  // ---- drafts ----
  app.get('/api/orgs/:id/drafts', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const status = (req.query as any)?.status;
    const robotId = (req.query as any)?.robotId;
    return { drafts: await listDrafts(orgId(req), robotId, status) };
  });

  app.put('/api/orgs/:id/drafts/:did', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const text = String((req.body as any)?.text ?? '');
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    await setDraftText(draft.id, orgId(req), text);
    return { ok: true };
  });

  // Approve & send. Recipient + subject come from the STORED draft (locked), never
  // from the request body — only the (optionally edited) text is taken from the client.
  // Dispatches by the draft's channel: email → SMTP, chat/SMS → the channel adapter.
  app.post('/api/orgs/:id/drafts/:did/send', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    if (draft.status === 'sent') return reply.code(409).send({ error: 'Already sent.' });
    const text = String((req.body as any)?.text ?? draft.draftText);
    try {
      await deliverDraft(draft, text); // locked recipient + channel dispatch + ics attach + marks sent
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: `Send failed: ${e?.message ?? e}` });
    }
  });

  app.post('/api/orgs/:id/drafts/:did/dismiss', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    await markDraftStatus(draft.id, orgId(req), 'dismissed');
    return { ok: true };
  });

  // ---- learned rules (the learning loop) ----
  app.get('/api/orgs/:id/robots/:rid/rules', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { rules: await listRules(orgId(req), (req.params as any).rid) };
  });
  app.post('/api/orgs/:id/robots/:rid/rules', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const rid = (req.params as any).rid;
    const robot = await getRobot(rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const pattern = String((req.body as any)?.pattern ?? '').trim();
    const instruction = String((req.body as any)?.instruction ?? '').trim();
    if (!pattern || !instruction) return reply.code(400).send({ error: 'A rule needs a pattern and an instruction.' });
    return { rule: await createRule(orgId(req), rid, pattern, instruction) };
  });
  app.delete('/api/orgs/:id/robots/:rid/rules/:ruleId', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteRule(orgId(req), (req.params as any).ruleId);
    return { ok: true };
  });

  // Snooze a draft → it leaves "needs you" and returns at `until` (poller wakes it).
  app.post('/api/orgs/:id/drafts/:did/snooze', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    const until = Number((req.body as any)?.until);
    if (!Number.isFinite(until) || until <= Date.now()) return reply.code(400).send({ error: 'Pick a future time.' });
    await snoozeDraft(draft.id, orgId(req), until);
    return { ok: true };
  });

  // Archive a draft → acknowledged, no reply.
  app.post('/api/orgs/:id/drafts/:did/archive', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    await markDraftStatus(draft.id, orgId(req), 'archived');
    return { ok: true };
  });

  // Forward the inbound to an ADMIN-ALLOWLISTED teammate (the one case the recipient-lock is
  // broken — gated to the allowlist, never a free-form address).
  app.post('/api/orgs/:id/drafts/:did/forward', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    const to = String((req.body as any)?.to ?? '').trim();
    const note = String((req.body as any)?.note ?? '').trim();
    if (!to || !(await isAllowedForwardTarget(orgId(req), to))) {
      return reply.code(403).send({ error: 'That address is not on the forward allowlist.' });
    }
    try {
      const body =
        `${note ? note + '\n\n' : ''}--- Forwarded by ${draft.robotId ? 'your robot' : 'ArksAI'} ---\n` +
        `From: ${draft.inboundName ? `${draft.inboundName} <${draft.inboundFrom}>` : draft.inboundFrom}\n` +
        `Subject: ${draft.inboundSubject || '(no subject)'}\n\n${draft.inboundBody || draft.inboundSnippet || ''}`;
      await sendEmailForRobot(draft.robotId, { to, subject: `Fwd: ${draft.inboundSubject || '(no subject)'}`, text: body });
      await markDraftStatus(draft.id, orgId(req), 'dismissed');
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: `Forward failed: ${e?.message ?? e}` });
    }
  });

  // Forward allowlist (org-level; admin-managed).
  app.get('/api/orgs/:id/robot-forward-targets', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { targets: await listForwardTargets(orgId(req)) };
  });
  app.post('/api/orgs/:id/robot-forward-targets', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const email = String((req.body as any)?.email ?? '').trim();
    const label = String((req.body as any)?.label ?? '').trim() || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'Enter a valid email address.' });
    return { target: await addForwardTarget(orgId(req), email, label) };
  });
  app.delete('/api/orgs/:id/robot-forward-targets/:tid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteForwardTarget(orgId(req), (req.params as any).tid);
    return { ok: true };
  });

  // Re-draft a reply from the human's one-line direction (the responder's intent box / chips).
  // Returns the new text + saves it on the draft; the recipient stays locked.
  app.post('/api/orgs/:id/drafts/:did/regenerate', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const instruction = String((req.body as any)?.instruction ?? '').trim();
    if (!instruction) return reply.code(400).send({ error: 'Tell me how to respond.' });
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    const robot = await getRobot(draft.robotId, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const out = await regenerateDraft(robot, draft, instruction, ac.signal);
      if (!out.text) return reply.code(502).send({ error: out.reason || 'Could not draft a reply.' });
      await setDraftText(draft.id, orgId(req), out.text);
      return { text: out.text, model: out.model };
    } catch (e: any) {
      return reply.code(502).send({ error: `Draft failed: ${e?.message ?? e}` });
    } finally {
      clearTimeout(timer);
    }
  });

  // ═══════════ Social bots: managed campaigns (Campaign bot) + ads reports (Report bot) ═══════════

  // List managed campaigns (with the last optimise note surfaced for the monitor).
  app.get('/api/orgs/:id/robots/:rid/campaigns', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const { listCampaignRecords } = await import('../robots/socialCampaigns');
    const campaigns = await listCampaignRecords(orgId(req));
    return { campaigns };
  });

  // Campaign detail: record + ads + this campaign's recent leads.
  app.get('/api/orgs/:id/robots/:rid/campaigns/:cid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const { getCampaignRecord, listCampaignAds, listLeads } = await import('../robots/socialCampaigns');
    const campaign = await getCampaignRecord((req.params as any).cid);
    if (!campaign || campaign.orgId !== orgId(req)) return reply.code(404).send({ error: 'Unknown campaign.' });
    const ads = await listCampaignAds(campaign.id);
    const leads = (await listLeads(orgId(req), 50)).filter((l) => l.campaignId === campaign.id);
    return { campaign, ads, leads };
  });

  // The brief's live "brain line": classify the vertical, price it for the chosen countries,
  // and prefer the account's OWN results over any industry estimate. Pure + fast — the client
  // calls it per debounce while the user types.
  app.post('/api/orgs/:id/robots/:rid/campaigns/classify-preview', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as any) || {};
    const { classifyVertical, verticalById, adjustedBenchmark, suggestTargetCpr, targetAmbition } = await import('../agent/social/verticals');
    const detected = classifyVertical(String(b.product ?? ''), Array.isArray(b.topics) ? b.topics.map(String) : []);
    const profile = b.vertical_override ? verticalById(String(b.vertical_override)) : detected.profile;
    const countries: string[] = Array.isArray(b.countries) ? b.countries.map(String) : [];
    // Own history: the most recent campaign in this vertical that actually measured a cost.
    const { listCampaignRecords } = await import('../robots/socialCampaigns');
    const past = (await listCampaignRecords(orgId(req)))
      .filter((c) => c.brief?.vertical === profile.id && typeof (c.funnel as any)?.lastCprUsd === 'number')
      .sort((a, c) => c.updatedAt - a.updatedAt);
    const ownCpr = past.length ? Number((past[0].funnel as any).lastCprUsd) : null;
    const benchmark = adjustedBenchmark(profile, countries, ownCpr);
    const complianceNote = profile.compliance.specialCategory
      ? `This counts as a ${profile.compliance.specialCategory.toLowerCase()} ad — Meta limits age and location targeting for fairness. The robot files it correctly; your age range widens automatically.`
      : profile.compliance.healthRules
        ? 'Health-related ads run 18+ only, and the robot keeps every line positive — Meta bans copy that plays on insecurities.'
        : undefined;
    const target = typeof b.target_cpr_usd === 'number' && b.target_cpr_usd > 0 ? b.target_cpr_usd : null;
    return {
      verticalId: profile.id,
      label: profile.label,
      confidence: b.vertical_override ? 1 : detected.confidence,
      benchmark,
      suggestedTargetUsd: suggestTargetCpr(benchmark),
      targetAmbition: target ? targetAmbition(target, benchmark) : 'ok',
      complianceNote,
      styleResolved: profile.visualStyle,
    };
  });

  // Create + run the campaign bot. Validation is synchronous (the form shows exact fixes);
  // the multi-minute setup (creative generation → assemble → launch decision) runs in the
  // background — the monitor polls the list for status.
  app.post('/api/orgs/:id/robots/:rid/campaigns', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    const { validateCampaignInput, setupManagedCampaign } = await import('../robots/socialCampaigns');
    const { autonomyLevelOf } = await import('../robots/autonomy');
    const { capsFromConfig } = await import('../robots/campaigns');
    const brief = {
      product: String(b.product ?? ''),
      topics: Array.isArray(b.topics) ? b.topics.map(String) : [],
      cta: b.cta ? String(b.cta) : undefined,
      destination: b.destination ? String(b.destination) : undefined,
      audience: b.audience && typeof b.audience === 'object' ? b.audience : undefined,
      imageCount: b.image_count ? Number(b.image_count) : 30,
      brand: b.brand && typeof b.brand === 'object' ? b.brand : undefined,
      vertical: b.vertical ? String(b.vertical) : undefined,
      targetCprUsd: typeof b.target_cpr_usd === 'number' && b.target_cpr_usd > 0 ? Number(b.target_cpr_usd) : undefined,
      offerEndsAt: undefined as number | undefined,
      limitedCount: typeof b.limited_count === 'number' && b.limited_count > 0 ? Math.floor(b.limited_count) : undefined,
      limitedUnit: b.limited_unit ? String(b.limited_unit).slice(0, 20) : undefined,
    };
    // Truthful-scarcity grounding: a stated offer end must be a real FUTURE date.
    if (b.offer_ends_at) {
      const ts = Date.parse(String(b.offer_ends_at));
      if (!Number.isFinite(ts)) return reply.code(400).send({ error: 'The offer end date is not a valid date.' });
      if (ts <= Date.now()) return reply.code(400).send({ error: 'The offer end date is in the past — urgency must be true.' });
      brief.offerEndsAt = ts;
    }
    // Remember the confirmed business type as this robot's default (pre-fills the next brief).
    if (brief.vertical && brief.vertical !== (robot.config as any)?.defaultVertical) {
      await updateRobot(robot.id, orgId(req), { config: { ...(robot.config as any), defaultVertical: brief.vertical } }).catch(() => {});
    }
    const budgetModel = b.budget_model === 'lifetime' ? ('lifetime' as const) : ('daily' as const);
    const input = {
      brief, objective: String(b.objective ?? 'leads') as any, budgetModel,
      budgetUsd: Number(b.budget_usd) || 0,
      durationDays: b.duration_days ? Number(b.duration_days) : undefined,
    };
    const errs = validateCampaignInput(input);
    if (errs.length) return reply.code(400).send({ error: errs.join(' ') });
    const caps = capsFromConfig(robot.config as any);
    const level = typeof b.autonomy_level === 'number' ? Number(b.autonomy_level) : autonomyLevelOf(robot.config as any);
    const mediaDir = path.join(config.dataDir, 'campaign-media', orgId(req));
    fs.mkdirSync(path.join(mediaDir, 'images'), { recursive: true });
    // Fire-and-forget: the setup loop persists its own state (generating → pending/active/failed).
    void setupManagedCampaign(
      {
        orgId: orgId(req), robotId: robot.id, name: String(b.name || brief.product || 'Campaign'),
        ...input,
        engageSpecifics: b.engage_say || b.engage_do_not_say || b.engage_escalate_if
          ? { say: b.engage_say, doNotSay: b.engage_do_not_say, escalateIf: b.engage_escalate_if }
          : null,
        autonomyLevel: level, adDailyCapUsd: caps.dailyCapUsd,
        generationCapUsd: b.generation_cap_usd ? Number(b.generation_cap_usd) : 3,
        // Robot-level Ad style + hidden expert overrides (config keys, no UI).
        plan: {
          voice: (robot.config as any)?.adVoice ?? 'auto',
          casualMix: (robot.config as any)?.adCasualMix !== false,
          hookWeights: (robot.config as any)?.hookWeights ?? undefined,
          frame: (robot.config as any)?.adFrame ?? undefined,
        },
        onProgress: (line) => console.log(`[campaign-bot ${robot.id}] ${line}`),
      },
      mediaDir,
    ).then((r) => console.log(`[campaign-bot ${robot.id}] setup: ${r.detail}`))
      .catch((e) => console.error(`[campaign-bot ${robot.id}] setup crashed:`, e?.message ?? e));
    return { ok: true, started: true };
  });

  app.post('/api/orgs/:id/robots/:rid/campaigns/:cid/approve', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const { getCampaignRecord, launchManagedCampaign } = await import('../robots/socialCampaigns');
    const rec = await getCampaignRecord((req.params as any).cid);
    if (!rec || rec.orgId !== orgId(req)) return reply.code(404).send({ error: 'Unknown campaign.' });
    const r = await launchManagedCampaign(rec.id, req.identity?.userId ?? 'owner');
    if (!r.ok) return reply.code(400).send({ error: r.detail });
    return { ok: true, detail: r.detail };
  });

  app.post('/api/orgs/:id/robots/:rid/campaigns/:cid/pause', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const { getCampaignRecord, pauseManagedCampaign } = await import('../robots/socialCampaigns');
    const rec = await getCampaignRecord((req.params as any).cid);
    if (!rec || rec.orgId !== orgId(req)) return reply.code(404).send({ error: 'Unknown campaign.' });
    const r = await pauseManagedCampaign(rec.id, String((req.body as any)?.reason ?? 'owner request'));
    if (!r.ok) return reply.code(400).send({ error: r.detail });
    return { ok: true, detail: r.detail };
  });

  // ---- Report bot: ads_report jobs on this robot ----
  app.get('/api/orgs/:id/robots/:rid/reports', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const { listJobs } = await import('../robots/jobs');
    const jobs = (await listJobs((req.params as any).rid, orgId(req))).filter((j) => j.kind === 'ads_report');
    return { jobs };
  });

  app.post('/api/orgs/:id/robots/:rid/reports', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    const recipients: string[] = Array.isArray(b.recipients) ? b.recipients.map(String).filter(Boolean) : [];
    if (!recipients.length) return reply.code(400).send({ error: 'Add at least one recipient email.' });
    const cadence = ['daily', 'weekly', 'monthly'].includes(b.cadence) ? b.cadence : 'weekly';
    const { createJob } = await import('../robots/jobs');
    const job = await createJob(robot.id, orgId(req), {
      kind: 'ads_report', cadence, atTime: String(b.at_time || '09:00'),
      weekday: b.weekday != null ? Number(b.weekday) : undefined,
      tz: b.tz ? String(b.tz) : undefined,
      prompt: JSON.stringify({ accountId: b.account_id || undefined, scope: b.scope || 'account+campaign' }),
      deliverTo: recipients.map((address) => ({ channel: 'email' as const, address })),
    });
    return { job };
  });

  app.delete('/api/orgs/:id/robots/:rid/reports/:jid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const { deleteJob } = await import('../robots/jobs');
    await deleteJob((req.params as any).jid, orgId(req));
    return { ok: true };
  });

  // "Send me one now" — run the report immediately (validates the whole pipeline live).
  app.post('/api/orgs/:id/robots/:rid/reports/run-now', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    const recipients: string[] = Array.isArray(b.recipients) ? b.recipients.map(String).filter(Boolean) : [];
    if (!recipients.length) return reply.code(400).send({ error: 'Add at least one recipient email.' });
    const { runAdsReport } = await import('../robots/socialReport');
    const r = await runAdsReport(robot, { accountId: b.account_id || undefined }, recipients);
    if (!r.ok) return reply.code(400).send({ error: r.detail });
    return { ok: true, detail: r.detail };
  });
}
