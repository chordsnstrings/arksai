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
### .pptx deck — ⬜ (never exercised via the live agent)

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
## Wave 3 — Brand & media — ⬜ (video params, Suno V5 shape, TTS ids to fine-tune)
## Wave 4 — Robots (email) — ⬜

---
**Harness note:** live runs via the authenticated API (cookie login → create session → send brief → poll
`GET /api/sessions/:id`). The headless browser CANNOT reach arksai.studio (proxy blocks browser TLS →
`ERR_CONNECTION_CLOSED`), so published apps are mirrored locally (curl the files) and screenshotted from a
local server; PDFs are rasterized with `mupdf`.
