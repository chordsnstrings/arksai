# Robots — competitive + scope research (2026‑06‑21)

Deep research (6 parallel angles, cross‑verified, cited) for ArksAI's agentic surface "Robots":
standing, role‑branded agents for NON‑TECHNICAL teams, organized by department, UAE focus.

> Confidence notes: Gartner (40% cancelled / ~130 real vendors), MIT (95% no P&L), MCP-as-standard,
> the lethal trifecta, and the Salesforce pricing reversal are corroborated across multiple angles =
> high confidence. Vendor ARR/valuations and browser-use benchmark scores are directional (discount
> vendor numbers ~15–20 pts). Re-verify exact prices before quoting to a customer.

## 1. The one-paragraph verdict
The agent market is splitting into (a) **dev/admin platforms inside a suite you already own** (Salesforce,
Microsoft, Google, ServiceNow, OpenAI, Anthropic, Amazon), (b) **no‑code builders that still hand the
USER a builder** (Lindy, Relevance, Zapier, n8n, Make, Cassidy, Dust…), and (c) **"AI employee" point
solutions** that mostly backlashed where they promised replacement (11x, Artisan) but win where the
outcome is verifiable and human‑escalated (Sierra, Decagon, Intercom Fin). **Nobody ships standing,
ready‑to‑run, per‑DEPARTMENT agents for a non‑technical SMB at a predictable price that produce a
FINISHED deliverable.** That is the white space — and it maps exactly to ArksAI's existing strengths.
Caveats are real: reliability is bounded, credentialed autonomy is a security minefield ("lethal
trifecta"), and 40% of agent projects get cancelled. So the design must be **bounded, human‑in‑the‑loop,
connector‑first, and honest** — which is the consensus of every reliability source.

## 2. Competitive landscape (master table)
| Category | Players | Built by | Pricing | Org principle | Gap for our buyer |
|---|---|---|---|---|---|
| Big-platform suites | Salesforce Agentforce, MS Copilot Studio, Google Gemini/Vertex, ServiceNow, OpenAI AgentKit, Anthropic Agent SDK, Amazon AgentCore/Q, Atlassian Rovo, HubSpot Breeze, Asana | Admins / developers | Opaque consumption (per-conversation $2, per-action $0.10, credits $0.01, tokens, vCPU-hr) + seat tax ($30/user) | The vendor's product surface (CRM/ITSM/cloud) | Useless if you don't live in that suite; needs IT; unforecastable cost |
| No-code builders | Lindy, Relevance AI, Cassidy, Stack AI (→Asana), Gumloop, n8n, Make, Zapier Agents, Beam, Bardeen, MindStudio, Dust, Lutra, Wordware | The user (you design the workflow) | Credits/tasks (Lindy $29.99+, Zapier $20 add-on, n8n €24, credit anxiety everywhere) | Generic horizontal OR a single function | You must BUILD the agent; branching logic is the cliff; no department structure |
| "AI employee" point | 11x, Artisan (sales); Sierra, Decagon, Intercom Fin (support); Devin (eng); Harvey (legal) | Vendor + heavy config | Mostly OUTCOME (Fin $0.99/resolution, Sierra/Decagon per-resolution) | One vertical | Single-function; replacement framing backlashed; enterprise-priced |
| Dev frameworks | LangGraph, CrewAI, AutoGen, OpenAI Agents SDK | Developers only | API tokens | n/a (code) | Not a product for non-technical teams |
| RPA + agents | UiPath, Automation Anywhere | RPA developers | Enterprise license | Process automation | Heavy, IT-led, not SMB |

## 3. What everyone gets wrong for a non-technical SMB (the white space)
1. **They hand you a BUILDER, not a finished worker.** Even "no-code" (Copilot Studio, Agent Builder, Lindy)
   assumes you design the workflow, connect data, write instructions, debug silent failures. The UI is rarely
   the hard part — the logic is. Non-technical users stall there.
2. **Nobody organizes by DEPARTMENT for non-technical buyers.** Incumbents organize by their product surface
   (CRM objects, tickets, Jira issues); builders are generic-horizontal or single-function. "Here's your
   Marketing robot, your Finance robot, ready to work" speaks the buyer's language — and is empty space.
3. **Pricing is unpredictable and anxiety-inducing.** Credits / per-action / per-conversation / tokens / vCPU-hr,
   stacked on seats. Salesforce *reversed* to seat-based (Dec 2025) because customers demanded predictability.
4. **Locked to a suite.** Every incumbent's value presupposes you already run Salesforce / M365 / GCP / ServiceNow.
   The non-suite SMB has no good option.
5. **Output is an answer or a workflow trigger, not a FINISHED deliverable.** Almost none produce the deck,
   report, model, app, or creative a team actually hands off. ArksAI already does.
6. **Agent-washing.** Gartner: only ~130 of thousands of "agentic" vendors are real; the rest rebadge chatbots/RPA.

## 4. Capability scope — what Robots can RESPONSIBLY promise in 2026
**Reliable today (promise it):**
- Structured **tool/API calls via MCP** (now the cross-vendor connector standard; Anthropic→OpenAI→Google→MS;
  donated to Linux Foundation Dec 2025). Far more reliable than browser use.
- **Verifiable** bounded tasks: code that compiles/runs (SWE-bench ~90%), a sheet that re-opens, a doc that renders,
  a published app that responds. ArksAI's verify-gate sits exactly in this sweet spot.
- **Single-agent + strong context + tools** as default; multi-agent only for read-heavy research (Anthropic's
  multi-agent beat single by 90% but at ~15× tokens; Cognition argues against it for build tasks).
- **Human-in-the-loop approval** before any consequential/irreversible action.

**Not yet (don't promise):**
- Unsupervised long-horizon autonomy. Error compounds (0.95^20 ≈ 36%); real multi-step office work
  (TheAgentCompany) succeeds only ~24–30%; τ-bench retail consistency pass^8 < 25%.
- Unattended **browser/computer-use** through logins/CAPTCHAs/payments (independent WebVoyager ~68% vs vendor 87%;
  OSWorld ~72%). Slow, expensive, high-variance.
- A standing agent that simultaneously holds **private credentials + ingests untrusted content + can send
  externally** = Simon Willison's **"lethal trifecta"** (EchoLeak/CVE-2025-32711, GitHub-MCP incident).
  "Guardrails won't protect you" — needs architectural constraints (quarantine, break a leg, human-gate egress).

**Adoption reality:** Gartner — >40% of agentic projects cancelled by 2027 (cost/value/risk). MIT — 95% of GenAI
pilots show zero P&L; root cause = the integration/learning gap, not model quality; **"buy" beat "build" ~2:1**;
back-office out-returned the sales/marketing tools that got the budget.

## 5. UX standard + the framing decision (our choices are validated)
**The converging 5-zone agent-management surface** (Lindy, Cursor, Claude Code, Sierra, Agentforce, Agent 365):
1. **Roster** — every agent as a card (job name, status, last result, owner) + a prominent **"needs you" count**.
2. **Approval inbox** — cross-agent queue; each item = plain-language *what + why + consequence* + **Approve /
   Edit / Reject / Answer**. Edit & Answer are first-class; hard Approve/Reject reserved for irreversible/spendy.
3. **Autonomy presets** (not a slider) — Read-only → Ask-first → Auto-with-guardrails; allowlist phrased as
   OUTCOMES ("can draft, can't send"; "can spend up to $X"); a background safety check re-gates only risky acts
   (Claude Code "auto mode").
4. **Audit = plain-language activity "receipts"**, not telemetry. Narrative timeline of steps + what data it
   touched + why. Hide spans/tokens behind "advanced."
5. **Async notify + daily digest** — interrupt only for decisions; digest the rest; surface "silent failures" loudly.

**Cross-cutting principles now standard:** monitor-and-intervene > approve-everything (Anthropic — over-gating
kills adoption); earned autonomy (start draft-only, graduate); transparency by default; a named human owner on
every agent/approval.

**FRAMING — the most decision-relevant finding:** HBR (May 2026, large experiment) — treating agents as
human "employees" (names/avatars/personas) **reduced accountability, raised unnecessary escalation, lowered
review quality, and did NOT improve adoption**; "accountability stays with the humans who deployed it." → Name
agents by **JOB/FUNCTION**, not a human. **Our "Finance Agent / Marketing Agent" (role-branded, no human names)
is exactly right, and the "Robots" name itself sets the correct non-human, accountable expectation.** The 11x
scandal (claimed customers it didn't have, massaged ARR) and Artisan's "stop hiring humans" reversal confirm:
**frame as a supervised teammate that does verifiable work, never a human replacement.**

## 6. Pricing recommendation
Evidence (Salesforce's reversal, Gartner on predictability, SMB trust>price data, Bessemer hybrid 27%→41%):
**hybrid, predictability-first, sold as outcomes.**
- **Flat per-team / per-department subscription** (NOT per-seat — an agent does 10× a seat; seat-pricing
  under-monetizes and mis-frames). Tiers by team count / included builds.
- **Generous included-usage allowance** so the invoice is predictable (the #1 SMB demand).
- **Transparent overage with caps / fair-use** (what every serious vendor actually does) — never a surprise bill.
- **Per-outcome add-on ONLY where the outcome is crisp** (a published live app, a filed/notarized document, a
  resolved request) — the one place outcome pricing works (Intercom Fin $0.99/resolution). Don't price fuzzy
  deliverables per-outcome.
- **Sell the outcome, price the predictability.** The real competitor is DIY (free ChatGPT/Copilot); win on
  "one finished, working thing — done for you," not on tokens. 81% of SMBs pay more for a *trusted* vendor.

## 7. Market + UAE beachhead
- **Market:** credible band **~$42–53B by 2030 (~42–46% CAGR)**; longer-horizon ($183–295B) figures inflated
  (~7× spread = assumption, not demand). The moat narrative is the failure rate (Gartner 40%, MIT 95%).
- **UAE = arguably the best beachhead globally for a gov-aligned bilingual SMB agent:** presidential mandate to
  move **50% of federal services to AI agents in 2 years**; **20% of non-oil GDP from AI by 2031**; **~14% of
  2030 GDP from AI (~$96B, highest share of any country, PwC)**; 94% of UAE enterprises call AI a growth driver;
  fast-growing SMEs + gov digitization programs; well-funded ecosystem (G42, Falcon, $5B GCC fund). Two moats
  US-default SaaS can't match: **eloquent bilingual Arabic** (ArksAI already has the UAE Legal department) and
  **UAE data residency/sovereignty** (a hardening 2026 buying requirement). Caveat: the mandate is gov
  aspiration, not booked SMB demand; gov-adjacent procurement is relationship- and sovereignty-gated and slow.
  Beachhead = UAE SMBs + gov-adjacent functions where bilingual + residency + "actually live/compliant" decide
  (Legal, Finance/compliance, HR, Marketing-in-Arabic).

## 8. Risks / honest limits to design around
1. **Reliability decays with steps** → bound every run (steps/time/token/tool allowlist); favor verifiable tasks.
2. **Lethal trifecta** → never let one agent hold private creds + untrusted input + external egress unsupervised;
   human-gate anything that leaves the building; quarantine web data from credentialed tools.
3. **Cost/latency ceilings** → cost caps + a "still working" UX so long runs don't look hung.
4. **Agent-washing backlash** → under-promise autonomy; prove verifiable delivery; honest logos/results.
5. **Trust > capability for non-technical buyers** → predictability, plain-language receipts, named human owner.

## 9. Recommended scope for Robots (the synthesis)
**Position:** "Give every team a standing teammate that does verifiable, finished work — with you in control."
Department-organized, ready-to-run (not a builder), produces real deliverables, predictable price, UAE-native.

**Build (MVP, in order):**
1. The **durable runtime**: a `robots` table + API, the standing-agent object (mandate · state journal ·
   triggers · budget · autonomy), supervised by a registry that resumes on boot (generalize `recoverDeployments`).
2. The **"Needs You" approval inbox** wired to real pauses (generalize the plan-gate): Approve/Edit/Reject/Answer,
   plain-language cards. This is the keystone.
3. **Triggers**: time + inbound webhook first (generalize the PR-activity wake); metric-watch next.
4. **Autonomy presets + a background safety re-gate**; **cost cap + audit receipts**.
5. Prove with **ONE real agent end-to-end**: the Finance "weekly board-pack" robot — watches data, drafts,
   pauses for approval, resumes, delivers. Exercises every primitive without betting the system.

**Deliberately DON'T (yet):** unattended browser/computer-use; open-ended autonomy; one agent with the full
lethal trifecta; per-action credit pricing.

**Differentiation, ranked:** (1) ready-made per-department agents (no workflow-building); (2) finished
deliverables, not chat/triggers; (3) predictable flat pricing; (4) honest, bounded, human-in-the-loop autonomy;
(5) UAE-native (bilingual + residency). The first two are the durable wedge; the rest are reinforcing.
