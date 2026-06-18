# ArksAI — Comprehensive Test (all 88 plays + edge cases + deployment)

Hand this to the session that has the repo (and SSH to the deployment). It runs three layers
of testing, grades everything, and tells you what to fix. **Run it against a LOCAL build, not
production** (88 agent builds would pollute the live box) — except Layer 3, which checks the
real deployment.

The batch runner is included **inline** below (Layer 2) so this file is self-contained; the
deployment checks (`scripts/deploy-check.sh`, `scripts/deploy-check-browser.mjs`) are already in
the repo.

---

## Layer 0 — set up a local server (one time)

```bash
cd <repo>                      # the arksai checkout
# .env needs at least: APP_PASSWORD, DEEPSEEK_API_KEY, MINIMAX_API_KEY (sk-cp-…)
# (copy them from the Droplet: ssh root@159.89.172.210 'cat /opt/arksai/.env')
npm install
npm run build
set -a && . ./.env && set +a
PORT=3200 NODE_ENV=production nohup node server/dist/server/src/index.js > /tmp/srv.log 2>&1 &
until curl -s -o /dev/null http://localhost:3200/healthz; do sleep 1; done
grep -i capabilit /tmp/srv.log    # confirm: MiniMax enabled (image gen/vision/M3)
```

---

## Layer 1 — deterministic suite (fast; edge cases, units, integration)

This is the "edge cases like before" battery — malformed/empty/oversized/special-char inputs to
every generator, the HTTP input-validation boundary, the catalog integrity (all 88 plays wired),
the M3 stall/fallback, etc.

```bash
npm run typecheck && npm test && npm run build
```
**Expect:** typecheck clean, **all tests pass** (~256), build clean. Any failure is a real bug —
fix it. (Key suites: `edgecases`, `inputvalidation`, `uploads`, `anthropicAdapter`,
`compliance`, `sheetcalc`, `expertise`, `redteam-isolation`.)

---

## Layer 2 — every play end-to-end (the 88-play audit)

Drives all 88 catalog plays through the agent with their real prompts, captures the deliverable,
and structurally grades it. legal.* → arksai-max (M2.7); everything else → deepseek-v4-pro (fast,
exercises the generators/prompts/gates). Results stream to `scripts/audit/out/_results.json`.

**Create `scripts/audit/batch-audit.mjs` with this exact content** (validated: a single-play
smoke built a real web app in 170s):

````js
// Exhaustive catalog audit — runs ALL plays end-to-end against a locally-running ArksAI
// server, captures + structurally grades each, and writes results incrementally so an
// interruption never loses progress. Self-contained: reads the catalog from departments.ts.
//   CONC=2 AUDIT_BASE=http://localhost:3200 node scripts/audit/batch-audit.mjs
// legal.* → arksai-max (M2.7); everything else → deepseek-v4-pro. Results → out/_results.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const BASE = process.env.AUDIT_BASE || 'http://localhost:3200';
const CONC = Number(process.env.CONC || 2);            // keep < MAX_CONCURRENT_RUNS (default 3)
const DEADLINE = Number(process.env.AUDIT_DEADLINE_MS || 360_000);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null; // smoke a subset
const RESULTS = path.join(ROOT, 'scripts/audit/out/_results.json');

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
  catalog.sort((a, b) => (a.dept === 'legal' ? 1 : 0) - (b.dept === 'legal' ? 1 : 0)); // legal (M2.7) last
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
````

**Run it** (concurrency 2 — keep it under `MAX_CONCURRENT_RUNS`, default 3):
```bash
CONC=2 AUDIT_BASE=http://localhost:3200 node scripts/audit/batch-audit.mjs | tee /tmp/batch.log
# smoke a subset first:  ONLY=marketing.landing,finance.cashflow CONC=1 node scripts/audit/batch-audit.mjs
```
It prints a per-play `✓/✗`, a per-department tally, and a failure list, and writes
`scripts/audit/out/_results.json`. Wall time ≈ 1.5–3 h at CONC=2.

**Grade each ✗:** open the session (`/api/sessions/<id>`) or the workspace
(`data/workspaces/<id>/repo/`) and look at the timeline. Distinguish:
- **Harness artifact** (e.g. the agent asked a question despite the no-questions suffix, or a
  429/idle) — not a product bug; note and move on.
- **Real bug** (crash, empty/garbage deliverable, wrong format, gate didn't fire) — fix the shared
  generator/prompt/gate (one fix usually lifts every play of that type), re-run that play with
  `ONLY=<key>`, confirm ✓.

**Spot-check the ✓ for quality**, not just existence: render a few PDFs (`mupdf`), re-open an
`.xlsx` (formulas, not hard-coded), open a published app, eyeball a creative — a file existing
isn't the same as it being good.

---

## Layer 3 — the LIVE deployment (the part local tests can't see)

Run the deployment checks against the real site (these are already in the repo):
```bash
ssh root@159.89.172.210 'cd /opt/arksai && bash scripts/deploy-check.sh'
ssh root@159.89.172.210 "cd /opt/arksai && docker compose -f docker-compose.tls.yml exec -T arksai \
  sh -c 'BASE=https://arksai.studio APP_PASSWORD=\$APP_PASSWORD node /app/scripts/deploy-check-browser.mjs'"
```
This covers containers/TLS/auth/DB/capabilities + the **publish/serve/Canvas** path (mixed
content, asset 404s, iframe render) — i.e. the "publish works but the Canvas won't load the app on
the deployment" bug. See `DEPLOYMENT_CHECK.md` for the full checklist + fixes.

---

## Fixing on the go
- Code fix → gate (`npm run typecheck && npm test && npm run build`) → commit → (when cleared)
  push to `main` → auto-deploys. **Per the current instruction, do NOT push to `main` until told.**
- Never commit secrets; never `down -v`; always `./deploy.sh` (never the plain stack) on the box.

## Done when
Layer 1 fully green · Layer 2 every ✗ is either fixed or a documented harness artifact (with the
✓ spot-checked for quality) · Layer 3 all `✓` and a published app renders in the Canvas. Report a
coverage table (play → ✓/fixed/known-issue) + what changed.
