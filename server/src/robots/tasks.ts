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
import { setCommandHook } from './channels/inbound';
import { createDraft, markDraftStatus } from './store';
import { sendOnChannel, sendFileOnChannel } from './outbound';
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
    notify: r.notify == null ? true : !!Number(r.notify),
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
  notify = true,
): Promise<RobotCommander> {
  const id = randomUUID();
  await q(
    'INSERT INTO robot_commanders(id, robot_id, org_id, channel, address, label, notify, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, robotId, orgId, channel, address.trim(), label, notify ? 1 : 0, Date.now()],
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
    revisedAt: r.revised_at != null ? Number(r.revised_at) : null,
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
  action: 'chat' | 'build' | 'revise';
  mode: 'code' | 'report';
  brief: string;
  deliverTo: { channel: RobotDraftChannel; address: string }[];
}

/** Deterministic commander CONTROLS — no model involved, so they always work. */
export const STATUS_RE = /^\s*(status|progress|update|how('?s| is)\s+(it|the|my)\s*(build|task|going)?( going)?)\s*\??\s*$/i;
export const CANCEL_RE = /^\s*(cancel|stop|abort|kill)(\s+(it|that|the\s+build|the\s+task))?\s*[.!]?\s*$/i;

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
    const action = o.action === 'build' ? 'build' : o.action === 'revise' ? 'revise' : 'chat';
    const mode = o.mode === 'report' ? 'report' : 'code';
    const brief = typeof o.brief === 'string' ? o.brief.trim() : '';
    const rawTargets = Array.isArray(o.deliver_to) ? o.deliver_to : Array.isArray(o.deliverTo) ? o.deliverTo : [];
    const deliverTo = rawTargets
      .map((t: any) => ({
        channel: ['email', 'whatsapp', 'telegram', 'sms'].includes(t?.channel) ? t.channel : null,
        address: typeof t?.address === 'string' ? t.address.trim() : '',
      }))
      .filter((t: any) => t.channel && t.address) as Command['deliverTo'];
    if ((action === 'build' || action === 'revise') && !brief) return null;
    return { action, mode, brief, deliverTo };
  } catch {
    return null;
  }
}

const CLASSIFY_SYSTEM =
  'You triage a message the OWNER sent to their assistant robot. Decide whether they are asking the ' +
  'robot to BUILD/CREATE a concrete deliverable (a website, web app, document, report, presentation/deck, ' +
  'spreadsheet, PDF, dashboard, flyer…), to REVISE the thing it recently delivered, or just ' +
  'chatting/asking a question.\n' +
  'Respond with STRICT JSON only: {"action":"chat"|"build"|"revise","mode":"code"|"report",' +
  '"brief":string,"deliver_to":[{"channel":"email"|"whatsapp"|"telegram"|"sms","address":string}]}.\n' +
  '- action="build" ONLY for a concrete NEW creation request; questions, chit-chat, status checks → "chat".\n' +
  '- action="revise" ONLY when a recently delivered build is mentioned below AND the owner is asking to ' +
  'change/fix/adjust THAT thing ("make the header blue", "add a pricing section"). No recent build → never "revise".\n' +
  '- mode: "report" for a designed PDF report/deck; "code" for everything else (websites, apps, ' +
  'documents, spreadsheets — the builder routes further itself).\n' +
  '- brief: a complete, self-contained instruction for the builder (carry over every requirement, ' +
  'name, language, style and content detail the owner gave — do not summarize away specifics).\n' +
  '- deliver_to: ONLY destinations the owner EXPLICITLY named in this message (an email address, a ' +
  'WhatsApp/phone number). If they named none, return []. Never invent an address.';

/** Classify a commander message. Fail-CLOSED to 'chat' (a build never starts on a guess).
 *  `lastDelivered` (a recently delivered task's brief) unlocks the 'revise' action. */
export async function classifyCommand(text: string, signal: AbortSignal, lastDelivered?: string): Promise<Command> {
  const fallback: Command = { action: 'chat', mode: 'code', brief: '', deliverTo: [] };
  if (!BUILD_HINT_RE.test(text) && !(lastDelivered && REVISE_HINT_RE.test(text))) return fallback;
  if (!config.minimaxApiKey) return fallback;
  try {
    const context = lastDelivered
      ? `Recently delivered build (revisable): """${lastDelivered.slice(0, 600)}"""\n\n`
      : 'No recent build exists — "revise" is not available.\n\n';
    const r = await generateTextM3(`${context}Owner's message:\n"""${text.slice(0, 4000)}"""`, signal, {
      system: CLASSIFY_SYSTEM,
      maxTokens: 800,
    });
    if (!r.ok || !r.text) return fallback;
    const cmd = parseCommandJson(r.text) ?? fallback;
    // A 'revise' without a revisable task can't execute — treat as chat (fail closed).
    if (cmd.action === 'revise' && !lastDelivered) return { ...cmd, action: 'chat' };
    return cmd;
  } catch {
    return fallback;
  }
}

/** Loose prefilter for revision phrasing (only consulted when a delivered task exists). */
export const REVISE_HINT_RE =
  /\b(change|revise|adjust|tweak|instead|swap|replace|rename|redo|fix|update|add|remove|bigger|smaller|darker|lighter|blue|red|green|color|colour|title|header|footer|section|page)\b/i;

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

/** Routine-fired tasks have no human commander to message (their targets carry delivery). */
export const isRoutineCommander = (addr: string): boolean => addr.startsWith('routine:');

async function finishTask(task: RobotTask, robot: Robot): Promise<void> {
  await markTask(task.id, { status: 'delivering' });
  const dir = repoDir(task.sessionId);
  // After a revision, deliver only what the revision changed — not the original files again.
  const files = collectDeliverables(dir, (task.revisedAt ?? task.createdAt) - 5000);
  const url = await publishedUrlFor(task.sessionId);
  const targets = task.deliverTo.length
    ? task.deliverTo
    : isRoutineCommander(task.commander)
      ? []
      : [{ channel: task.channel, address: task.commander }];
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
  if (
    deliveryError &&
    !isRoutineCommander(task.commander) &&
    !(targets.length === 1 && targets[0].address === task.commander && targets[0].channel === task.channel)
  ) {
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
        if (Date.now() - (task.revisedAt ?? task.createdAt) > TASK_MAX_MS) {
          try {
            manager.interrupt(task.sessionId);
          } catch {
            /* already stopped */
          }
          await markTask(task.id, { status: 'error', error: 'timed out', finishedAt: Date.now() });
          if (!isRoutineCommander(task.commander))
            await sendOnChannel(robot, task.channel, task.commander,
              'Sorry — that build ran too long and I stopped it. You can open the session in ArksAI to continue it.',
            ).catch(() => {});
        }
        continue;
      }
      if (session.status === 'error') {
        await markTask(task.id, { status: 'error', error: 'build failed', finishedAt: Date.now() });
        if (!isRoutineCommander(task.commander))
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
const REVISABLE_WINDOW_MS = Number(process.env.ROBOT_REVISE_WINDOW_MS || String(6 * 60 * 60_000)) || 6 * 60 * 60_000;

async function latestTask(robotId: string): Promise<RobotTask | null> {
  const r = await qOne('SELECT * FROM robot_tasks WHERE robot_id = $1 ORDER BY created_at DESC LIMIT 1', [robotId]);
  return r ? rowToTask(r) : null;
}

/** The most recent DELIVERED task still inside the revision window. */
async function latestRevisable(robotId: string): Promise<RobotTask | null> {
  const t = await latestTask(robotId);
  if (!t || t.status !== 'delivered') return null;
  const anchor = t.finishedAt ?? t.createdAt;
  return Date.now() - anchor <= REVISABLE_WINDOW_MS ? t : null;
}

function fmtAge(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.round(m / 6) / 10}h`;
}

export async function tryCommand(
  robot: Robot,
  channel: RobotDraftChannel,
  from: string,
  fromName: string | null,
  text: string,
  inboundMessageId: string | null,
): Promise<boolean> {
  if (!(await isCommander(robot.id, channel, from))) return false;

  // Receipt drafts are marked 'sent' immediately — they're the audit trail of the command
  // lane (and the message-id dedupe so an unread email / provider retry can't re-trigger),
  // never something awaiting approval in Needs You.
  const receipt = async (draftText: string) => {
    try {
      const d = await createDraft({
        robotId: robot.id, orgId: robot.orgId, inboundMessageId, inboundFrom: from, inboundName: fromName,
        inboundSubject: null, inboundSnippet: text.slice(0, 160), inboundBody: text, toAddr: from,
        subject: '', draftText, modelUsed: 'command-lane', escalated: false,
        channel: channel === 'email' ? 'email' : channel,
      });
      await markDraftStatus(d.id, robot.orgId, 'sent', Date.now());
    } catch {
      /* audit best-effort */
    }
  };
  const say = async (t: string) => {
    await sendOnChannel(robot, channel, from, t).catch((e) => console.error('[robot-task say]', e?.message ?? e));
    await receipt(t);
  };

  // ---- deterministic CONTROLS (no model — always work) ----
  if (STATUS_RE.test(text)) {
    const t = await latestTask(robot.id);
    if (!t) await say('Nothing is building right now — send me a brief whenever you like.');
    else if (t.status === 'running' || t.status === 'delivering') {
      const since = fmtAge(Date.now() - (t.revisedAt ?? t.createdAt));
      await say(`Still on it — "${t.request.slice(0, 90)}" has been building for ${since}. I'll deliver the moment it's done.`);
    } else if (t.status === 'delivered') {
      await say(`The last build ("${t.request.slice(0, 90)}") was delivered ${fmtAge(Date.now() - (t.finishedAt ?? t.createdAt))} ago${t.artifacts.length ? ` — ${t.artifacts.slice(0, 3).join(', ')}` : ''}. Nothing is running now.`);
    } else {
      await say(`The last build hit a problem (${t.error || 'failed'}) and nothing is running now.`);
    }
    return true;
  }
  if (CANCEL_RE.test(text)) {
    const t = await latestTask(robot.id);
    if (t && (t.status === 'running' || t.status === 'delivering')) {
      try {
        manager.interrupt(t.sessionId);
      } catch {
        /* already stopped */
      }
      await markTask(t.id, { status: 'error', error: 'cancelled by you', finishedAt: Date.now() });
      await say('Cancelled ✓ — I stopped that build.');
    } else {
      await say('Nothing is building right now, so there was nothing to cancel.');
    }
    return true;
  }

  // ---- classify (build / revise / chat) with the revisable-task context ----
  const revisable = await latestRevisable(robot.id);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLASSIFY_TIMEOUT_MS);
  let cmd: Command;
  try {
    cmd = await classifyCommand(text, ac.signal, revisable?.request);
  } finally {
    clearTimeout(timer);
  }
  if (cmd.action !== 'build' && cmd.action !== 'revise') return false;

  if ((await runningTaskCount(robot.id)) > 0) {
    await say("I'm still working on your previous build — send this again once it's delivered. (One build at a time.)");
    return true;
  }

  // ---- revise: re-enter the SAME session, deliver only what changes ----
  if (cmd.action === 'revise' && revisable) {
    const session = await store.getSession(revisable.sessionId).catch(() => null);
    if (session) {
      const now = Date.now();
      await q(
        `UPDATE robot_tasks SET status='running', finished_at=NULL, revised_at=$1, error=NULL,
         deliver_to=$2, request = $3 WHERE id = $4`,
        [
          now,
          JSON.stringify(cmd.deliverTo.length ? cmd.deliverTo : revisable.deliverTo),
          `${revisable.request}\n↻ revision: ${cmd.brief}`.slice(0, 4000),
          revisable.id,
        ],
      );
      const prompt =
        `Revise the build you just delivered: ${cmd.brief}\n\n` +
        'Apply the change with targeted edits (do not rebuild from scratch). This revision was requested ' +
        'remotely — no user is present to answer questions; proceed on sensible assumptions and finish ' +
        'with the updated deliverable produced.';
      await store.appendTimeline(session.id, { kind: 'user', id: randomUUID(), text: prompt, ts: now } as any);
      await manager.startRun(session.id, prompt);
      await say(`On it — revising that now ("${cmd.brief.slice(0, 90)}"). I'll deliver the update when it's done.`);
      return true;
    }
    // The session is gone (cleaned up) — fall through to a fresh build carrying both briefs.
    cmd = { ...cmd, action: 'build', brief: `${revisable.request}\n\nNow with this change: ${cmd.brief}` };
  }

  const task = await startTask(robot, channel, from, cmd);
  const where = cmd.deliverTo.length
    ? cmd.deliverTo.map((t) => `${t.channel} ${t.address}`).join(' + ')
    : 'right here';
  await say(`On it — building that now. I'll deliver it to ${where} when it's done (usually a few minutes). (task ${task.id})`);
  return true;
}

/** Boot wiring: point the channel inbound handler's command hook at the task lane. */
export function installCommandHook(): void {
  setCommandHook(async (robot, ch, msg) =>
    tryCommand(robot, ch.channel.kind, msg.from, msg.fromName, msg.text, msg.id || null),
  );
}
