import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Robot, RobotCommander, RobotDraftChannel, RobotTask } from '../../../shared/types';
import { q, qOne } from '../db';
import * as store from '../sessions/store';
import { setupWorkspace, repoDir } from '../sessions/workspace';
import { bus } from '../events/bus';
import * as manager from '../sessions/manager';
import { generateTextM3 } from '../engines/minimax';
import { config } from '../config';
import { sendEmailForRobot } from '../email/client';
import { withSecrets } from './channels/store';
import { ADAPTERS, setCommandHook } from './channels/inbound';
import { createDraft, markDraftStatus } from './store';
import { mintRobotFileToken } from '../routes/robotFiles';
import { AUTO_MODEL } from '../../../shared/types';

/**
 * The COMMANDER BRIDGE — "text the robot on Telegram/WhatsApp/SMS/email → it builds the
 * thing with ArksAI → delivers it directly." Trifecta-safe by construction:
 *
 *  - Only a message from a LISTED COMMANDER (the owner's own addresses, managed in the
 *    console) can start a build or name a delivery destination. Every other sender stays in
 *    the §5c locked-recipient reply lane — an injected "build X and send it to attacker@.."
 *    in a customer message can never reach this code path.
 *  - deliver_to destinations come from the trusted human's OWN message, are recorded on the
 *    task, and every delivery is auditable.
 *  - One running task per robot; a hard wall-clock cap; failures report honestly back to
 *    the commanding channel.
 *
 * Execution reuses the scheduler's exact spawn pattern: a fresh session stamped
 * task:'scheduled' (the unattended-run prompt block: never ask, proceed, deliver) +
 * manager.startRun. The robot poller's tick watches running tasks and delivers on completion.
 */

const TASK_MAX_MS = Number(process.env.ROBOT_TASK_MAX_MS || String(45 * 60_000)) || 45 * 60_000;
const CLASSIFY_TIMEOUT_MS = 30_000;

// ---- commanders ----

function rowToCommander(r: any): RobotCommander {
  return {
    id: r.id,
    robotId: r.robot_id,
    orgId: r.org_id,
    channel: r.channel,
    address: r.address,
    label: r.label ?? null,
    createdAt: Number(r.created_at),
  };
}

export async function listCommanders(robotId: string, orgId?: string): Promise<RobotCommander[]> {
  const rows = await q('SELECT * FROM robot_commanders WHERE robot_id = $1 ORDER BY created_at', [robotId]);
  return rows.map(rowToCommander).filter((c) => orgId == null || c.orgId === orgId);
}

export async function addCommander(
  robotId: string,
  orgId: string,
  channel: RobotDraftChannel,
  address: string,
  label: string | null,
): Promise<RobotCommander> {
  const id = randomUUID();
  await q(
    'INSERT INTO robot_commanders(id, robot_id, org_id, channel, address, label, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, robotId, orgId, channel, address.trim(), label, Date.now()],
  );
  return rowToCommander((await qOne('SELECT * FROM robot_commanders WHERE id = $1', [id]))!);
}

export async function deleteCommander(id: string, orgId: string): Promise<void> {
  await q('DELETE FROM robot_commanders WHERE id = $1 AND org_id = $2', [id, orgId]);
}

export async function isCommander(robotId: string, channel: RobotDraftChannel, address: string): Promise<boolean> {
  const r = await qOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM robot_commanders WHERE robot_id = $1 AND channel = $2 AND LOWER(address) = LOWER($3)',
    [robotId, channel, address.trim()],
  );
  return Number(r?.n ?? 0) > 0;
}

// ---- tasks ----

function parseJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function rowToTask(r: any): RobotTask {
  return {
    id: r.id,
    robotId: r.robot_id,
    orgId: r.org_id,
    channel: r.channel,
    commander: r.commander,
    request: r.request,
    sessionId: r.session_id,
    status: r.status,
    deliverTo: parseJson(r.deliver_to, []),
    artifacts: parseJson(r.artifacts, []),
    error: r.error ?? null,
    createdAt: Number(r.created_at),
    finishedAt: r.finished_at != null ? Number(r.finished_at) : null,
  };
}

export async function listTasks(robotId: string, orgId?: string): Promise<RobotTask[]> {
  const rows = await q('SELECT * FROM robot_tasks WHERE robot_id = $1 ORDER BY created_at DESC LIMIT 50', [robotId]);
  return rows.map(rowToTask).filter((t) => orgId == null || t.orgId === orgId);
}

export async function runningTaskCount(robotId: string): Promise<number> {
  const r = await qOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM robot_tasks WHERE robot_id = $1 AND status IN ('running','delivering')",
    [robotId],
  );
  return Number(r?.n ?? 0);
}

async function markTask(id: string, patch: { status?: string; artifacts?: string[]; error?: string | null; finishedAt?: number }): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (patch.status) {
    sets.push(`status = $${i++}`);
    vals.push(patch.status);
  }
  if (patch.artifacts) {
    sets.push(`artifacts = $${i++}`);
    vals.push(JSON.stringify(patch.artifacts));
  }
  if (patch.error !== undefined) {
    sets.push(`error = $${i++}`);
    vals.push(patch.error);
  }
  if (patch.finishedAt !== undefined) {
    sets.push(`finished_at = $${i++}`);
    vals.push(patch.finishedAt);
  }
  if (!sets.length) return;
  vals.push(id);
  await q(`UPDATE robot_tasks SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

// ---- command classification ----

export interface Command {
  action: 'chat' | 'build';
  mode: 'code' | 'report';
  brief: string;
  deliverTo: { channel: RobotDraftChannel; address: string }[];
}

/** Cheap prefilter: only messages that plausibly ask to CREATE something reach the model. */
export const BUILD_HINT_RE =
  /\b(build|create|make|generate|design|develop|website|web ?site|webapp|web ?app|app|application|landing ?page|report|presentation|deck|slides?|document|doc|pdf|spreadsheet|excel|dashboard|invoice|proposal|brochure|flyer|resume|cv)\b/i;

/** Lenient strict-JSON extraction (models sometimes fence or pad the JSON). */
export function parseCommandJson(raw: string): Command | null {
  if (!raw) return null;
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(s.slice(start, end + 1));
    const action = o.action === 'build' ? 'build' : 'chat';
    const mode = o.mode === 'report' ? 'report' : 'code';
    const brief = typeof o.brief === 'string' ? o.brief.trim() : '';
    const rawTargets = Array.isArray(o.deliver_to) ? o.deliver_to : Array.isArray(o.deliverTo) ? o.deliverTo : [];
    const deliverTo = rawTargets
      .map((t: any) => ({
        channel: ['email', 'whatsapp', 'telegram', 'sms'].includes(t?.channel) ? t.channel : null,
        address: typeof t?.address === 'string' ? t.address.trim() : '',
      }))
      .filter((t: any) => t.channel && t.address) as Command['deliverTo'];
    if (action === 'build' && !brief) return null;
    return { action, mode, brief, deliverTo };
  } catch {
    return null;
  }
}

const CLASSIFY_SYSTEM =
  'You triage a message the OWNER sent to their assistant robot. Decide whether they are asking the ' +
  'robot to BUILD/CREATE a concrete deliverable (a website, web app, document, report, presentation/deck, ' +
  'spreadsheet, PDF, dashboard, flyer…) or just chatting/asking a question.\n' +
  'Respond with STRICT JSON only: {"action":"chat"|"build","mode":"code"|"report",' +
  '"brief":string,"deliver_to":[{"channel":"email"|"whatsapp"|"telegram"|"sms","address":string}]}.\n' +
  '- action="build" ONLY for a concrete creation request; questions, chit-chat, status checks → "chat".\n' +
  '- mode: "report" for a designed PDF report/deck; "code" for everything else (websites, apps, ' +
  'documents, spreadsheets — the builder routes further itself).\n' +
  '- brief: a complete, self-contained instruction for the builder (carry over every requirement, ' +
  'name, language, style and content detail the owner gave — do not summarize away specifics).\n' +
  '- deliver_to: ONLY destinations the owner EXPLICITLY named in this message (an email address, a ' +
  'WhatsApp/phone number). If they named none, return []. Never invent an address.';

/** Classify a commander message. Fail-CLOSED to 'chat' (a build never starts on a guess). */
export async function classifyCommand(text: string, signal: AbortSignal): Promise<Command> {
  const fallback: Command = { action: 'chat', mode: 'code', brief: '', deliverTo: [] };
  if (!BUILD_HINT_RE.test(text)) return fallback;
  if (!config.minimaxApiKey) return fallback;
  try {
    const r = await generateTextM3(`Owner's message:\n"""${text.slice(0, 4000)}"""`, signal, {
      system: CLASSIFY_SYSTEM,
      maxTokens: 800,
    });
    if (!r.ok || !r.text) return fallback;
    return parseCommandJson(r.text) ?? fallback;
  } catch {
    return fallback;
  }
}

// ---- channel-agnostic outbound (ack / progress / delivery text) ----

async function sendOnChannel(robot: Robot, channel: RobotDraftChannel, to: string, text: string): Promise<void> {
  if (channel === 'email') {
    await sendEmailForRobot(robot.id, { to, subject: 'Your robot', text });
    return;
  }
  const ch = await withSecrets(robot.id, channel);
  if (!ch) throw new Error(`${channel} is not connected for this robot`);
  await ADAPTERS[channel].send(ch, to, text);
}

async function sendFileOnChannel(robot: Robot, channel: RobotDraftChannel, to: string, abs: string, caption: string): Promise<void> {
  if (channel === 'email') {
    await sendEmailForRobot(robot.id, {
      to,
      subject: caption || `Your file: ${path.basename(abs)}`,
      text: caption || 'Here is the file you asked for.',
      attachments: [{ filename: path.basename(abs), path: abs }],
    });
    return;
  }
  const ch = await withSecrets(robot.id, channel);
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

// ---- start a task ----

export async function startTask(
  robot: Robot,
  channel: RobotDraftChannel,
  commander: string,
  cmd: Command,
): Promise<RobotTask> {
  const session = await store.createSession({
    repoUrl: null,
    repoName: null,
    branch: null,
    mode: cmd.mode,
    model: AUTO_MODEL, // the orchestrator routes builds exactly as a scheduled run would
    projectId: null,
    orgId: robot.orgId,
    task: 'scheduled', // the unattended-run block: never ask, proceed on assumptions, deliver
  });
  const dateLabel = new Date().toISOString().slice(0, 10);
  await store.updateSession(session.id, { title: `🤖 ${robot.name} · ${dateLabel}`.slice(0, 80) });
  const titled = (await store.getSession(session.id))!;
  bus.emitGlobal({ type: 'session_status', session: titled });
  await setupWorkspace(titled).catch((err) => console.error('[robot-task] workspace:', err));

  const id = randomUUID();
  await q(
    `INSERT INTO robot_tasks(id, robot_id, org_id, channel, commander, request, session_id, status, deliver_to, artifacts, error, created_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8,'[]',NULL,$9,NULL)`,
    [id, robot.id, robot.orgId, channel, commander, cmd.brief.slice(0, 4000), session.id, JSON.stringify(cmd.deliverTo), Date.now()],
  );

  const prompt =
    `${cmd.brief}\n\n` +
    'This build was requested remotely via a robot channel — no user is present to answer questions. ' +
    'Proceed on sensible stated assumptions, build it completely, and finish with the deliverable produced.';
  await store.appendTimeline(session.id, { kind: 'user', id: randomUUID(), text: prompt, ts: Date.now() } as any);
  await manager.startRun(session.id, prompt);
  return rowToTask((await qOne('SELECT * FROM robot_tasks WHERE id = $1', [id]))!);
}

// ---- deliverable collection ----

const DELIVERABLE_EXT = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.zip', '.png', '.mp4']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads', 'ui-kit', 'knowledge', '.arksai']);

/** Files produced by the run (mtime after the task started), newest first, capped. */
export function collectDeliverables(dir: string, sinceMs: number, cap = 5): string[] {
  const found: { abs: string; mtime: number }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs, depth + 1);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!DELIVERABLE_EXT.has(ext)) continue;
      if (/\.preview\.html$/i.test(e.name)) continue;
      try {
        const st = fs.statSync(abs);
        if (st.mtimeMs >= sinceMs && st.size > 0) found.push({ abs, mtime: st.mtimeMs });
      } catch {
        /* raced */
      }
    }
  };
  walk(dir, 0);
  found.sort((a, b) => b.mtime - a.mtime);
  // Collapse duplicates by basename (keep newest) and cap.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of found) {
    const key = path.basename(f.abs).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.abs);
    if (out.length >= cap) break;
  }
  return out;
}

async function publishedUrlFor(sessionId: string): Promise<string | null> {
  try {
    const deployments = await store.listDeployments();
    const mine = deployments
      .filter((d) => d.sessionId === sessionId && d.status !== 'error')
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    if (!mine.length) return null;
    const slug = mine[0].slug;
    return slug ? `${config.publicBaseUrl.replace(/\/$/, '')}/apps/${slug}/` : null;
  } catch {
    return null;
  }
}

// ---- the watcher (poller tick) ----

async function finishTask(task: RobotTask, robot: Robot): Promise<void> {
  await markTask(task.id, { status: 'delivering' });
  const dir = repoDir(task.sessionId);
  const files = collectDeliverables(dir, task.createdAt - 5000);
  const url = await publishedUrlFor(task.sessionId);
  const targets = task.deliverTo.length ? task.deliverTo : [{ channel: task.channel, address: task.commander }];
  const artifacts: string[] = files.map((f) => path.basename(f));
  if (url) artifacts.unshift(url);

  const summary = url
    ? `Done — it's live: ${url}${files.length ? ` (plus ${files.length} file${files.length > 1 ? 's' : ''})` : ''}`
    : files.length
      ? `Done — delivering ${files.length} file${files.length > 1 ? 's' : ''}: ${files.map((f) => path.basename(f)).join(', ')}`
      : 'The build finished, but produced no deliverable file — check the session in ArksAI.';

  let deliveryError: string | null = null;
  for (const t of targets) {
    try {
      await sendOnChannel(robot, t.channel, t.address, summary);
      for (const f of files) {
        await sendFileOnChannel(robot, t.channel, t.address, f, path.basename(f));
      }
    } catch (e: any) {
      deliveryError = `delivery to ${t.channel}:${t.address} failed: ${e?.message ?? e}`;
      console.error(`[robot-task ${task.id}]`, deliveryError);
    }
  }
  // Tell the commander when a third-party delivery failed (they'd otherwise assume it landed).
  if (deliveryError && !(targets.length === 1 && targets[0].address === task.commander && targets[0].channel === task.channel)) {
    await sendOnChannel(robot, task.channel, task.commander, `Heads up — ${deliveryError}`).catch(() => {});
  }
  await markTask(task.id, {
    status: deliveryError && !files.length && !url ? 'error' : 'delivered',
    artifacts,
    error: deliveryError,
    finishedAt: Date.now(),
  });
}

/** Called from the robot poller tick: advance every running task. Never throws. */
export async function watchRobotTasks(getRobotById: (id: string) => Promise<Robot | null>): Promise<void> {
  let rows: any[] = [];
  try {
    rows = await q("SELECT * FROM robot_tasks WHERE status = 'running'");
  } catch {
    return;
  }
  for (const row of rows) {
    const task = rowToTask(row);
    try {
      const robot = await getRobotById(task.robotId);
      if (!robot) {
        await markTask(task.id, { status: 'error', error: 'robot deleted', finishedAt: Date.now() });
        continue;
      }
      const session = await store.getSession(task.sessionId);
      if (!session) {
        await markTask(task.id, { status: 'error', error: 'session missing', finishedAt: Date.now() });
        continue;
      }
      if (session.status === 'running') {
        if (Date.now() - task.createdAt > TASK_MAX_MS) {
          try {
            manager.interrupt(task.sessionId);
          } catch {
            /* already stopped */
          }
          await markTask(task.id, { status: 'error', error: 'timed out', finishedAt: Date.now() });
          await sendOnChannel(robot, task.channel, task.commander,
            'Sorry — that build ran too long and I stopped it. You can open the session in ArksAI to continue it.',
          ).catch(() => {});
        }
        continue;
      }
      if (session.status === 'error') {
        await markTask(task.id, { status: 'error', error: 'build failed', finishedAt: Date.now() });
        await sendOnChannel(robot, task.channel, task.commander,
          'Sorry — the build hit an error and could not finish. The session is saved in ArksAI if you want to look.',
        ).catch(() => {});
        continue;
      }
      // idle / done → collect + deliver.
      await finishTask(task, robot);
    } catch (e: any) {
      console.error(`[robot-task ${task.id}] watch failed:`, e?.message ?? e);
    }
  }
}

// ---- the inbound command lane ----

/**
 * Try to handle an inbound message as a commander build command. Returns true when a build
 * was started (or a helpful command-lane response was sent) — the caller then SKIPS the
 * normal reply lane. Non-commanders and plain chat always return false.
 */
export async function tryCommand(
  robot: Robot,
  channel: RobotDraftChannel,
  from: string,
  fromName: string | null,
  text: string,
  inboundMessageId: string | null,
): Promise<boolean> {
  if (!(await isCommander(robot.id, channel, from))) return false;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLASSIFY_TIMEOUT_MS);
  let cmd: Command;
  try {
    cmd = await classifyCommand(text, ac.signal);
  } finally {
    clearTimeout(timer);
  }
  if (cmd.action !== 'build') return false;

  // Receipt draft (status 'sent'): dedupes the inbound id so an unread email / provider retry
  // can never re-trigger the build, and the console feed shows what the robot did.
  let ack: string;
  // Receipt drafts are marked 'sent' immediately — they're the audit trail of the command
  // lane (and the Message-ID dedupe), not something awaiting approval in Needs You.
  const receipt = async (draftText: string) => {
    const d = await createDraft({
      robotId: robot.id, orgId: robot.orgId, inboundMessageId, inboundFrom: from, inboundName: fromName,
      inboundSubject: null, inboundSnippet: text.slice(0, 160), inboundBody: text, toAddr: from,
      subject: '', draftText, modelUsed: 'command-lane', escalated: false,
      channel: channel === 'email' ? 'email' : channel,
    });
    await markDraftStatus(d.id, robot.orgId, 'sent', Date.now());
  };

  if ((await runningTaskCount(robot.id)) > 0) {
    ack = "I'm still working on your previous build — send this again once it's delivered. (One build at a time.)";
    await sendOnChannel(robot, channel, from, ack).catch(() => {});
    await receipt(ack).catch(() => {});
    return true;
  }

  const task = await startTask(robot, channel, from, cmd);
  const where = cmd.deliverTo.length
    ? cmd.deliverTo.map((t) => `${t.channel} ${t.address}`).join(' + ')
    : 'right here';
  ack = `On it — building that now. I'll deliver it to ${where} when it's done (usually a few minutes).`;
  await sendOnChannel(robot, channel, from, ack).catch((e) => console.error('[robot-task ack]', e?.message ?? e));
  await receipt(`${ack}\n(task ${task.id})`).catch(() => {});
  return true;
}

/** Boot wiring: point the channel inbound handler's command hook at the task lane. */
export function installCommandHook(): void {
  setCommandHook(async (robot, ch, msg) =>
    tryCommand(robot, ch.channel.kind, msg.from, msg.fromName, msg.text, msg.id || null),
  );
}
