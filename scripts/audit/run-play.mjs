#!/usr/bin/env node
/**
 * Deliverable-quality audit harness. Drives ONE department play end-to-end against a
 * locally-running ArksAI server and captures the produced deliverable(s) for inspection.
 *
 *   node scripts/audit/run-play.mjs <task-key> <mode> <model> "<brief>"
 *   e.g. node scripts/audit/run-play.mjs finance.cashflow code arksai-auto "Build a 12-month SaaS cash-flow model."
 *
 * Reuses the public API (create session → send brief → poll status → list + download
 * deliverables) and captures per kind: PDF → mupdf rasterize per page; image → copy;
 * xlsx/docx/csv → /docview HTML screenshot; pptx → its .preview.html; app → screenshot the
 * published /apps/<slug>/ (desktop + mobile). Output lands in scripts/audit/out/<task>/.
 * Egress note: code/report/doc/sheet/compliance plays run on DeepSeek and work here;
 * image/creative + the vision design-gate + M3 (legal/tax) need MiniMax egress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const OUT_ROOT = path.join(ROOT, 'scripts', 'audit', 'out');

const [task, mode = 'code', model = 'arksai-auto', ...briefParts] = process.argv.slice(2);
const brief = briefParts.join(' ');
if (!task || !brief) {
  console.error('usage: run-play.mjs <task-key> <mode> <model> "<brief>"');
  process.exit(1);
}

let cookie = '';
async function api(pathname, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (init.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + pathname, { ...init, headers });
  const setC = res.headers.getSetCookie?.() || [];
  if (setC.length) cookie = setC.map((c) => c.split(';')[0]).join('; ');
  return res;
}

async function login() {
  const pw = (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/APP_PASSWORD=(.+)/) || [])[1]?.trim();
  const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
  if (!res.ok) throw new Error('login failed ' + res.status);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  await login();
  const sess = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ mode, model, task }) })).json();
  console.log(`[${task}] session ${sess.id} (${mode}/${model})`);
  const brief2 = brief + '\n\nInvent any realistic specifics needed and work fully autonomously to a finished, verified result — do not ask me questions.';
  await api(`/api/sessions/${sess.id}/messages`, { method: 'POST', body: JSON.stringify({ text: brief2 }) });

  const started = Date.now();
  const DEADLINE = Number(process.env.AUDIT_DEADLINE_MS || 600_000); // 10 min/play
  let status = 'running';
  while (Date.now() - started < DEADLINE) {
    await sleep(5000);
    const meta = await (await api(`/api/sessions/${sess.id}`)).json().catch(() => null);
    status = meta?.meta?.status ?? status;
    process.stdout.write(`\r[${task}] ${Math.round((Date.now() - started) / 1000)}s status=${status}   `);
    if (status !== 'running') break;
  }
  console.log('');

  const detail = await (await api(`/api/sessions/${sess.id}`)).json();
  const files = (detail.timeline || []).filter((t) => t.kind === 'file').map((t) => ({ path: t.path, name: t.name, size: t.size }));
  const sysLines = (detail.timeline || []).filter((t) => t.kind === 'system').map((t) => t.text);
  const slug = (sysLines.join('\n').match(/\/apps\/([a-z0-9-]+)/i) || [])[1] || null;

  const outDir = path.join(OUT_ROOT, task.replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const res = await api(`/api/sessions/${sess.id}/files/${f.path.split('/').map(encodeURIComponent).join('/')}?inline=1`);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(outDir, path.basename(f.path)), buf);
  }
  const manifest = { task, mode, model, sessionId: sess.id, status, durationMs: Date.now() - started, files, slug, sysLines: sysLines.slice(-12) };
  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[${task}] status=${status} files=${files.map((f) => f.name).join(', ') || '(none)'}${slug ? ` published=/apps/${slug}/` : ''}`);
  console.log(`[${task}] saved → ${path.relative(ROOT, outDir)}`);
  return manifest;
}

run().catch((e) => {
  console.error(`[${task}] ERROR`, e?.message ?? e);
  process.exit(1);
});
