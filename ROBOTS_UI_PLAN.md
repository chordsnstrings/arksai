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

## Per-robot-type UI (the architecture you asked for)
- A robot **declares a `kind`/type**; the console picks a **view module** by type.
- **Email robot → Triage Inbox** (this doc).
- **Report/scheduled robot → Deliverables gallery** (what it produced, on a cadence; approve/share).
- **Marketing/ads robot → Campaign approvals** (spend/creative changes to approve).
- Shared chrome (header, settings gear, status, timeline) lives in the host; the type supplies the
  "needs you" + "detail" panes. Build the seam now even though only email is implemented.

## Phasing
- **P1 — Triage console (email):** escalations-first home + "all clear" proof-of-work state +
  ambient timeline w/ filter & "see all"; tap-to-respond detail with **chips + intent box +
  editable draft + Send**; settings moved behind a gear; default new email robots to auto+escalate.
  *(Client-heavy; backend: full `inbound_body` on drafts + the regenerate-from-intent endpoint.)*
- **P2 — Learning loop:** `robot_rules` + engine consults rules before escalating + a "What it
  handles itself" settings list. (The "gets quieter" payoff.)
- **P3 — Non-reply actions:** calendar accept/decline (iCal), snooze, forward-to-human, archive.
- **P4 — Type registry + notifications + optional undo-send:** generalize the per-type console;
  add an escalation notification; optional undo window on auto-sends.

## Safety guardrails (carry through every phase)
The current engine is deliberately **locked-recipient · data-minimized · single-message ·
certified** (§5c, trifecta-safe). Each addition widens that surface, so:
- Rules and intents are **grounding data**, never executable instructions; they can only widen
  auto-handling **inside the mandate**.
- Recipient stays **locked to the sender** except an explicit, gated, logged **Forward** to an
  **admin-allowlisted** address.
- Non-reply actions (calendar/forward) are **separately certified** per channel before going auto.
- Full-body/thread storage stays **minimal**; prefer fetch-on-open over persisting everything.

## Open questions for the operator
1. **Undo-send:** add a short (e.g. 10s) undo window on auto-sent replies? (cheap safety; you didn't
   select it — confirm in or out.)
2. **Thread depth:** fetch the **whole thread** on open (richer, more IMAP work) or just the **full
   current message body** (lighter, still a big step up from the snippet)?
3. **Rule autonomy:** when a learned rule matches, should it **auto-send** (quietest) or **draft +
   notify** the first few times until you trust it (safer)?
4. **Forward targets:** maintain an **allowlist of teammates** to forward to (admin-set), yes?
