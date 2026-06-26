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

### Report PDF — ⬜
### .docx — ⬜
### .xlsx formula model — ⬜ (audit flag: inconsistently formula-driven)
### .pptx deck — ⬜ (never exercised via the live agent)

## Wave 2 — Code on a connected repo — ⬜
## Wave 3 — Brand & media — ⬜ (video params, Suno V5 shape, TTS ids to fine-tune)
## Wave 4 — Robots (email) — ⬜

---
**Harness note:** live runs via the authenticated API (cookie login → create session → send brief → poll
`GET /api/sessions/:id`). The headless browser CANNOT reach arksai.studio (proxy blocks browser TLS →
`ERR_CONNECTION_CLOSED`), so published apps are mirrored locally (curl the files) and screenshotted from a
local server; PDFs are rasterized with `mupdf`.
