# Robots — implementation plan (v1)

How we add the agentic "Robots" feature to ArksAI so it is **simple to set up, simple to run, and
lands quality every single time**. Grounded in `ROBOTS_RESEARCH.md`. The governing rule:
**an agent that is live on the platform must execute flawlessly — or it isn't live.**

---

## Build log
- **Hire-flow polish — DONE (branch `claude/pensive-feynman-ugt30p`, 2026-06-21).** Built per the approved
  plan below. Wizard `Robots.tsx Hire`: kind-first (Customer/Personal/Specialist→dept grid) → teach
  (name/mandate/knowledge/escalation/signature) → connect-first-but-skippable per-robot `EmailSettings` step
  (robot created PAUSED, then Activate, or "connect later" stays paused) → autonomy/triggers. `robotsStore`
  passes the real `role` (not hardcoded custom) + dept/knowledge/escalation/signature in config; created
  paused (draft→UI 'paused'). Backend: `departmentPersona()` exported from `expertise.ts` + folded into
  `reply.ts buildSystem` for `custom`+dept specialists; `mailboxReady` added to the Robot API (correlated
  subquery, SQLite/PG-portable) → roster shows "⚠ Needs a mailbox", office Mailbox panel shows
  connected/needs-setup. 458 tests (added persona-fold + mailbox-less-on-create). Typecheck/build/boot clean.
- **Hire-flow polish — PLAN (approved 2026-06-21).** Two gaps to close: the Hire flow doesn't prompt to
  connect a mailbox, and every console robot is hardcoded `role:'custom'` (the customer-vs-personal reply
  persona is never used). Approved design: (1) **Kind-first wizard** — step 1 picks Customer assistant /
  Personal assistant / Department specialist (→ backend `role` customer_service/personal_assistant/custom);
  Specialist reveals the existing department grid for accent + expertise. (2) **Teach** — name, mandate,
  knowledge, escalation, signature. (3) **Connect-first but skippable** — an inline per-robot `EmailSettings`
  step; create the robot **paused** first (so it has an id for `/robots/:rid/email`), connect+test, then
  Activate; "connect later" leaves it paused (the poller already skips mailbox-less robots). (4) autonomy +
  triggers. Backend: pass `role` through (not hardcoded); export `DEPARTMENT` personas from `expertise.ts`
  and fold the department persona into `reply.ts buildSystem` for specialists; add `mailboxReady` to the
  Robot API so the roster/office show "connected ✓ / needs setup."
- **Unification with main's Robots console — DONE (branch `claude/pensive-feynman-ugt30p`).** Main had grown
  a polished but **backend-less** full-page Robots console (`Robots.tsx` + client-only mock `robotsStore`,
  department-agent framing). Merged main in and made that console the **single Robots UI, backed by my real
  engine**: rewired `state/robotsStore.ts` to call `/api/orgs/:id/robots` (+ drafts), mapping my backend
  Robot ↔ the console's UI `Robot` (autonomy ask_all/ask_big→`ask`, autonomous→`auto`; dept/mandate/triggers
  stored in `config`; **pending drafts → the "Needs You" approvals**, Approve&send→`sendDraft`, Dismiss→
  `dismissDraft`). `Robots.tsx` loads on open + hires async; my standalone `RobotsDialog` retired. Kept
  main's connectors `ConnectionsPanel` + my `EmailSettings` as two Admin tabs. 455 tests green; typecheck +
  build clean; server boot-verified. Conflicts resolved across app.ts/config.ts/App.tsx/AdminDialog/
  WhatsNew/theme.css. **Gap (follow-up):** the Hire flow doesn't yet prompt to connect a mailbox (do it in
  Settings → Email); a "connect a mailbox" hint in the console + the customer/personal email-role picker are
  the next polish. Every console robot is currently a `custom` email agent grounded in its mandate.
- **Email robot · Stage 2 — DONE (branch `claude/pensive-feynman-ugt30p`).** The first real Robot, built on
  Stage 1. New: `robots` + `robot_drafts` tables; `robots/store.ts` (CRUD + drafts, org-scoped, idempotent
  per inbound Message-ID); `robots/reply.ts` (the §5c engine — data-minimized single-message context,
  persona by role, **locked-recipient** + injection-resistant system prompt, strict-JSON escalation signal,
  and the **M3-vs-DeepSeek-v4 bake-off**: `compare` runs both); `robots/poller.ts` (durable 60s tick →
  reads unseen mail → drafts per new message → `ask` leaves it pending, `auto` sends locked to sender;
  booted in index.ts); `routes/robots.ts` (org-member-gated CRUD + `/preview` bake-off + draft
  send[recipient locked to stored to_addr]/edit/dismiss). Client: sidebar **Robots** → `RobotsDialog.tsx`
  (onboarding **connects mailbox first** → pick role [customer_service/personal_assistant/custom] → teach
  [persona/knowledge/escalation/signature] → model + autonomy → preview/bake-off → activate; + a **Drafts
  inbox** with approve&send/edit/dismiss/compare). 265 tests (5 new: store CRUD+cross-org isolation,
  idempotency+recipient lock, escalation status, buildSystem injection/lock, parseReplyJson). Typecheck +
  build clean; server **boot-verified** (tables create, poller starts, route auth-gated). **NOT yet
  live-verified:** real model drafting + real send/receive need keys + a mailbox on the Droplet. Personal-
  assistant **ICS invite accept/decline** is natural-language only for now (true iCal REPLY = follow-up).
- **Email channel · Stage 1 — DONE (branch `claude/pensive-feynman-ugt30p`).** Per-org mailbox (SMTP+IMAP),
  the first external channel. New: `lib/crypto.ts` (AES-256-GCM secrets at rest), `org_email_accounts`
  table, `email/accounts.ts` (store; passwords write-only, decrypt server-side only), `email/client.ts`
  (nodemailer send + imapflow/mailparser read + `verifyAccount` connection test), tools `send_email`
  (+workspace attachments) / `read_inbox` (org-scoped via `ctx.session.orgId`), `routes/email.ts`
  (org-admin-gated CRUD + test), client `EmailSettings.tsx` (Settings → Email tab). 260 tests
  (6 new: crypto round-trip/tamper, encrypted-at-rest, keep-existing-password, auto-reply filter).
  Send/receive code paths smoke-verified (graceful ECONNREFUSED); LIVE send/receive needs real creds on
  the Droplet. **NEXT — Stage 2:** KB-grounded auto-reply with the §5c locked-recipient/data-minimized
  pattern + the M3-vs-DeepSeek-v4 bake-off.

---

## 0. Non‑negotiables (what "good" means here)
1. **Simple core.** No connector setup, no workflow-building, no config to get a robot working. Hire →
   confirm mandate → it runs. Behind the scenes it reuses the engine that already works.
2. **Quality is a blocking gate, not a hope.** Nothing is delivered, shown as "done," or sent unless it
   passed an automated quality check. Same guarantee as the rest of ArksAI ("looks perfect, works
   perfectly"), now applied to autonomous runs.
3. **Flawless or not live.** A robot *type* ships to users only after it passes a golden edge‑case suite.
   A robot *instance* starts in draft mode and earns autonomy. No exceptions.
4. **Broad external autonomy, certified channel‑by‑channel.** Robots can act across many channels —
   internal posts, outbound email, CRM writes, social marketing, CRM/app‑driven auto‑replies, customer
   service, WhatsApp, publish. Each ships behind its own certification + earned trust, governed by universal
   invariants (admin‑allowlisted destinations, taint‑breaks‑egress *or* the data‑minimized reply pattern,
   injection cert, caps, audit, instant revoke). The lethal trifecta is broken on every autonomous action by
   construction (see §5b–5d). Spend/delete/public carry the highest bar and graduate one named action at a
   time, never by default.
5. **Bounded & recoverable.** Every run has step/time/token/cost caps and a tool allowlist; all state is
   durable and recovers on reboot. A stuck robot is surfaced loudly and can be killed.

---

## 1. The core insight (why this won't fall into bad execution)
**A robot run is NOT a new execution engine. It is a normal ArksAI session run, with a mandate, wrapped in
a durable trigger + an approval gate.** We already run sessions to a quality bar flawlessly; robots reuse
that exact path. We invent almost no new fragile machinery.

**Reuse map (verified seams):**
| Robot need | Reuse this existing, proven code |
|---|---|
| Start a run programmatically | `manager.startRun(sessionId, prompt)` (`sessions/manager.ts:13`), as the scheduler already does |
| Spawn the run's workspace/session | `store.createSession({...})` (`sessions/store.ts:67`) — the scheduler's pattern (`schedule/scheduler.ts:187`) |
| Durable time trigger | the scheduler (`schedule/scheduler.ts` — `computeNextRun` + `tick` + spawn) |
| Event/webhook trigger | the PR-activity wake pattern (the runner already wakes on external events) |
| Boot recovery of durable state | `recoverDeployments()` (`deploy/registry.ts:89`) — mirror it for robots |
| **Quality gate (the must-have)** | `runVerifyGate` (`agent/runner.ts:754`), `runReportGate` (`:765`), `deliverableCheck.ts` |
| Durable pause for approval | generalize `setAwaitingPlan(id, awaiting)` (`sessions/store.ts:136`) — the plan-gate already pauses a run |
| Per-department expertise/persona | `agent/expertise.ts` (already injects per-task standards by `task` key) |
| Interrupt / kill | `manager.interrupt(sessionId)` (`sessions/manager.ts:39`) |
| Plain-language activity | the session timeline (`store.appendTimeline` / `getTimeline`) |
| The whole UI shell | already built — `client/src/components/Robots.tsx`, `lib/robots.ts`, `state/robotsStore.ts` |

Net new code is small: 3 tables, a thin **run executor** (robot → session mapping), a **durable pause**
generalization, **boot recovery**, the **certification harness**, and the API/client wiring to real data.

---

## 2. Data model (minimal; dual-driver SQLite/PG, epoch-int dates per repo rule)
- **`robots`** — `id, orgId, role(deptId), name, mandate, status, autonomy('shadow'|'ask'|'auto'),
  triggers(json), caps(json: maxSteps/maxMs/maxUsd), enabled, certifiedTypeVersion, createdBy, createdAt,
  lastRunAt`.
- **`robot_runs`** — `id, robotId, orgId, sessionId, trigger, status('queued'|'running'|'awaiting_approval'|
  'delivered'|'error'|'killed'), startedAt, finishedAt, costUsd, summary, deliverables(json), gateResult(json),
  tainted(bool)`. `tainted` flips true the moment the run reads untrusted content (web fetch, inbound email,
  externally-sourced upload) — and a tainted run can never autonomously take an external action (§5b). Each
  run owns a real session (full reuse of workspace, timeline, export, canvas).
- **`robot_grants`** — per‑robot, per‑action‑type autonomy ledger: `robotId, actionType, dest(allowlisted
  destination id), mode('ask'|'auto'), cleanApprovals(int), certVersion`. A grant goes `auto` only after the
  action type is certified AND the robot earned it (N clean approvals) AND a destination is allowlisted.
- **`robot_approvals`** — `id, robotId, runId, orgId, kind('deliver'|'external_action'|'question'),
  title, why, draftRef, options(json), status('pending'|'approved'|'edited'|'rejected'), resolvedBy, resolvedAt`.

Org-scoped exactly like sessions (`scoped()` / `orgId != null`), so isolation is inherited, not re-built.

---

## 3. Run lifecycle (one small state machine)
```
trigger fires ─▶ create run + session ─▶ startRun(mandate+expertise, bounded)
                                              │
                          ┌───────────────────┼─────────────────────┐
                     gate PASS            gate FAIL (≤N revise)   needs a decision
                          │                    │                     │
                 autonomy=shadow/ask?   already handled by      pause (durable) ▶
                          │             existing verify loop    drop approval card ▶
              ┌───────────┴─────────┐                           wait ▶ resume on
        external action?        internal only                   Approve/Edit/Reject/Answer
              │                      │
        pause → approve          deliver → journal + digest
```
Key points: the **existing verify/report gate already owns "fix it before done"** — we don't re-implement
quality, we *refuse to deliver* anything the gate didn't pass. "Pause" = the generalized `setAwaitingPlan`
durable flag; "resume" = `startRun` continues the session. Recovery on boot re-attaches `running` runs and
re-queues `awaiting_approval` ones.

---

## 4. The quality system — "lands quality every time"
Three layers, all blocking:
1. **Definition of Done per robot type** (machine-checkable success contract), built on `deliverableCheck.ts`.
   E.g. Finance board-pack: xlsx re-opens + is formula-driven (`auditFormulaModel`) + PDF renders with no
   blank pages + KPIs reconcile. A run that can't meet its DoD **pauses asking for what's missing** instead
   of delivering something weak.
2. **The existing gates** (`runVerifyGate`/`runReportGate` + vision QC) run unchanged on every robot run.
3. **No-deliver-on-fail rule:** `status='delivered'` is reachable *only* through a passing gate. On fail
   after the bounded revise rounds, the run goes to the inbox as "needs you," never to the user as done.

---

## 5. The safety system (so a live agent can't misbehave)
- **Taint‑aware egress (the trifecta breaker):** the run is marked `tainted` the instant it reads untrusted
  content. **A tainted run can never autonomously take an external action** — it must pause for a human. So
  the three dangerous legs (private data + untrusted input + external egress) can never co‑occur autonomously.
- **Autonomy ladder (per instance):** `shadow` (produces, never sends — default for every new robot) →
  `ask` (pauses before any consequential/external action) → `auto` (acts on routine; the taint check + a
  background safety re-gate still force approval for the always‑gated set below). Earned, not configured:
  after N clean approvals the UI offers the next rung — and only for action types that are certified.

## 5b. External autonomy — the channel roadmap (broad scope, certified one channel at a time)
Robots act across many channels: internal posts/writes, outbound email, CRM writes, social marketing,
CRM/app‑driven auto‑replies, customer‑service email, WhatsApp, public publishing. **All in scope.** They
ship as a **per‑channel certification roadmap** — each channel is a real tool that becomes autonomy‑eligible
only after it passes its own suite and the robot earns it. Until then it runs `ask` (drafts + pauses), so
the capability is usable from day one and goes hands‑free as it proves out.

**Universal invariants (apply to EVERY external action, autonomous or not):**
1. **Admin‑allowlisted accounts/destinations** — a human connects the Slack workspace, sending domain, CRM,
   social handles, WhatsApp number. Robots never invent a recipient/destination at runtime; autonomous
   sends go only to allowlisted targets (or, for replies, back to the inbound sender — §5c).
2. **Taint breaks egress by default** — a run that read untrusted content can't autonomously send, UNLESS
   the channel is certified for the data‑minimized reply pattern (§5c).
3. **Per‑channel injection + taint certification** in CI before any instance can go `auto` on it.
4. **Earned autonomy** — N clean human‑approved sends on that channel before `auto` is offered.
5. **Caps + full audit + instant revoke + global kill switch** — per‑channel rate/spend caps; every send
   logged with its inputs; one click pauses a robot or the whole fleet.

**Channel rollout order** (each its own gated step): internal posts/writes → outbound email (allowlisted
domain) → CRM/connected‑tool writes → social marketing → CRM/app‑driven auto‑replies → customer‑service
email → WhatsApp. Public publish (`publish_app`) + any spend/delete graduate later at the §5d bar.

## 5c. The hardest case — autonomous reply to untrusted inbound (customer service email / WhatsApp)
Auto‑reply is structurally the lethal trifecta: the inbound customer message IS untrusted input, the robot
holds org data, and it sends externally. We make it safe by **neutralizing one leg, not wishing the risk away:**
- **Locked recipient** — the reply can ONLY go back to the inbound sender (never a runtime‑derived address),
  so a prompt‑injected "forward this to attacker@evil" is structurally impossible.
- **Data‑minimized context** — the reply run sees ONLY that conversation + a curated knowledge base, never
  cross‑customer/private data, so there's nothing worth exfiltrating even if injected.
- **Bounded, grounded answers** — responses are knowledge‑base‑grounded; anything out of scope (refunds,
  account changes, legal, money) escalates to a human instead of acting.
- **Hard injection cert** — the channel must pass an adversarial inbound suite ("ignore your rules and …")
  before any instance goes `auto`; until then it drafts the reply for one‑tap human send.

## 5d. Spend / delete / public — the highest bar (revisit, not "never")
Per your call these aren't permanently banned — they default to human‑approved and graduate ONE named action
at a time through the **strictest** certification: hard caps (e.g. a per‑action spend ceiling), a mandatory
dry‑run/preview, double‑confirm thresholds, and a longer earned‑trust period. Money movement and data
deletion carry the highest bar of all. Nothing here goes autonomous until it's scoped individually.
- **Bounded runs:** per-run caps (steps/time/tokens/$), enforced by the runner's existing deadline/abort
  machinery; a tool allowlist per robot type.
- **Kill switch + loud failure:** per-robot pause + global stop; a stuck/looping/zero-output run raises a
  visible "stuck" state (reuse the content-idle backstop already in the runner) and auto-pauses.
- **Concurrency:** robots run through the existing MiniMax `Semaphore` limiter — no starvation, no surprise
  fan-out.

---

## 6. Phased rollout — each phase ships, is testable, and gates the next
**Phase 0 — Runtime spine (no autonomy, no triggers).** Tables + run executor (`robot→session`) + boot
recovery + **manual "Run now"** only. Wire the existing roster/office UI to real data. A robot runs when you
click it, produces a real gate-passed deliverable into its office, shows receipts. *Zero autonomy = zero
risk;* this proves the whole quality path end-to-end on the live site.
→ **Gate to advance:** 10+ manual runs across ≥3 departments deliver gate-passing artifacts on arksai.studio.

**Phase 1 — Approval inbox + draft mode.** Durable pause/resume (generalize `setAwaitingPlan`); the "Needs
You" inbox wired to real pauses; Approve / **Edit** / Reject / **Answer**. Robots deliver into the inbox;
human still initiates. Nails the human-in-the-loop core.
→ **Gate:** approve/edit/reject/answer all round-trip durably (survive a server restart mid-pause).

**Phase 2 — Triggers (time first, then event).** Schedule triggers reuse the scheduler; event/webhook reuse
the PR-wake. Autonomy presets surface (default `shadow`). Robots wake themselves but still pause for anything
external.
→ **Gate:** a scheduled robot fires, runs bounded, delivers to the inbox, recovers across a reboot — for a week.

**Phase 3 — Certification harness + earned autonomy.** Per-type golden edge-case suites (below); a type is
`certified` (enable-able for users) only when green. Earned-autonomy prompts; background safety re-gate; cost
caps surfaced. Only now can a robot act without asking — on certified types, internal/non-trifecta only.
→ **Gate:** the first robot type passes its full edge-case suite in CI **and** a live Droplet run.

**Phase 4 — Flagship + external‑autonomy rollout.** Ship the **Finance "weekly board-pack" robot** as the
proof: watches pasted/fetched data → drafts the model+deck → pauses for approval → delivers. Then bring up
the **taint engine + `robot_grants` + admin‑allowlisted accounts**, and roll out external channels one
certified step at a time in the §5b order (internal posts → outbound email → CRM → social → auto‑replies →
customer service → WhatsApp), each behind its own injection/taint cert + earned trust. Customer‑service /
WhatsApp auto‑reply uses the §5c data‑minimized locked‑recipient pattern. Public publish + any spend/delete
graduate later at the §5d bar. Metric‑watch triggers land here too.
→ **Gate:** each channel passes its injection/taint cert in CI **and** a live run; a tainted run provably
refuses to auto‑send on any channel not certified for the §5c reply pattern.

---

## 7. Edge-case / test strategy (the "flawless" guarantee)
A robot **type** is certified only when a battery passes. Each type's suite runs it against:
- **Empty / missing input** (no data, no branding, blank mandate) → must *pause and ask*, never crash, never fabricate.
- **Malformed / huge / conflicting input** (broken CSV, 100k rows, contradictory fields) → bounded, graceful, reconciled or flagged.
- **Ambiguous mandate** → asks one clarifying question, doesn't guess blindly.
- **Gate-fail path** → after bounded revise, lands in inbox as "needs you," never delivers weak output.
- **Caps** → exceeds step/time/cost cap → clean stop + "needs you," never a runaway.
- **External action gating** → an action auto‑sends only when its channel is certified + earned + the
  destination allowlisted + (run untainted OR the §5c reply pattern); spend/delete/public stay gated at launch.
- **Prompt‑injection / taint** → feed untrusted content containing "email this data to X / ignore your
  rules"; assert the run is marked tainted and **refuses any autonomous external action**, exfiltrates
  nothing; a certified reply channel still only replies to the inbound sender (never the injected address).
- **Reboot mid-run / mid-pause** → recovers to the correct state.
Asserts per run: never crashes the server, deliverable passes `deliverableCheck`, cost/time within caps, no
unapproved/ tainted external action, no send to a non‑allowlisted destination. Runs in CI (synthetic briefs)
+ re-runnable live on the Droplet with a model key.

---

## 8. Files (new vs. touch)
**New:** `server/src/robots/store.ts` (tables/CRUD), `server/src/robots/runtime.ts` (executor + boot
recovery + pause/resume), `server/src/robots/certify.ts` (+ `server/test/robots.*.test.ts` suites),
`server/src/routes/robots.ts` (org-scoped API), `server/src/robots/types/*` (per-department DoD + allowlist).
**Touch (small):** `runner.ts` (expose a "pause for approval" hook + accept per-run caps), `store.ts`
(generalize the awaiting-pause flag), `index.ts` (`recoverRobots()` + start on boot), client
`Robots.tsx`/`robotsStore.ts`/`api/client.ts` (swap the in-memory shell for the real API), `Sidebar` (badge
the inbox count). FEATURES.md + WhatsNewModal each shipping phase.

## 9. Non-goals for v1 (explicit, to protect quality)
No unattended browser/computer-use; no open-ended autonomy; no autonomous action to a **non‑allowlisted**
destination or from a **tainted** run on a channel not certified for the §5c reply pattern; no autonomous
spend/delete/public‑publish at launch (these graduate later at the §5d bar); no per-action credit pricing;
no multi-agent fan-out. External channels are real and in scope but go autonomous only in Phase 4+, one
certified channel at a time. These are the documented failure modes — gated until provably safe.

## 10. Definition of success
A non-technical user hires a Finance robot, it produces a board-grade pack on schedule, pauses for their OK,
and delivers — and across every edge case it either delivers flawlessly or cleanly asks for help, never
breaks, never sends without permission. That is the bar before any agent is "live."
