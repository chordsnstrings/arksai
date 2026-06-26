# Capability audit — live, side-by-side vs Claude-quality

Living record of the validation + fine-tuning campaign (plan: get every capability to Claude-quality).
Each capability is run **live** against https://arksai.studio, the artifact captured, judged against the
optimized output Claude would produce, and the specific fine-tune applied + re-validated.

Legend: ✅ at-bar · 🟡 good output but a process/quality gap · 🔴 below bar · ⬜ not yet run.

## Wave 1 — Generative deliverables

### Web app — 🟡 → fixing
- **Brief (live):** "polished personal expense tracker… add/edit/delete, dashboard with totals + category
  chart, localStorage, modern minimal responsive… publish it." (code mode, arksai-auto)
- **Output:** **Excellent, Claude-competitive.** Editorial masthead, 3 KPI cards (all-time / this-month
  with MoM delta / categories), a category donut + bar breakdown, a clean transactions table with colored
  category pills, self-hosted Source Serif + Inter + JetBrains Mono, fully responsive, **0 console errors**,
  real data. Published live to `/apps/ledger/`. (Screenshots sent to operator.)
- **Gap (process, not output):** ran **~18 min / 170+ steps** in an `inspect_ui` whack-a-mole loop —
  proactively re-inspecting and even arguing with its own inspector ("may be a false positive", "likely a
  rendering glitch") — and had to be interrupted. Claude ships this in 2–3 min. The `inspect_ui` SOFT_CAP(8)
  was advisory text the model ignored.
- **Fix applied (commit):** `inspect.ts` — SOFT_CAP 8→**4** (nudge earlier) + a **HARD_CAP(8)** that *refuses*
  to inspect past the ceiling (no longer just advisory). `prompts.ts` — inspect_ui is for diagnosing a
  *specific reported* defect, not proactive nit-hunting during the build; a self-judged "false positive /
  rendering glitch / sub-pixel" finding is treated as DONE. **Re-validate:** next live web build should
  finish in a handful of inspections, not 20+.

### .xlsx formula model — 🟡 → improved
- **Brief (live):** 3-year MONTHLY SaaS model; Assumptions sheet + a Model sheet where every derived
  number is a live formula across 36 months. (code mode, arksai-auto)
- **Output:** the detailed **Model sheet is genuinely formula-driven — 479 formulas, 0 literals**, real
  cross-sheet refs (`=Assumptions!$B$3`). A big improvement over the old audit's "1 of 6 formula-driven."
  BUT the **Summary sheet was broken**: it tried to reference the Model but wrote the refs as plain TEXT
  without `=` (`Summary!B5="Model!D6"` → dead links) *and* hard-coded numbers.
- **Latency finding:** the build ran **21+ min and still hadn't finished** (heavy-generator latency on M3,
  building one sheet per call) — I interrupted it before the verify gate ran.
- **Gaps:** (1) the broken-Summary case: the existing `stringyRef` audit DOES catch the dead-text refs (so
  the gate would have flagged it on completion), but a *purely* hard-coded Summary sheet (typed numbers,
  no text refs, non-derived row labels) slipped through — the formula audit was workbook-level. (2) severe
  heavy-generator latency.
- **Fix applied (commit):** `deliverableCheck.ts auditFormulaModel` now also flags at the **sheet level** — a
  summary/dashboard/P&L/cash-flow/output sheet with **0 formulas and ≥15 typed-in numbers** while the model
  computes elsewhere is flagged ("reference the calc sheets with =Model!.. / =SUM(Model!..)"). Unit-tested
  (non-derived labels, so it exercises the sheet path) + verified against the real workbook. Latency is a
  known, separate issue (model speed on heavy generators) — not fixed here.

### Report PDF — ⬜
### .docx — ⬜
### .pptx deck — ✅ at-bar (first live agent run)
- **Brief (live):** an 8-slide investor pitch deck (.pptx) for a fictional SaaS startup, editorial 16:9.
- **Output:** **excellent / Claude-competitive** — composed cover with a KPI band + CONFIDENTIAL, sharp
  problem/solution, designed stat tiles, a 4-stage "how it works," a TAM/SAM/SOM bar chart + a magazine-grade
  traction chart (bars + trend line via `render_chart`), a real pricing table, a clean "ask." 247KB editable
  .pptx + preview. (Sent to operator.)
- **Process:** built in **~4.4 min, status done, no runaway.** A deck is ONE generation call, so it sidesteps
  the incremental-round-trip latency entirely.
- **Refines the latency finding:** the 20-min problem is **specific to the incremental multi-sheet xlsx
  path**, NOT decks/docs/reports. The latency fix should target the xlsx sheets-per-call, not all heavy
  generators. No pptx fix needed.

## Wave 2 — Code on a connected repo — 🟡 → improved (read/understand ✅, library-boot bug fixed)
- **Live test:** created a CHAT session with NO repo, then attached `sindresorhus/p-limit` via PATCH (the
  exact screenshot bug), then asked about the code.
- **clone-on-connect:** ✅ **validated live** — 9s after attach the workspace had all 16 repo files. The fix
  shipped earlier this session works in production.
- **repo primer + Q&A:** ✅ **Claude-quality** — a precise, line-cited walkthrough of `index.js`
  (`activeCount`/`queue`/`enqueue`/`run`/`resumeNext`), reading the real code.
- **code-review gate:** ✅ **fired live** on a small edit — "✓ Code review passed — no correctness issues in
  the diff." First live exercise of the gate shipped this session; works.
- **Bug found + fixed:** editing a **library** repo (p-limit) made the verify gate try to "**Boot the app and
  exercise its endpoints**" and loop ("hardening pass 2, 3…") — because `detectStartCommand` returned
  `node index.js` for *any* package with an index.js, even a library that opens no port. **Fix:**
  `verify.ts` now only treats an entry file as a start command if it **actually looks like a server**
  (listen/PORT/express/fastify/Flask/…), so libraries/CLIs run static checks + their own tests and skip the
  boot. Unit-tested (library vs server, Node + Flask). 643 tests green.
- **Not tested live:** the branch + `open_pull_request` push half — needs a writable throwaway repo (won't
  push experimental edits to a real one). Deferred; the tool wiring is unit-tested.
## Wave 3 — Brand & media
### Video (Hailuo) — 🟡 → fixed (params wired)
- **Validated live earlier this session:** generated 3 real Hailuo clips; learned the request rules
  (duration 6/10, resolution 768P/1080P, **10s+1080P rejected**, `aspect_ratio` accepted, CDN download host
  is proxy-blocked from the sandbox but fine from a browser).
- **Gap:** `generate_video` → `generateVideo` only sent `{model, prompt, first_frame_image}` — **no
  duration/resolution/aspect_ratio**, so every clip used the defaults (couldn't do vertical/phone or control
  length).
- **Fix applied (commit):** `engines/minimax.ts` `normalizeVideoParams` + `generateVideo` now send
  duration/resolution/aspect_ratio with the validated combo guard (10s→768P). `tools/minimax.ts` exposes the
  params + bakes the **director-style prompting rules** (single continuous shot, POV-anchoring, bright
  lighting, named subject — the playbook learnings) into the tool description. Unit-tested. Standalone M3
  prompt-refiner UI flow = optional follow-up.
- **Suno V5 music / TTS (group id + speech-02 id):** ⬜ still to validate live.

## Latency (cross-cutting) — investigated, recalibrated
- **Code-mapped breakdown of a ~18–21 min heavy build:** ~30–40% is 5–8 **sequential M3 round-trips** (each
  buffers a large tool-call JSON, ~75s/turn); ~12–16% M3 stalls→fallback; ~12% gates; ~12% recalc/vision.
- **Model-side levers DISPROVEN live (operator's verify rule paid off):**
  - There is **no `MiniMax-M3-highspeed`** — the live `/v1/models` list is only `M3` + older `M2.x`/`M2.x-
    highspeed` coding models, and the Anthropic endpoint **silently runs plain M3** for any `M3-*` id
    (every response came back `"model":"MiniMax-M3"`). The web's "faster same-quality M3" is not real here.
  - **`service_tier:priority` ≈ noise** — 27.6s vs 28.4s on a heavy generate call (~3%). Not worth it.
  - ⇒ There is **no faster same-quality model**; latency must be **structural**, and switching to the weak
    fast model is off the table (quality).
- **Fix applied (commit):** parallelized the gate's **per-page/slide vision review** (`deliverableCheck.ts`)
  — was sequential `for…await analyzeImage` (up to 6 pages × ~11s); now `Promise.all`, so a multi-page
  report/deck costs ~one vision call instead of six. ~50s off the gate on reports/decks, zero quality cost.
- **Still on the table (structural, quality-safe):** fewer round-trips (test 2–3 sheets/call now that
  starvation is fixed), parallel independent tool calls in a turn, and perceived-latency UX (stream partial
  deliverables / honest "building sheet 3 of 5"). Realistic ceiling ≈ 20–40% off, NOT a 5× — M3 is the
  quality model and there's no faster one.
## Wave 4 — Robots (email) — ⬜

---
**Harness note:** live runs via the authenticated API (cookie login → create session → send brief → poll
`GET /api/sessions/:id`). The headless browser CANNOT reach arksai.studio (proxy blocks browser TLS →
`ERR_CONNECTION_CLOSED`), so published apps are mirrored locally (curl the files) and screenshotted from a
local server; PDFs are rasterized with `mupdf`.

## Publish regression (operator-reported) — diagnosed + fixed
- **Report:** "after your fix now apps don't actually publish." **Diagnosed live:**
  - Publishing WORKS — a fresh build published clean (`/apps/hello-time/`, 200), and the reported app
    (`eco-clean-uae`) was in fact **live**. The screenshot's failure was a *follow-up build's verify gate*
    failing on "Booting the app."
  - The app is a full **Next.js + Prisma + Postgres** app (`start: next start`, deps `@prisma/client`/`prisma`).
    The verify gate tried to `npm start` it, but it needs a **Postgres DB + env** the build sandbox doesn't
    have → can't boot → dead-loops → blocks finishing + re-publishing the change. **Not caused by my
    `detectStartCommand` change** (the `start`-script path is unchanged).
- **Fix 1 (the real blocker):** the runtime gate is now **non-fatal for a DB-backed server app**
  (`needsExternalDb` in `verify.ts`: prisma/pg/mongo/redis/… or DATABASE_URL): static checks + build still
  gate, then it's accepted with an honest note and **validated live at publish** (where its real DB exists),
  instead of looping "booting the app."
- **Fix 2 (latent regression I DID introduce):** my `looksLikeServer` regex matched `app.run(` and bare
  `.listen(` — which are common CLIENT idioms (`app.run()`, React Router `history.listen()`) — so a static
  app could be wrongly booted as a server. Now **language-scoped** (JS server constructs / `PORT`-bound
  listen; Python signals only on `.py`), dropping those false-positives. Unit-tested. 650 tests green.

## Database-backed apps — the comprehensive end-to-end test (operator-driven)
- **Operator (rightly):** "you didn't test a database-backed app — that's the comprehensive test," and
  "the db-backed app should build a db-backed app from the beginning," then "we should be able to do any
  kind of database."
- **Root cause found:** `publish.ts` had ZERO database handling — a DB app shipped with no schema and (for a
  server DB) nothing to connect to → it deployed broken. My earlier verify-gate "tolerance" was a band-aid.
- **SQLite path — BUILT + VALIDATED LIVE END-TO-END:** built a guestbook (Express + better-sqlite3) from
  scratch → published to `/apps/guestbook/` → **POST /api/entries → 201, GET returns it → data persists**
  server-side at the live URL. (The transient 502 was the deploy-restart window, not the app.)
- **"Any database" → Postgres provisioning BUILT (inert until enabled):** `dbProvision.ts` creates an
  isolated per-app Postgres role + database on the managed instance, injects the connection string, runs
  migrations; per-app password is deterministic so re-publish reuses the same DB (data persists). SQLite
  stays the zero-infra default; MySQL/Mongo/Redis stubbed to extend. Pure logic + gating unit-tested.
  **Live Postgres validation is operator-side** (sandbox can't reach the droplet/managed PG) — it activates
  when `MANAGED_PG_ADMIN_URL` is set.
- **Lesson logged:** validate the ACTUAL failing class (DB-backed), not just the easy case (static).

## "Any database" — Postgres provisioning VALIDATED LIVE (operator gave DO access)
The operator provided a DO API token; I wired enablement without SSH and validated the full cycle:
- **Enabled (no SSH):** `dbRuntime.ts` (admin URL from env or encrypted `app_settings`) + superadmin routes
  `/api/admin/db/{configure,status,test,apps}`. Set the **arksai-db** (managed PG16) admin URL via the
  endpoint; `db/test` from the droplet → **connected (PostgreSQL 16.14)**.
- **TLS fix:** DO's managed-DB CA isn't in Node's trust store → `pgConnOpts` strips a conflicting sslmode +
  `rejectUnauthorized:false`; deployed apps get the driver-right sslmode (Prisma `require`, node-pg
  `no-verify`). Plus a PG15+ `public`-schema ownership grant so the app role can create tables.
- **End-to-end LIVE:** built a Postgres notes app (Express + pg) → publish **provisioned an isolated
  per-app database + role on arksai-db**, injected DATABASE_URL → the app connected, created its table, and
  **persists data** (POST 201 → GET returns it; serial id + timestamptz = real Postgres). URL
  `/apps/slate-pad-notes/`.
- **24h cleanup PROVEN:** `GET /api/admin/db/apps` showed `app_slate_pad_notes`; DELETE the deployment →
  list returned `[]`. **The per-app database + role are reaped on expiry/delete — no leak.**
- **Operator follow-ups:** ROTATE the pasted DO token; consider locking down arksai-db's firewall (currently
  no trusted sources — internet-reachable with the password) by adding the droplet as a trusted source.

## Wave 1b — chained deliverables + DB-backed website publish (2026-06-26, all fixed & shipped)

### Chained workflow: 5-yr forecast → pptx → pdf (LIVE, verified)
Built live: a formula-driven `.xlsx` (75 formulas, Assumptions + P&L sheets) → a 7-slide `.pptx` that
**pulled the model's actual numbers** (Y5 revenue $19.4M, ending ARR $23M, 81% margin, +$2.1M EBITDA, full
P&L table, a real dual-axis revenue/EBITDA chart) → a 7-page `.pdf`. Chained data flow + conversion both
work; the deck is Claude-competitive editorial.
- **FOUND + FIXED — pptx→pdf via LibreOffice is fragile:** LibreOffice 7.4 mangles embedded raster (RGBA
  alpha → transparency mask = blank chart; PNG/JPEG → grayscale+blanked). The agent burned ~60 steps
  brute-forcing a BMP workaround. **Fix:** new `convert_document` tool renders a deck's faithful
  `.preview.html` (inline-SVG charts) via headless Chromium — crisp every time; soffice only for plain
  office docs. preview.html now carries print CSS (one slide = one page). Steering: never soffice a .pptx.
- **FOUND + FIXED — design-gate gold-plating:** after producing an excellent deck AND self-fixing 2 defects,
  the loop kept going and started "reimagining" the cover with a compass-rose gimmick (cost 2.5×). **Fix:**
  deliver-when-good steering in prompts.ts (don't re-author/redesign an already-good document).

### DB-backed website publish (LIVE, verified end-to-end)
Goal: publish a database-backed website and check it works on the live URL. Achieved with an
**Express + Postgres server-rendered guestbook**: my own form submissions (JSON *and* native urlencoded)
returned 303 and **persisted in Postgres**, server-rendered on a fresh GET (count incremented; entries
present). Re-publish came back **verifyOk:true** ("renders cleanly").
- **FOUND + FIXED — publish build inherited `NODE_ENV=development`:** broke Next.js `next build`
  (/404,/500 `<Html>` prerender error). **Fix:** run the BUILD step at `NODE_ENV=production` (install stays
  development for devDeps) in both publish paths.
- **FOUND + FIXED — reverse-proxy 415'd non-JSON bodies:** Fastify parses only JSON by default and 415s
  `application/x-www-form-urlencoded`/multipart **before** the proxy handler — so a normal HTML `<form>` POST
  never reached a published app, and the post-publish smoke test (which submits the first form)
  **false-marked working apps as `error`**, making the publish modal withhold a live link for a working app.
  **Fix:** catch-all raw-body parser → the proxy forwards any content-type verbatim. Verified live: urlencoded
  POST 415→303, multipart uploads still work, re-publish goes green.
- **FOUND + FIXED (UX) — publish is now a focused modal:** the completion-card "Share it" opens the
  Publish & share modal (live link + full error visible/copyable) instead of a cramped inline step that
  swallowed the real error.
- **FOUND (steering) — Next.js App Router/RSC fights the path proxy:** RSC fetches come back as HTML and
  client navigation breaks under `/apps/<slug>/`; two Next+Postgres builds cost long debug loops. Steering
  now prefers a proxy-friendly stack (static/SPA + Express API, or server-rendered Express) and uses Next
  only when explicitly asked.
- **Minor/open:** publishing via the bare API with no name derives an ugly slug from the brief text (the UI
  always passes the title → clean slug, so users are unaffected); the post-publish "error" status on a node
  app whose process is later reaped by a redeploy needs a manual restart (boot recovery skips `error` rows).
