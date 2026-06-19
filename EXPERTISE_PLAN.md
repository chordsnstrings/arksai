# Expertise System — Comprehensive Implementation Plan

> North star: **the go-to AI wrapper for non-advanced users.** A user describes what they
> want in plain words; ArksAI silently selects the right expertise and produces expert
> output. The user NEVER picks a "skill", learns jargon, or worries about which mode/department
> applies. "Apple, for everyone."

This plan turns the 5-phase expertise roadmap into an executable program with: per-phase
**goals**, an explicit **build → self-verify → operator-live-test → iterate** loop, concrete
**operator test matrices** run on the deployment server (https://arksai.studio), feature
flags for safe rollout, and instrumentation so we can SEE whether auto-selection works.

---

## 0. Why this exists (the gap)

Expertise today is rich (`server/src/agent/expertise.ts`: 8 dept personas, ~50 task
standards, 9 reusable archetypes, UAE legal/tax domain packs) BUT it only fires when the user
picks a department "play" — `session.task` is set only from the request body
(`routes/sessions.ts:68`). A user who just **types** sends `task: null` →
`expertiseFor(null)` → **no expertise injected** → the generic agent. Meanwhile
`classifyTask()` (`taskProfile.ts`, called at `runner.ts:427`) already reads free-form text
but only infers *deliverable shape*, not *domain expertise*. Closing that gap — and making
expertise consistently extensible — is this program.

---

## 1. Goals & success metrics

**Primary goals**
1. **Zero-pick expertise**: a free-form message gets the correct expertise automatically.
2. **Consistent extension**: adding an expertise is a filled-in template guarded by tests,
   not hand-edits across two files that drift.
3. **Coverage for "everyone"**: not just B2B departments — personal/everyday life too.
4. **Efficiency**: load only the relevant expertise per turn (helps the report token cost).
5. **Robustness**: never break the deterministic play path; degrade gracefully when unsure.

**Success metrics (tracked live — metadata only)**
- **Auto-select hit-rate** ≥ 85% on a fixed 30-prompt benchmark (operator-graded).
- **Mis-route rate** (wrong expertise fired) ≤ 5%.
- **Free-form expertise coverage**: % of real sessions that get a non-null task ≥ 80%.
- **No regression**: every existing play produces the same or better output.
- **Report token cost** down ≥ 30% after Phase 5, quality unchanged.

---

## 2. Principles & guardrails (apply every phase)

- **Deterministic-first.** A picked play always wins; auto-routing only fills the `null` case.
  Never trade away the reliable path.
- **Feature-flag every phase** (`config.ts`), default OFF, flip ON only after the operator
  live-test passes. Instant rollback = flip the flag.
- **Quality bar is sacred.** Aesthetics + correctness + cite-don't-fabricate unchanged.
- **Privacy.** The classifier reads the user's own message in-run; we persist only the
  resulting **task key + confidence + source** as analytics metadata (never message content),
  per the existing `analytics/track.ts` allowlist rule.
- **Latency budget.** The LLM tie-break runs ONLY on ambiguous free-form, on the fast
  non-thinking model, one call. Trigger-table matches cost nothing.
- **Gate before every deploy**: `npm run typecheck && npm test && npm run build` green.

---

## 3. The Loop (the methodology used in EVERY phase)

```
┌─ BUILD ──────────────────────────────────────────────────────────────┐
│ implement behind a feature flag (default OFF)                         │
└──────────────────────────────────────────────────────────────────────┘
        ↓
┌─ SELF-VERIFY (automated, in-sandbox) ────────────────────────────────┐
│ typecheck + unit tests + build; new tests for the phase;             │
│ where visual: rasterize/Playwright; classifier: a fixed benchmark    │
└──────────────────────────────────────────────────────────────────────┘
        ↓ commit + push → auto-deploy (~2 min) → flag ON for the operator only
┌─ OPERATOR LIVE-TEST (on arksai.studio) ──────────────────────────────┐
│ operator runs the phase's TEST MATRIX; grades each case pass/fail;   │
│ instrumentation shows inferred task + confidence per run             │
└──────────────────────────────────────────────────────────────────────┘
        ↓
   pass ≥ exit criteria? ── NO ──► DIAGNOSE → FIX → redeploy → re-test (bounded: 3 rounds,
        │                          then escalate to operator with options)
        YES
        ↓
   flip flag ON for everyone → record baseline metrics → NEXT PHASE
```

A **continuous metrics loop** runs across all phases: every auto-route logs
`{task, confidence, source}`; the operator console surfaces hit-rate + the top misses; each
miss becomes a new trigger phrase or a new expertise (Phase 2/3 feed). This is how the system
keeps getting smarter from real use.

---

## 4. Sequencing & dependencies

```
Phase 1  Trigger-aware registry + auto-router (the UX unlock)         ── biggest win
   └─► Phase 2  Single source of truth + extension template + tests   ── harden consistency
          └─► Phase 3  Personal/everyday expertise family              ── coverage for "everyone"
                 └─► Phase 4  Confidence → clarify + persona fallback  ── robustness
                        └─► Phase 5  Progressive disclosure            ── efficiency
```
Phase 1 ships the win fast (server-side triggers, minimal). Phase 2 then unifies properly so
scaling coverage (Phase 3) stays consistent. 4 and 5 are robustness + efficiency on the stable
base. Each phase is independently shippable and flag-gated.

---

## PHASE 1 — Trigger-aware registry + auto-expertise router

**Goal:** a user who just types gets the right expertise automatically; the picked-play path
is untouched.

**Deliverables**
- Add a `triggers: string[]` (keywords/patterns/example phrases) to each task in
  `expertise.ts` (server-side, minimal — full unification is Phase 2).
- New `routeExpertise(userText, mode)` (e.g. `server/src/agent/expertiseRouter.ts`):
  1. trigger-table match (deterministic) → best task key;
  2. on ambiguity/low score, ONE fast non-thinking LLM classify call → task key + confidence;
  3. return `{ taskKey | null, confidence, source: 'auto' }`.
- Wire into `runner.ts` start: if `session.task` is null and mode is chat/code/report, call
  `routeExpertise`, set the inferred task for this run (persist to session, survives turns +
  `switch_mode` like the existing flow at `runner.ts:638`).
- New analytics event `expertise_selected {task, confidence, source}` via `analytics/track.ts`.
- Flag: `EXPERTISE_AUTOROUTE` (default OFF).

**Self-verify**
- `expertiseRouter.test.ts`: a fixed **30-prompt benchmark** (plain user phrasings → expected
  task key) asserts the deterministic matcher hits ≥ 85% without the LLM call; no collisions.
- Full gate green.

**Operator live-test (arksai.studio) — TEST MATRIX A**
Type each as a NEW chat (no play picked); confirm the output reflects the named expertise:

| # | Type this | Expect expertise | Pass criteria |
|---|---|---|---|
| 1 | "make me a monthly budget for a family of four in Dubai" | `finance.budget` | live formulas (not hardcoded), AED format, assumptions + totals |
| 2 | "should I buy a 2019 Cayenne at 200k km — buy and resale price" | research/valuation | cites real listings, no fabricated figures, buy/sell ranges |
| 3 | "write a job description for a backend engineer" | `people.jd` | inclusive language, task-based reqs, marked placeholders |
| 4 | "competitor teardown: Notion vs us" | `marketing.competitor` | side-by-side, "where we win", cited |
| 5 | "a pitch deck for my coffee startup" | `sales.pitchdeck` | takeaway-headline slides, problem→ask arc |
| 6 | "cash-flow forecast for next 12 months" | `finance.cashflow` | opening→closing cash, formula-driven, runway |
| 7 | "dashboard of these sales numbers [paste]" | `bi.dashboard`/`finance.kpidashboard` | F-pattern, 5–7 KPIs, headline takeaway |
| 8 | "explain how mortgages work to a beginner" | research/explainer | plain, structured, sourced |

The operator grades each ✅/❌. Instrumentation (console) shows the inferred task + confidence
so misses are visible.

**Exit criteria:** ≥ 7/8 matrix cases correct AND no existing play regressed (spot-check 3
plays) AND benchmark ≥ 85%. → flip `EXPERTISE_AUTOROUTE` ON, record baseline hit-rate.

**Iterate loop:** each ❌ → add/adjust trigger phrases (or fix the classify prompt) → redeploy
→ re-run only the failed cases. Bounded to 3 rounds before escalating options to the operator.

**Rollback:** flag OFF → instant return to today's behavior.

---

## PHASE 2 — Single source of truth + extension template + sync tests

**Goal:** adding an expertise is a safe, consistent, template-driven act; the play catalog and
the server standards can never drift.

**Deliverables**
- A unified manifest in `shared/` (or generate both sides from one registry): each expertise =
  `{ id, department, label, description, triggers[], archetypes[], standard, deliverable,
  modelFloor?, domainPack? }`. `client/lib/departments.ts` (plays) and `server/expertise.ts`
  (standards) both derive from it — no more "keys must match" by hand.
- An **authoring template** (`EXPERTISE_AUTHORING.md`): the checklist to add one (pick dept →
  description → triggers → compose archetype(s) → write only the task delta → deliverable +
  model floor → golden example).
- **Sync/collision tests**: every play has a standard AND triggers; every standard maps to a
  play; no orphan keys; triggers don't ambiguously collide. CI fails a half-added expertise.

**Self-verify:** gate green + the new sync tests; a migration diff showing all ~50 existing
expertises round-trip identically (no wording lost).

**Operator live-test — TEST MATRIX B (regression-focused)**
- Pick **5 existing plays** across departments → confirm output quality is **identical or
  better** (no wording dropped in the migration).
- Re-run **3 cases from Matrix A** → auto-routing still works on the unified registry.
- The operator adds **one trivial new expertise** with me (e.g. `personal.complaintletter`
  via the template) → it appears as a play AND auto-routes from "write a complaint letter
  about a faulty product" — proving the template + single-source works end to end.

**Exit criteria:** zero regressions on the 5 plays; the operator-added expertise works on both
paths; sync tests green. → proceed.

**Iterate loop:** any dropped nuance → restore from the migration diff → re-test that play.

---

## PHASE 3 — Personal / everyday expertise family ("everyone")

**Goal:** ArksAI is genuinely for non-business users, not just departments.

**Deliverables (new expertises via the Phase 2 template)** — prioritized must-haves:
- **Personal finance**: budget, savings/debt plan, **big-purchase valuation & comparison**
  (car/home/product — the Porsche case becomes a first-class expertise).
- **Personal writing & admin**: résumé, cover letter, complaint/dispute letter, personal
  statement, formal letter, email rewrite/polish.
- **General research & answering**: the chat-level "answer well, with sources" expertise.
- **Learning & explainers**: study guide, concept explainer, summarize-this-document.
- **Life & events**: trip itinerary, event/party plan, checklist.

Each carries triggers so it auto-routes. Add to the catalog as an optional "Personal" lane.

**Self-verify:** template-conformance tests for each; benchmark expanded with ~10 personal
prompts; gate green.

**Operator live-test — TEST MATRIX C (personal, free-form)**

| Type this | Expect | Pass criteria |
|---|---|---|
| "help me build a résumé, I'm a marketing manager" | personal.resume | clean ATS-friendly doc, strong bullets, placeholders |
| "write a complaint letter — airline lost my bag" | personal.complaintletter | firm polite tone, facts, ask, escalation |
| "plan a 5-day Tokyo trip for a couple, mid-budget" | personal.trip | day-by-day, realistic, costs flagged not fabricated |
| "value my iPhone 13 Pro for resale in UAE" | personal.valuation | cited comparables, range, condition factors |
| "explain compound interest to a 15-year-old" | learning.explainer | plain, example-led, accurate |
| "summarize this contract [paste]" | learning.summarize | faithful, structured, flags uncertainties |

**Exit criteria:** ≥ 5/6 correct expertise + quality; operator confirms it "feels like it just
knows what I want." → proceed.

**Iterate loop:** misses → trigger tuning or a new personal expertise (the metrics loop feeds
this from real usage too).

---

## PHASE 4 — Confidence → clarify, and graceful persona fallback

**Goal:** when ArksAI isn't sure, it behaves like a thoughtful expert — asks ONE crisp
question or falls back to the department persona — never blind-guesses or refuses.

**Deliverables**
- Confidence thresholds in `routeExpertise`: high → fire silently; medium → fire the
  **department persona alone** (still expert voice, no wrong task specifics); low → emit ONE
  short clarifying question (reuse the existing chat "vague → ask first" pattern) then route on
  the reply.
- Never inject a wrong task on low confidence (mis-route guard).
- Flag: `EXPERTISE_CLARIFY`.

**Self-verify:** unit tests for the threshold branches; benchmark mis-route rate ≤ 5%.

**Operator live-test — TEST MATRIX D (edge cases)**

| Type this | Expect | Pass criteria |
|---|---|---|
| "make me something nice" | ONE clarifying question | asks what/for whom; doesn't guess or refuse |
| "help with my thing tomorrow" | ONE clarifying question | narrows scope politely |
| "I run a bakery, need to look more professional" | persona fallback + clarify | marketing persona voice + a focusing question |
| a clearly off-catalog ask | graceful generic + persona | competent, never "I can't help with that" |

**Exit criteria:** vague prompts get exactly one good question (not a blind build, not a
refusal); no confident mis-routes in the matrix. → flip flag ON.

**Iterate loop:** over-asking (annoying) or under-asking (wrong guess) → tune thresholds →
re-test the 4 cases.

---

## PHASE 5 — Progressive disclosure (context / token efficiency)

**Goal:** load only the matched expertise + the relevant protocol slice per turn, cutting the
per-turn fixed cost (the report token problem) with no quality loss.

**Deliverables**
- Split the monolithic prompt (`prompts.ts`, 722 lines) into a slim always-on core + on-demand
  slices (report page-mechanics, charts, design-system, legal); load a slice only when the
  mode/task needs it, and **evict** it when its phase is done (cousin of `trimStaleResearch`).
- The registry (Phase 2) is the loader's source: an expertise declares which slices it needs.
- Flag: `EXPERTISE_PROGRESSIVE`.

**Self-verify:** a token-accounting test (a representative report build draws fewer prompt
tokens with the flag ON than OFF); rasterized output identical quality; gate green.

**Operator live-test — TEST MATRIX E (efficiency + quality)**
- Run the **same report** (e.g. the Porsche brief) with the flag ON. Confirm via the cost bar /
  analytics: **token count down ≥ 30% vs the recorded baseline**; rasterized pages show the
  same section-per-page, full-bleed cover, charts — **no quality regression**.
- Run one app build + one deck → confirm no behavior change.

**Exit criteria:** ≥ 30% token reduction on the report path AND no quality/behavior regression
across report/app/deck. → flip flag ON.

**Iterate loop:** a missing slice (a rule didn't load when needed → a defect appears) → adjust
the expertise's declared slices → re-test that path.

---

## 5. Instrumentation (so "does it work?" is answerable, not guessed)

- `expertise_selected {task, confidence, source}` on every run (Phase 1).
- Operator console panel: auto-select **hit-rate**, **top mis-routes**, **free-form coverage
  %**, **report token trend** (ties to the existing analytics system; metadata only).
- A fixed **benchmark suite** (grows each phase) is the regression net for the classifier.
- The **metrics loop**: real misses → new triggers / new expertises, continuously.

## 6. Risks & mitigations
- *Classifier latency/cost* → trigger-table first; LLM only on ambiguity; fast model.
- *Mis-routes hurting trust* → confidence gating (Phase 4) + persona fallback; flags for
  instant rollback.
- *Registry migration dropping nuance* → migration diff + round-trip test (Phase 2).
- *Refactor risk on live system* → every phase flagged, operator-tested before global ON.

## 7. Definition of done (program)
All five flags ON globally; benchmark hit-rate ≥ 85%, mis-route ≤ 5%, free-form coverage ≥
80%, report tokens down ≥ 30%, zero play regressions — and the operator can add a new expertise
from the template in minutes and watch it auto-route on the live server.
