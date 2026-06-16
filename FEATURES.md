# ArksAI — Feature List

A self-hosted, Claude-Code-style web coding agent for **non-technical teams**: describe
something once → get one finished thing that looks perfect, works perfectly, and is
actually live/usable. Powered by DeepSeek, with MiniMax and Suno as capability engines.

> **Maintenance:** keep this file current — every shipped change that adds, removes, or
> meaningfully alters a feature should update this list in the same commit.
> _Last updated: 2026-06-16._

---

## Core product & agent
- Autonomous agent loop — streaming, tool-calling, stall guard, context truncation, graceful error handling.
- **4 modes:** Chat, Plan (read-only), Code (build/verify/publish), Report (designed PDFs/decks) — each with a curated toolset.
- Tooling: file read/write/edit, glob/grep, bash + persistent background processes, git, web search/fetch.

## Orchestration & engines
- **ArksAI Auto** — routes each task to Flash / Pro / MiniMax by complexity, escalates a stronger model when verification fails; server-authoritative blended cost in the footer.
- **ArksAI Max** — MiniMax M3, selectable when keyed. Called via M3's **Anthropic-compatible endpoint** (thinking off by default → fast, decisive tool use; the OpenAI surface forces unbounded thinking and stalls), through an adapter that keeps the rest of the agent loop unchanged. **Self-healing speed:** M3 can over-buffer on complex turns, so if a turn exceeds a deadline the run auto-switches to a faster always-thinking MiniMax coding model (M2.7-highspeed) for the rest of the build — M3's refinement by default, reliable speed when it's slow. Large single-shot structured outputs (a full spreadsheet/deck/doc, which M3 reliably over-buffers) get a shortened deadline so they switch to the fast model in ~30s instead of waiting the full patience window. Idle-timeout guard (no hangs); falls back to ArksAI Pro on a hard error.
- **MiniMax capability tools:** `see_image` (vision), `generate_image`, `text_to_speech`, `generate_video` (Hailuo).
- **Suno** music engine (`generate_music`), per-track cost.

## One-shot quality system
- Task classification (`taskProfile`) → deliverable type + isVisual + tier.
- Opinionated design system + a bundled UI kit (tokens/components/themes, `add_ui_kit`) injected for visual tasks; per-type design standards (web/app, report, docx, xlsx, pptx).
- **Universal visual-quality gate** (`deliverableCheck`) — EVERY deliverable is rendered to image(s) and design-reviewed by a senior-design-director rubric (M3 vision), then bounded-revised: web apps (live Chromium), PDF reports/decks (mupdf raster, per page), .xlsx/.docx (HTML render), and .pptx (LibreOffice or a faithful preview). The same "looks perfect, works perfectly" guarantee across all types, not just web apps. A **deterministic, model-free structural pre-check** (per-page ink coverage) catches lonely near-empty pages instantly — even when no vision model is available — so each revise round is cheap and targeted (reports now allow up to 2 quality-first revise rounds).
- Per-type functional check ("it actually works"): xlsx re-open + no #REF/error cells **+ calculation models must be formula-driven** (a finance/cash-flow/budget/forecast sheet built with hard-coded totals/balances/growth is auto-flagged and sent back to add live `=SUM(...)`/cross-sheet formulas — the vision gate can't catch this since it renders computed values, so this reads the cells' formulas directly); docx re-open + embedded fonts; pptx valid slides; pdf page/blank/bleed; apps boot + routes + interaction.
- Vision runs on M3's Anthropic endpoint (thinking off → fast, decisive; bounded by a timeout so it degrades, never hangs).
- Visual model floor — non-trivial visual/report work never runs on the cheapest model.

## Bulletproof verification
- Static gate (typecheck/lint/test/build) + runtime gate (boots the app, exercises routes).
- Parameterized-route filling (`:id`/`{id}`/`<int:id>`/`:slug`) + an interaction pass (seeds inputs, submits a form, clicks primary buttons).
- Headless-Chromium UI smoke test (blank/console-error/failed-request detection).
- Post-publish smoke test of the real `/apps/<slug>/` URL — a broken deploy is caught and handed back to the agent, never the user.

## Deliverables & deployment
- Live publishing (`publish_app` + TopBar) — durable public URL at `/apps/<slug>/`; static or node/python apps via a process registry that survives restarts (boot recovery).
- Auto-export (zip download chip) + auto-canvas — the canvas auto-opens and loads the result (web app, PDF, spreadsheet, or doc).
- Styled office docs: `generate_spreadsheet` (exceljs, formula-driven, validated) and `generate_doc` (docx) — documents embed the editorial typefaces (Source Serif 4 display + Inter body, the same as the reports/app), so they render designed everywhere instead of as office default. `generate_doc` also takes a **designed cover page** (masthead · accent title · one-line thesis · a **KPI band** of headline numbers · metadata footer) and `chart` blocks that embed **publication-grade `render_chart` images** — so a brief/report reads designed end-to-end, not as a wall of text.
- **`generate_pptx`** — real, editable PowerPoint (PptxGenJS): editorial 16:9 decks with a **designed cover** (masthead · accent title + thesis · a **KPI band** of headline numbers · metadata footer · `CONFIDENTIAL`) and a **dark/light slide rhythm** (per-slide theme), **publication-grade charts** via `render_chart` (dual-axis/heatmap/… embedded as crisp images, beyond the basic native bar/line/pie), title/section/bullets/two-col/stat/quote/table/image layouts, one accent, and an embedded preview for the canvas + the visual gate.
- Report mode — PDFs and 16:9 decks with a full editorial protocol (newspaper margins, anti-orphan `.lede`, kickers, rules, page mechanics); charts/figures are ATOMIC (`.keep`/`.fig`) so nothing splits across a page, and every page is auto design-reviewed before delivery.
- **`render_chart`** — publication-grade charts as embeddable SVG (Vega-Lite → SVG, server-side, no browser/Python): line, multi-line, **dual-axis** (volume bars + a trend line), bar/bar-h, stacked, area, donut, and **heatmap** (e.g. month×year). Editorial defaults baked in — flat 2D, muted base + the report accent on the key series only, direct value labels, light gridlines — so charts are on-brand by default and inline straight into the report HTML, and also rasterize to a transparent PNG so the SAME editorial charts embed into `.pptx` decks and `.docx` documents.
- **Designed cover** — the report cover is image-free but composed to fill the page: a text masthead, accent title line, one-line thesis, a **KPI band on the cover**, and a metadata footer (coverage · source · prepared-by · date · CONFIDENTIAL), with an optional dramatic dark full-bleed variant for finance/BI/markets briefs.
- **Analysis & methodology rigor** — the report protocol now demands a systematic analysis pass first (profile columns, full cross-tabs, reconcile conflicting fields), an insight-led narrative (counter-intuitive reframe → evidence → ranked recs tied to specific data points), and a Methodology/Notes section (proxies + their limits, data gaps, source attribution).
- In-app doc viewer (xlsx/csv/docx/pptx → styled HTML); Canvas preview (Preview/Files/Doc tabs, port auto-detect).

## The flow (effortless AND expert)
- Smart intake — a short, type-aware brief (one round), then fully autonomous.
- Launchpad — one-step "describe → Make it" onboarding.
- Live "smart-work" progress bar — named phases with an anticipation creep so it never looks frozen; technical work stays visible (visible competence = trust).
- Self-healing reframed as confident "hardening it (pass N)" forward progress, not failure.
- Delivery moment — "Booting your live app…" loading + retry, and a completion card ("✓ Your app is ready" → Open / Get a shareable link).

## Smart agent
- Sees uploaded images — the agent is told an image was uploaded and uses `see_image` to read it (or says vision is unavailable if unkeyed).
- Auto mode/engine switching — `switch_mode` lets a chat become a build/report mid-conversation; the runner reloads the toolset, prompt, and engine on the fly with an inline note.

## B2B department platform
- Department-aware studio — Marketing, Sales, Finance/Strategy, HR·People & Ops, Engineering, BI & Analytics; pick your function → that team's curated tasks.
- ~60-task catalog grouped **Create / Analyze / Operate**, each a ready-to-run brief in the right mode.
- Per-task expert standards (server-side) — a department persona (FP&A rigor, inclusive HR, RevOps, brand-growth, senior-eng, BI/analytics) + research-backed standards injected per task.
- B2B acquisition landing (pre-login) — "Give every team a builder," by-department value grid, FAQ, and lead capture (`POST /api/leads` + admin list).

## Day-to-day capabilities
- Recurring/scheduled tasks — a durable server scheduler (daily/weekly/interval) that fires a fresh session even with the browser closed; managed via a Schedules dialog.
- Data in — `fetch_data` pulls a public CSV/JSON/published-Sheet URL (SSRF-guarded).
- Deliver out — `send_webhook` posts a result to a Slack/Zapier/Discord hook.

## Visual identity & theming
- Editorial light/warm identity — ivory canvas, Source Serif 4 + Inter + Space Grotesk (same fonts the reports use), publication masthead, hairline rules, per-department accent coding. Token-driven.
- Dark mode for the Engineering (developer) team, with a smooth animated dark↔light crossfade (mobile + desktop, reduced-motion aware).

## Platform plumbing
- Projects — persistent workspaces (instructions, defaults, branding, knowledge base) that sessions inherit.
- Memory (global/repo/project scopes + ARKS.md); custom slash commands.
- Dual-driver storage (Postgres or SQLite); durable timeline; cost/token accounting.
- Auth: per-user accounts (email + scrypt password) + DB-backed, instantly-revocable sessions, OR the single operator password (now a platform **super-admin**); public lead endpoint allowlisted; PWA scaffolding.

## Organizations (multi-tenant "spaces")
- **Isolated org spaces** — every session/project/deployment is scoped to an org; members only see their own org's data (cross-org access → 404). The platform **super-admin** (the operator) provisions and sees everything.
- **Roles**: super-admin (operator) → org **admin** → **member**; new sessions/projects are stamped with the creator's org.
- **Project-level visibility** — each project is org-wide by default, or **private to its creator + invited members** (enforced in every list/get query; cross-visibility access → 404). The owner or an admin manages sharing.
- **Invite-only, link-based onboarding** (no email infra): the super-admin creates an org + invites its admin; org admins invite their team — each invite is a one-time link to copy/share. Opening it sets a password and logs the member straight in; memberships revoke instantly (killing live sessions).
- **In-app admin panel**: create orgs, review the waitlist (leads), manage members + invite links, plus an org switcher; two-mode login (Team member email / Operator password) and an `/invite/<token>` accept page.
- Shipped **non-breaking**: the existing operator login keeps full access via the super-admin role, and all prior data lives in a bootstrapped "Default" org.

---

## Status & honest caveats
- **106 automated tests green**; typecheck + build clean.
- Anything needing the **model key or open egress** (live builds, real vision calls, scheduled runs firing, external data/webhook delivery) is wired + unit/integration-tested but fully exercised only on the **Droplet**.
- **Staged (needs Droplet credentials):** OAuth Google Sheets/Drive & CRM connectors, a Slack app, SMTP email.
- **Multi-tenant org platform — core SHIPPED** (per-user accounts, roles/invites, org-scoped data, in-app admin panel). Remaining: the invite-only landing revamp, per-org department templates, and the AUDIT-P0 low-priv agent uid-drop before any untrusted/self-serve org. The live multi-user flow should be validated on the Droplet.
