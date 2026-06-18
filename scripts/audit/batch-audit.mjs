// Exhaustive catalog audit — runs ALL plays end-to-end against a locally-running ArksAI
// server, captures + structurally grades each, and writes results incrementally so an
// interruption never loses progress. Self-contained: it reads the play catalog straight
// from client/src/lib/departments.ts.
//
//   1) build + boot a server (see COMPREHENSIVE_TEST.md), then:
//   2) CONC=2 AUDIT_BASE=http://localhost:3200 node scripts/audit/batch-audit.mjs
//
// Model routing: legal.* → arksai-max (M2.7, the proven legal model); everything else →
// deepseek-v4-pro (fast; faithfully exercises the generators/prompts/gates without the
// full-M3 latency). Results → scripts/audit/out/_results.json + a printed summary table.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const BASE = process.env.AUDIT_BASE || 'http://localhost:3200';
const CONC = Number(process.env.CONC || 2);            // keep < MAX_CONCURRENT_RUNS (default 3)
const DEADLINE = Number(process.env.AUDIT_DEADLINE_MS || 360_000);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null; // smoke a subset
const RESULTS = path.join(ROOT, 'scripts/audit/out/_results.json');

// ---- read the catalog directly from departments.ts (no build/import needed) ----
function loadCatalog() {
  const s = fs.readFileSync(path.join(ROOT, 'client/src/lib/departments.ts'), 'utf8');
  const re = /key:\s*'([a-z]+\.[a-z_]+)'[\s\S]*?mode:\s*'([a-z]+)'[\s\S]*?prompt:\s*'((?:[^'\\]|\\.)*)'/g;
  const out = []; let m;
  while ((m = re.exec(s))) out.push({ key: m[1], dept: m[1].split('.')[0], mode: m[2], prompt: m[3].replace(/\\(.)/g, '$1') });
  return out;
}

let cookie = '';
async function api(p, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (init.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { ...init, headers });
  const sc = res.headers.getSetCookie?.() || [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return res;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const pw = (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/APP_PASSWORD=(.+)/) || [])[1]?.trim();
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
  if (!r.ok) throw new Error('login failed ' + r.status);
}

// Send the brief; if the server is at its concurrent-run cap (429) or busy (409), wait + retry.
async function send(sid, text) {
  for (let a = 0; a < 20; a++) {
    const r = await api(`/api/sessions/${sid}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
    if (r.status === 202) return true;
    if (r.status === 429 || r.status === 409) { await sleep(6000); continue; }
    return false;
  }
  return false;
}

const DELIV = /\.(pdf|docx|xlsx|csv|pptx|sif|xml|png|jpe?g|svg|html|md)$/i;
function workspaceDeliverables(sessionId) {
  try {
    return fs.readdirSync(path.join(ROOT, 'data/workspaces', sessionId, 'repo'))
      .filter((f) => DELIV.test(f) && !/^(package|tsconfig|\.)/.test(f) && f !== 'arksai-export.zip');
  } catch { return []; }
}
function grade(play, status, files, slug, ws) {
  if (status !== 'done') return { ok: false, why: status };
  const all = [...new Set([...files, ...ws])], has = (re) => all.some((f) => re.test(f));
  if (play.mode === 'report') return has(/\.(pdf|pptx|docx)$/i) ? { ok: true, why: 'doc produced' } : { ok: false, why: 'no pdf/pptx/docx' };
  if (slug) return { ok: true, why: 'published ' + slug };
  if (has(/index\.html$/i)) return { ok: true, why: 'web app built' };
  if (has(/\.(xlsx|docx|pptx|pdf|csv|sif|xml|png|jpe?g)$/i)) return { ok: true, why: 'file produced' };
  return { ok: false, why: 'no deliverable' };
}

const results = [];
const save = () => fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));

async function runPlay(play) {
  const model = play.dept === 'legal' ? 'arksai-max' : 'deepseek-v4-pro';
  const t0 = Date.now();
  const rec = { key: play.key, dept: play.dept, mode: play.mode, model, status: 'pending', ok: false };
  try {
    const sess = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: play.mode, model, task: play.key }) })).json();
    rec.sessionId = sess.id;
    const brief = play.prompt +
      '\n\n[AUTOMATED RUN — NO HUMAN IS AVAILABLE TO REPLY. Do NOT ask any questions, do NOT wait for input, and IGNORE any instruction above to "ask me" first. INVENT realistic, sensible specifics yourself and produce the COMPLETE, finished, verified deliverable now in this run. Asking a question instead of delivering = a failed run.]';
    if (!(await send(sess.id, brief))) { Object.assign(rec, { status: 'send-rejected', why: 'server would not start the run' }); results.push(rec); save(); return; }
    let status = 'idle', idlePolls = 0;
    while (Date.now() - t0 < DEADLINE) {
      await sleep(5000);
      const meta = await (await api(`/api/sessions/${sess.id}`)).json().catch(() => null);
      status = meta?.meta?.status ?? status;
      if (status === 'done' || status === 'error') break;
      if (status === 'idle') { if (++idlePolls >= 8) break; } else idlePolls = 0; // 40s grace to start
    }
    const detail = await (await api(`/api/sessions/${sess.id}`)).json();
    const files = (detail.timeline || []).filter((t) => t.kind === 'file').map((t) => t.name);
    const sys = (detail.timeline || []).filter((t) => t.kind === 'system').map((t) => t.text).join('\n');
    const slug = (sys.match(/\/apps\/([a-z0-9-]+)/i) || [])[1] || null;
    const ws = workspaceDeliverables(sess.id);
    const g = grade(play, status, files, slug, ws);
    Object.assign(rec, { status, files, ws, slug, ok: g.ok, why: g.why, durationMs: Date.now() - t0, tokens: detail.meta?.totalTokens, costUsd: detail.meta?.costUsd });
  } catch (e) {
    Object.assign(rec, { status: 'driver-error', why: String(e?.message ?? e).slice(0, 120), durationMs: Date.now() - t0 });
  }
  results.push(rec); save();
  console.log(`${rec.ok ? '✓' : '✗'} ${rec.key.padEnd(26)} ${rec.mode}/${String(rec.model).replace('deepseek-v4-', 'ds-')} ${String(Math.round((rec.durationMs || 0) / 1000)).padStart(3)}s — ${rec.why}`);
}

async function main() {
  await login();
  let catalog = loadCatalog();
  if (ONLY) catalog = catalog.filter((p) => ONLY.has(p.key));
  // legal (M2.7) last so it doesn't contend with M3-vision gates of other runs
  catalog.sort((a, b) => (a.dept === 'legal' ? 1 : 0) - (b.dept === 'legal' ? 1 : 0));
  console.log(`Running ${catalog.length} plays, concurrency ${CONC}, ${DEADLINE / 1000}s/play → ${RESULTS}\n`);
  let i = 0;
  const worker = async () => { while (i < catalog.length) await runPlay(catalog[i++]); };
  await Promise.all(Array.from({ length: CONC }, worker));
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n==== ${ok}/${results.length} PASSED ====`);
  const byDept = {};
  for (const r of results) { (byDept[r.dept] ||= { ok: 0, n: 0 }).n++; if (r.ok) byDept[r.dept].ok++; }
  for (const [d, v] of Object.entries(byDept)) console.log(`  ${d.padEnd(12)} ${v.ok}/${v.n}`);
  const fails = results.filter((r) => !r.ok);
  if (fails.length) { console.log('\nFailures:'); fails.forEach((r) => console.log(`  ✗ ${r.key} (${r.mode}) — ${r.why}`)); }
}
main().catch((e) => { console.error('FATAL', e); save(); process.exit(1); });
