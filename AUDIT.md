# ArksAI — System Audit (2026-06-15)

A full, hands-on audit of `main`: the product UI, all **52 department plays** across the
5 teams, and every output type (web app, landing, dashboard, PDF report, 16:9 deck,
spreadsheet, document). Each play was driven **through the real API** (create session →
send the play's brief → run to completion → harvest the deliverable), and outputs were
captured with Playwright (web) and mupdf (PDF).

> **Scope of this pass:** all 52 plays were executed end-to-end (autonomously — the briefs
> were augmented so the agent invents realistic specifics instead of waiting for answers).
> Models: `arksai-auto` (the product default). MiniMax is keyed but the account returns
> `insufficient_balance` on `/v1`, so MiniMax-dependent features (vision, image, the design
> gate) were exercised in their **degraded** path — itself a finding.

**Status: audit only — no application code changed.** Findings are ranked; we fix them one
by one next.

---

## Verdict in one line
The core is **genuinely high quality** — the product UI and the report/deck/web pipelines
produce polished, editorial, microanimated, responsive output that meets the bar. The
problems are concentrated in **(1) host/agent isolation, (2) spreadsheets, (3) the MiniMax
capability layer being dark, and (4) a few consistency gaps (publish, cover icons, doc fonts).**

## Scorecard
| Surface | Verdict | Notes |
|---|---|---|
| Product UI (landing / launchpad / catalog / mobile) | ✅ Excellent | Warm editorial identity, accent-coded teams, responsive |
| Web apps (code mode) | ✅ Excellent | **Visually verified** (KPI dashboard, ROI calculator) — polished, real charts, restrained accent; microanimations + `@media` responsive (desktop **and** mobile confirmed); self-hosted Inter/Source-Serif/Space-Grotesk. **13/14 published live** |
| Reports & 16:9 decks (report mode) | ✅ Excellent | Mastheads, kickers, hairline rules, KPI grids, direct-labeled flat charts, compact zebra tables, callouts, brand-derived palettes, takeaway-headline slides |
| Documents (.docx) | ⚠ Good content, weak type | Strong structure + cited sources; uses the `generate_doc` default font, not the editorial stack |
| Spreadsheets (.xlsx) | ⚠ Mixed | Trackers/lists are formatted & fine; **financial *models* are mostly formula-less** (only `finance.model` had formulas; `cashflow`/`scenario`/`budget`/`expenses` had 0) — `cashflow` had neither formulas nor formatting |
| Host/agent isolation | 🔴 Broken | Unrestricted agents killed the server (×2) and mutated the host repo |
| MiniMax capability layer | 🔴 Dark | Vision / image / TTS / video unusable (account balance); design-critique gate inert |

---

## Findings (ranked)

### P0 — Agents are not isolated from the host (security + reliability)
`AGENT_UNRESTRICTED=true` runs each agent's shell with full host access, **and the agent
loop runs inside the ArksAI server process**. During the audit this caused, twice:
- **The server was SIGKILLed mid-run** (no OOM — 16 GB free, no cgroup limit; the log just
  stops). A concurrent web-app build almost certainly ran a broad `pkill`/`kill`/`fuser`
  cleanup that killed ArksAI itself. There is zero isolation between an agent's shell and
  the host server.
- **The host repo was mutated:** an agent ran `npm install exceljs` that landed in
  `/home/user/arksai/package.json` (added a `dependencies` block) and disturbed the host
  `node_modules`.

Single-operator trusted mode mitigates the blast radius today, but this blocks any
multi-seat/multi-tenant future and makes the single instance fragile. *(Mitigated for this
audit with an auto-respawn supervisor; the real fix is process isolation / a command
denylist for the agent shell, even in unrestricted mode.)*

### P1 — Financial models aren't formula-driven (and it's inconsistent)
Measured across all 11 spreadsheet plays (formula-cell + number-format scan via SheetJS):
- **Only 1 of 11 (`finance.model`) is formula-driven** (52 formulas). The other finance
  *models* — `cashflow`, `scenario`, `budget`, `expenses` — have **0 formulas**: numbers are
  hard-coded, so changing an assumption does **not** flow through. This contradicts the FP&A
  expert standard ("formula-driven, so a single assumption flows through").
- **`finance.cashflow` is the worst case:** 0 formulas **and** 0 number formatting (every
  cell `General` — no currency/thousands/%/dates), despite having the right *structure*
  (Assumptions / Forecast / Dashboard / Validation sheets).
- Trackers/lists (`tracker`, `pipeline`, `teamtracker`, `calendar`, …) are **formatted and
  fine** — formula-less is acceptable for a list, less so for a "model".
- **Root cause:** the agent **bypasses the purpose-built `generate_spreadsheet` tool** and
  hand-writes raw `exceljs` scripts (e.g. `build_cashflow.js`) run via bash — sometimes with
  formulas (`finance.model`), often without. And `generate_spreadsheet`'s own schema has **no
  formula support** (rows are values only), so even using the tool correctly can't produce a
  real model. Fix: give the tool formula support and steer the agent to it.

### P1 — The MiniMax capability layer is entirely dark
MiniMax is keyed but every `/v1` call returns `insufficient_balance (1008)`. Consequences
observed:
- `see_image`, `generate_image`, `text_to_speech`, `generate_video` are unusable.
- The **gating visual design-critique loop** (MiniMax-VL judging the rendered UI) silently
  no-ops — so the headline "one-shot quality" gate is **not actually gating** anything;
  output quality currently rides entirely on DeepSeek following the design prompt.
- Tasks that need images **silently substitute**: `marketing.emailkit`'s "3 social
  graphics" came out as **HTML files**, not images.
- (Also fixed in commit `aadb8dc`: the vision model id `MiniMax-VL-01` was *invalid* on the
  account; chat/vision now default to `MiniMax-M3`. Still blocked by balance.)

### P2 — Retries leave orphaned, errored duplicate deployments
Publishing itself works well — **13 of 14 web apps are live** at a durable `/apps/<slug>/`
URL (only `engineering.admin` errored). But the deployments table held **57 records (19
running / 38 error)**: every retry re-published under a new slug (`…-2`, `…-3`) and the
agent-kills left the older deployments' processes dead, so stale **errored duplicates
accumulate with no cleanup**. The *latest* deployment per app is almost always healthy; the
clutter is the issue (and it made the live state look worse than it is). Fix: supersede/GC
prior deployments for the same session on re-publish.

### P2 — Arbitrary "faux-logo" icon on some report covers
Document-style report covers sometimes render a random Lucide icon (a ⚠ "alert" triangle)
on a filled accent square as a stand-in brand mark — off-brand against the otherwise
restrained editorial type. (Decks and content pages use icons appropriately.)

### P2 — .docx uses a non-editorial font
`generate_doc` output is well-structured (real headings, tables, a *Sources* section) but
uses the library default (Calibri), not the embedded editorial stack (Inter / Source Serif)
the rest of the system uses — so documents look "office default", not designed.

### P3 — Concurrency caveats (single-process design)
The preview server is hard-coded to port 4000, so concurrent code runs collide on it; and
`MAX_CONCURRENT_RUNS` + in-process agents means heavy parallel runs (Chromium verify +
render) strain one process. Fine for single-user; relevant for scale.

---

## What works well (keep)
- **Product identity & UX** — the warm editorial system, team accent-coding, Create/Analyze/
  Operate catalog, and mobile layout are genuinely premium.
- **The report/deck pipeline** — editorial protocol (mastheads, kickers, rules, KPI grids,
  flat direct-labeled charts, compact tables, callouts, anti-orphan layout) produces
  presentation-grade PDFs and real 16:9 decks with takeaway headlines and brand-derived
  palettes.
- **Web design system** — microanimations, responsiveness, reduced-motion, and self-hosted
  Google-font typefaces are baked into generated apps by default.
- **The agent loop** — autonomous completion (no stalls), the self-healing verify gate
  (it caught and fixed a real port bug), auto-routing, and download/canvas plumbing.
- **Catalog integrity** — all 52 plays map to matching server-side expert standards.

## Note on "Google fonts"
The system uses the requested typefaces (Inter, Source Serif 4, Space Grotesk) **self-hosted
as woff2**, not via the Google Fonts CDN (0 CDN references found). Same typefaces, and better
for PDF/offline reliability. If you specifically want the CDN, that's a deliberate change.

## `arksai-max` = MiniMax (not Anthropic)
Confirmed and corrected throughout: `arksai-max` is MiniMax's own model (M3). MiniMax merely
ships a protocol-compatible surface; the provider/model is MiniMax.

---

## Fix status (2026-06-15)
1. **P0 isolation** — ✅ *partial* (`2dc4559`): an always-on denylist blocks `pkill`/`killall`/
   `fuser -k`/`shutdown`/`systemctl stop` on both bash tools in every mode, so an agent can no
   longer kill the server. ⏳ *deferred:* the uid-drop (run agent children as a low-priv user)
   needs Docker/Droplet testing — it's also what fully fixes the host-repo `npm install` mutation.
2. **P1 spreadsheet models** — ✅ FIXED (`8c76445`): `generate_spreadsheet` now accepts formula
   cells (`"=B2*C2"` / `{f,v}`) and the prompt steers the agent to use them for models.
3. **P1 MiniMax** — ✅ the design-gate now fails LOUDLY, not silently (`2dc4559`); the M3 LLM is
   live via the `sk-cp` subscription key + a hang-fix (`1fff244`). ⏳ image/TTS/video model ids
   still need confirming on the Droplet.
4. **P2 deployments** — ✅ FIXED (`cf26c37`): re-publish supersedes a session's prior deployments,
   so errored duplicates no longer accumulate and the URL stays stable.
5. **P2 polish** — ✅ report covers are type-only now, no faux-logo icon (`2dc4559`). ⏳ `.docx`
   editorial font needs bundled TTF assets to embed (uses Calibri for now).

---

## Methodology & artifacts
- Driven via the live server (`/api/sessions` + SSE), auto-respawn supervisor to survive
  agent-kills, concurrency 3, per-run cap 10 min, one auto-retry per play.
- Outputs captured: web apps via Playwright (`/apps/<slug>/`, desktop + mobile), PDFs via
  mupdf, structure/feature scans via ripgrep + SheetJS.
- Full per-play results table and the screenshot gallery: **appended below after the pass
  completes.**

## Full per-play results (all 52)

**Aggregate:** every completed play produced a deliverable and **0 stalled** asking for input
(fully autonomous). Web apps **13/14 live**; reports/decks **18 PDFs**; documents **8 .docx**;
spreadsheets **11 (only `finance.model` formula-driven)**; `engineering.api` built a working
Express API (routes + db + seed — a code service, not a file download). **Net: 52/52 produced a
real deliverable.** `✅` = meets bar; `⚠` = produced but flawed (see findings).

### Marketing

| Play | Mode | Output | Result |
|---|---|---|---|
| landing | code | app | ✅ live · anim · responsive |
| emailkit | code | app | ✅ live · anim · responsive (social "graphics" are HTML, not images) |
| blog | code | docx | ✅ .docx (cited sources) |
| brief | report | pdf | ✅ 1pp PDF |
| eventsite | code | app | ✅ live · anim · responsive |
| perfreport | report | pdf | ✅ 6pp PDF |
| competitor | report | pdf | ✅ 12pp PDF |
| audience | report | pdf | ✅ 9pp PDF |
| calendar | code | xlsx | ⚠ formatted, no formulas |
| tracker | code | xlsx | ⚠ formatted, no formulas |

### Sales

| Play | Mode | Output | Result |
|---|---|---|---|
| pitchdeck | report | pdf | ✅ 12pp 16:9 deck |
| pricing | report | pdf | ✅ 1pp PDF |
| proposal | report | pdf | ✅ 8pp PDF |
| casestudy | report | pdf | ✅ 1pp PDF |
| outreach | code | docx | ✅ .docx |
| accountbrief | report | pdf | ✅ 8pp PDF |
| battlecard | report | pdf | ✅ 3pp PDF |
| roi | code | app | ✅ live · anim · responsive (interactive calculator) |
| accountplan | code | xlsx | ⚠ formatted, no formulas |
| pipeline | code | xlsx | ⚠ formatted, no formulas |

### Finance

| Play | Mode | Output | Result |
|---|---|---|---|
| boarddeck | report | pdf | ✅ 12pp 16:9 deck |
| investorupdate | report | pdf | ✅ 5pp PDF |
| strategymemo | report | pdf | ✅ 10pp PDF |
| kpidashboard | code | app | ✅ live · anim · responsive (charts + table) |
| variance | report | pdf | ✅ 7pp PDF |
| model | code | xlsx | ✅ **formula-driven** (52 formulas) + formatted |
| cashflow | code | xlsx | 🔴 0 formulas, 0 formatting |
| scenario | code | xlsx | ⚠ formatted, no formulas |
| budget | code | xlsx | ⚠ formatted, no formulas |
| expenses | code | xlsx | ⚠ formatted, no formulas |

### HR / People

| Play | Mode | Output | Result |
|---|---|---|---|
| jd | code | docx | ✅ .docx |
| offer | code | docx | ✅ .docx |
| policy | code | docx | ✅ .docx |
| handbook | code | docx | ✅ .docx |
| training | report | pdf | ✅ 18pp PDF |
| survey | code | app | ✅ live |
| peopledash | code | app | ✅ live · anim · responsive |
| onboardingportal | code | app | ✅ live · anim · responsive |
| onboardingchecklist | code | xlsx | ⚠ formatted, no formulas |
| teamtracker | code | xlsx | ⚠ formatted, no formulas |
| runbook | report | pdf | ✅ 10pp PDF |

### Engineering

| Play | Mode | Output | Result |
|---|---|---|---|
| internaltool | code | app | ✅ live · anim · responsive |
| prototype | code | app | ✅ live · anim · responsive |
| admin | code | app | ⚠ deploy errored (latest) |
| docssite | code | app | ✅ live · anim · responsive |
| engmetrics | code | app | ✅ live · anim · responsive |
| datadash | code | app | ✅ live · anim · responsive |
| api | code | service | ✅ Express API (products/reviews/stats routes + db + seed) |
| techdoc | code | docx | ✅ .docx |
| runbook | report | pdf | ✅ 9pp PDF |
| designdoc | code | docx | ✅ .docx |
| statusreport | report | pdf | ✅ 6pp PDF |

## Screenshot gallery
Captured this run (shared in chat): **product UI** (B2B landing, launchpad team-picker,
Marketing catalog, mobile); **web apps** (NovaCloud KPI dashboard + Platform-Migration ROI
calculator — desktop *and* mobile); **reports/decks** (Q1 performance-report pages, Veridian
16:9 pitch deck). All confirm the minimal / editorial / microanimated / responsive bar — the
exceptions are the spreadsheet-model and host-isolation issues above.
