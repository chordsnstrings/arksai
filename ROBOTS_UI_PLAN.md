# Robots UI — triage-first redesign (email robots)

> Plan only. **No code.** Rethinks the Robots surface around how people actually work
> email: see only what needs you, resolve it by giving *intent* (not prose), let it learn
> so it gets quieter, and keep everything else ambient. Grounded in the current engine
> (`server/src/robots/*`, `client/src/components/Robots.tsx`, `state/robotsStore.ts`).

## Decisions locked (operator)
- **Default mode = auto + escalate.** New email robots send routine replies on their own and
  only escalate the hard ones → the console is a *quiet* inbox, not a review queue.
- **Tap-to-respond includes:** an **intent box** ("how should I respond?" → robot writes the
  reply) + **quick chips** (Accept / Decline / Ask for info / Forward) + an **editable draft**;
  a **learning loop** (a response can become a remembered rule → fewer future escalations); and
  **non-reply actions** (calendar accept/decline, snooze, forward-to-human, archive).
- Undo-send window: not selected; kept as a cheap optional safety add (see Open questions).

## Principles
1. **Empty is the goal.** A well-tuned robot rarely escalates. The home screen celebrates that
   ("Today: 14 handled · 0 need you") — proof of work, never a void.
2. **Intent, not prose.** The human gives a one-line direction or a chip; the robot writes the
   email. Never make the user draft the message.
3. **It gets quieter over time.** Every response is a chance to teach a preference, so the same
   kind of email stops escalating.
4. **Ambient awareness, on demand.** Everything the robot did is a calm timeline you can scroll
   if curious — not something you must act on.
5. **Set-and-forget config.** Mandate / autonomy / signature / mailbox / rules live behind a gear,
   not in your face.
6. **Per-type consoles.** Email robots get this triage inbox; other robot types declare their own
   view. The page is a host, the type supplies the view.

## The surface (email robot)
```
┌ Robot header: name · "checked 2m ago" · status · [⚙ settings] ─────────────┐
│ NEEDS YOU (only when non-empty)                                            │
│   • ⛔ Escalation cards, newest first (the ~5% it couldn't handle)          │
│   • ✎ Pending approvals below (rare in auto mode; from ask-mode robots)     │
│   …or… "✓ All clear — 14 handled today, nothing needs you"                  │
├ TIMELINE (ambient) ─────────────────────────────────────────────────────── │
│   compact rows: who · subject · Replied/Escalated/… · time   [filter][all] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### The escalation/approval card → detail (the core interaction)
Tapping an item opens a focused responder:
```
From: Arman Mahbub · "Need a meeting with you"          ⛔ escalated: scheduling
─ Full message + thread context ────────────────────────────────────────────
"We need to have a meeting with you to figure out how to focus…"
─ Respond ──────────────────────────────────────────────────────────────────
[ Accept ] [ Propose another time ] [ Decline ] [ Ask for info ] [ Forward to me ]
How should I respond?  ┌────────────────────────────────────────────┐  → Draft
                       │ say yes, propose Thu 2pm at our office      │
                       └────────────────────────────────────────────┘
┌ Draft (editable) ─────────────────────────────────────────────────────────┐
│ Hi Arman, happy to meet — does Thursday 2pm at our office work? …          │
└────────────────────────────────────────────────────────────────────────────┘
☑ Handle emails like this automatically from now on  (creates a rule)
                                              [ Dismiss ]   [ Send reply ]
```
- **Chips** pre-fill the intent + regenerate the draft (Accept → "accept and confirm"; Decline →
  "politely decline"; Ask → "ask for the missing detail"; Forward → routes to a human, see below).
- **Intent box** → the robot rewrites the draft from your one line. Editable after.
- **Learning toggle** → turns this resolution into a durable rule (next section).
- Recipient stays **locked to the inbound sender** (current safety invariant) unless the action is
  an explicit Forward.

## The learning loop (gets quieter over time)
- A resolved escalation can be saved as a **rule**: `{ when: "meeting/scheduling requests", then:
  "accept Tue/Thu, propose a time, cc nobody", scope: this robot }`. Stored per-robot.
- On the next inbound, the reply engine consults matching rules **before** escalating — if a rule
  covers it, it drafts/sends per the rule instead of escalating. Net effect: escalation volume
  trends to zero for things you've already taught.
- Rules are **editable/removable** in settings (a "What it handles on its own" list) so the user
  always sees and controls what it learned.
- **Safety:** a rule can only *widen auto-handling within the mandate*; it can never change the
  locked recipient, exfiltrate data, or act outside admin-allowlisted destinations (§5c). Rules
  are data the model is *grounded* on, not code it executes.

## Non-reply actions (what "respond" really means for a PA)
Beyond a prose reply, the responder offers (contextually):
- **Calendar accept/decline** — detect `text/calendar` invites → Accept/Decline/Propose → send a
  proper `METHOD:REPLY` (the iCal path already scoped in CLAUDE.md). The killer PA feature.
- **Snooze / "deal with later"** — defer an item to a time; it leaves Needs You and returns later.
  (Triage needs a third option beyond approve/dismiss.)
- **Forward to a human** — hand off to an admin-allowlisted teammate with a note (the one case the
  recipient lock is intentionally, explicitly broken — gated + logged).
- **Archive / do nothing** — acknowledge without replying.

## What this requires under the hood
1. **Full message body + thread on the draft.** Today a draft stores only `inbound_snippet`
   (`robot_drafts`) and the engine uses single-message context (§5c). The responder needs the full
   body and ideally prior thread messages → add `inbound_body` (+ optional thread fetch on open).
   Handle with care: store minimally, fetch-on-demand where possible to respect data-minimization.
2. **Rules store.** A `robot_rules` table (robot_id, when/pattern, then/instruction, created_at,
   enabled) + the engine consulting it in `reply.ts` before escalating.
3. **Actions on a draft.** Extend draft status/actions beyond pending/sent/dismissed/escalated to
   include `snoozed` (+ `snooze_until`), `forwarded`, `archived`; calendar reply as a send variant.
4. **A "regenerate from intent" endpoint.** Given a draft + a one-line instruction (or a chip),
   return a new draft — reuses `reply.ts`/`draftReply` with the instruction injected. Recipient
   stays locked.
5. **Per-type console registry (client).** `robotType → ConsoleView` so email = triage inbox and
   future types (report/ads/…) plug in their own surface instead of forking `Robots.tsx`.
6. **Settings behind a gear.** Move mandate/autonomy/signature/mailbox/escalation-rules/learned-
   rules into a settings panel; the main view is triage + timeline only.
7. **(Optional) undo-send + notifications.** A short undo window on auto-sends; a real notification
   when something escalates (badge exists; email/push next) so "only escalations" works without
   you remembering to check.

## Robot types — the scaffolding (designed up front, built in P1)
"Different kinds of robot" is not just a different UI skin — a type differs along **trigger,
runtime, console, detail, settings, hire flow, capabilities, and safety**. So we design a single
**type manifest** abstraction now and implement Email against it first; new kinds = add a manifest
+ a view module, never fork the page or the engine.

### The manifest (one declaration per robot type)
```ts
RobotType = {
  id: 'email' | 'scheduled' | 'ads' | 'monitor' | …
  label, icon, accent
  trigger:   'email-inbound' | 'schedule' | 'webhook' | 'connector-poll' | 'manual'
  runtime:   which server engine drives it (email → robots poller; scheduled → schedule
             scheduler; ads/monitor → connector/data poller). THIS is why "kinds" ≠ skin.
  capabilities: actions it may take (reply · calendar · forward · generate-report ·
             pause-ad · raise-alert …) — gates the detail view + the safety surface
  needsYou(orgId/robotId): how its "attention" set is computed
             (email → escalated+pending drafts; scheduled → failed runs / outputs to approve;
              ads → spend/creative changes to approve; monitor → firing alerts)
  timeline(): its ambient activity stream (email → handled mail; scheduled → past runs; …)
  ConsoleView, DetailView: the client panes the host mounts for this type
  settingsFields: which config it exposes (email → mandate/autonomy/signature/mailbox/rules;
             scheduled → cadence/format/recipients; ads → budget/accounts; monitor → source/threshold)
  hireSteps: the wizard steps for creating one
  safety: per-type certification requirements (§5c)
}
```

### The catalog (Email implemented first; others sketched against the same manifest)
- **Email assistant** `email` — trigger: inbound mail · runtime: robots poller · console: **Triage
  Inbox** (this doc) · needsYou: escalations + pending · detail: the responder. Persona variants
  (customer-service / personal-assistant / department-specialist) are the SAME type with a
  different mandate — they share this console. **[P1 — the reference implementation]**
- **Scheduled / report robot** `scheduled` — trigger: a cadence · runtime: the existing schedule
  scheduler · console: **Deliverables gallery** (what it produced, by run) · needsYou: failed runs
  or outputs awaiting approval · detail: preview + approve/share. ("Every Monday, email me a sales
  report.") **[future — maps onto `schedule/scheduler.ts`]**
- **Marketing / ads robot** `ads` — trigger: connector poll · runtime: ad connectors · console:
  **Campaign approvals** · needsYou: spend/creative changes to approve · detail: approve/edit.
  **[future — needs the ad connectors]**
- **Monitor / watchdog** `monitor` — trigger: poll a data source/webhook · runtime: data poller ·
  console: **Alerts feed** · needsYou: firing alerts · detail: acknowledge/act. ("Alert me if
  signups drop 20%.") **[future — maps onto `tools/data.ts`/webhooks]**

### Where the seam lives
- **Client:** a `robotTypes` registry (`type → { ConsoleView, DetailView, hireSteps,
  settingsFields, icon, label }`). `Robots.tsx` becomes a **host**: it resolves the active robot's
  type and mounts that type's panes inside shared chrome (header · ⚙ settings · status · the
  "needs you" + "timeline" layout). Email ships the first ConsoleView (Triage Inbox).
- **Server:** a parallel `robotType` registry declaring `trigger/runtime/capabilities/needsYou`.
  The poller stays the email runtime; a `scheduled` robot would be driven by the schedule engine,
  an `ads`/`monitor` robot by a connector/data poller. A robot row already carries `role` + a
  `config` JSON — add an explicit `type` (defaulting existing rows to `email`) so the host + engine
  route correctly.
- **Hire flow** becomes type-driven: pick a TYPE first (Email / Scheduled / Ads / Monitor — only
  Email enabled at launch), then that type's wizard steps. Today's customer-service / PA /
  specialist choice becomes the *persona* sub-step **inside** the Email type.

**Build the whole seam in P1** (manifest + registry + host + the `type` column) even though only
the Email ConsoleView is implemented — so adding `scheduled`/`ads`/`monitor` later is a manifest +
a view, not a refactor.

## Phasing
- **P1 — Type scaffolding + the Email triage console.** Build the **type manifest + registry +
  host seam + a `type` column** (existing robots default to `email`) up front, then implement the
  Email ConsoleView against it: escalations-first home + "all clear / N handled today" state,
  ambient timeline w/ filter & "see all"; tap-to-respond detail with **chips + intent box +
  editable draft + Send**; settings behind a ⚙ gear; hire flow becomes type→persona; default new
  email robots to auto+escalate. *(Client-heavy; backend: the `type` column, full `inbound_body`
  on drafts, the regenerate-from-intent endpoint.)*
- **P2 — Learning loop (email):** `robot_rules` + engine consults rules before escalating
  (**auto-send on match**) + a visible, one-tap-removable "What it handles itself" list in settings.
- **P3 — Non-reply actions (email):** **whole-thread fetch** on open, calendar accept/decline
  (iCal), snooze, **forward to an admin-allowlisted teammate** (`robot_forward_allowlist`), archive.
- **P4 — Second robot type + notifications:** implement one more type against the P1 manifest (the
  **scheduled/report robot** is the natural next, reusing the schedule engine) to prove the seam,
  and add an escalation notification (badge → email/push).

## Safety guardrails (carry through every phase)
The current engine is deliberately **locked-recipient · data-minimized · single-message ·
certified** (§5c, trifecta-safe). Each addition widens that surface, so:
- Rules and intents are **grounding data**, never executable instructions; they can only widen
  auto-handling **inside the mandate**.
- Recipient stays **locked to the sender** except an explicit, gated, logged **Forward** to an
  **admin-allowlisted** address.
- Non-reply actions (calendar/forward) are **separately certified** per channel before going auto.
- Full-body/thread storage stays **minimal**; prefer fetch-on-open over persisting everything.

## Resolved (operator, second pass)
1. **Rule autonomy → AUTO-SEND on a matched rule.** Once a rule exists, matching email is handled
   silently per the rule (quietest). Implication: rule creation is the trust gate, so the "create a
   rule" toggle must make the consequence explicit ("future emails like this will be answered
   automatically") and the learned rules must be visible + one-tap-removable in settings.
2. **Thread depth → WHOLE THREAD on open.** The responder fetches the full thread (not just the
   current body). Implication: an IMAP thread fetch on open (by References/In-Reply-To or Gmail
   thread id), shown as a collapsible history; keep storage minimal (fetch-on-open, don't persist
   the whole thread unless needed).
3. **Undo-send → NO.** Rely on escalation + the learned-rule trust gate + the Delivered log. (Auto
   mode sends immediately; the safety comes from rules being mandate-bounded + recipient-locked.)
4. **Forward → ADMIN ALLOWLIST of teammates.** Forwarding (the one case the recipient-lock is
   broken) targets an admin-set allowlist only — a new per-org `robot_forward_allowlist`, surfaced
   in admin settings; the responder's "Forward" picks from it. Never a free-form address.

All four are folded into the phasing: P2 (learning loop = auto-send + visible/removable rules),
P3 (whole-thread fetch on open; forward-to-allowlisted-teammate; calendar; snooze; archive).
