# Meta Campaigns Robot — build plan (Facebook + Instagram ad automation)

Goal: a robot that **creates, launches, monitors, and optimizes** Facebook + Instagram
ad campaigns end-to-end from a plain-language brief — reusing ArksAI's creative engine,
robot framework, and the existing (read-only) Meta connector, with **hard money guardrails**
so it can never spend without an approval and a cap.

Governing rule (same as every robot): **flawless or it isn't live.** And because this spends
real money: **every campaign is created PAUSED, nothing goes live or has its budget raised
without an explicit owner approval, every account has a hard spend cap, every action is
audit-logged.**

## Current state (what we reuse, verified in-repo)

- `connectors/meta.ts` — Meta adapter: OAuth via Facebook Login for Business (`config_id`
  `2004716123621967`, app `980303688203652`), long-lived token, `fetchReport` (insights).
  Scope today = **`ads_read,business_management`** (READ only).
- `connectors/store.ts` — encrypted per-org tokens, `findForProvider`, `saveConnector`,
  now also `external_user_id` + the deletion callbacks.
- `connectors/types.ts` — the `Adapter` interface + `Connector`/`TokenSet`.
- `agent/tools/ads.ts` — `fetch_ads` (read insights, normalized table). **Reused as the
  robot's read/measure loop.**
- Robot framework: `robots/tasks.ts` (commander build lane), `robots/actions.ts` (gated
  HTTPS actions + approval), `robots/notify.ts` (owner pings + remote APPROVE/dictate),
  `robots/analytics.ts`, `schedule/scheduler.ts` (recurring), `robots/store.ts` (drafts).
- Creative engine: `generate_creative` (finished image+text+logo, hook variants),
  `generate_image` (text-free), `render_motion_video` / story video (for Reels).
- `client/src/lib/robotUseCases.ts` — the 7-job hire catalog (extend to an 8th job).

## Meta-side prerequisites (operator checklist — one-time)

1. **`ads_management`** added to the Facebook Login for Business configuration
   `2004716123621967` (App Dashboard → the config → Permissions). Keep `ads_read`.
   → the connect flow then returns a token with WRITE.
2. A **Business Portfolio** with: an **ad account** (funded payment method), a **Facebook
   Page**, and a **connected Instagram account** (linked to that Page).
3. **System User token** (recommended for unattended runs): Business Settings → System Users
   → create → assign the ad account + Page (admin) → generate a long-lived token with
   `ads_management,ads_read,business_management`. Stored encrypted like every secret.
4. Scope tiers: **own accounts in Development mode → no App Review** (build + run now). Only
   pointing at **clients'** accounts needs **App Review of `ads_management` + Business
   Verification + Marketing API Access Tier** (≥500 calls/15d, <15% errors).

## Design decisions (defaults — flip on request)

- **Scope now:** OWN ad account(s), Development mode. No App Review this phase.
- **Autonomy:** **approval-gated.** The robot proposes; the owner taps APPROVE (existing
  notify lane) before anything goes live or a budget moves. A later "autopilot within cap"
  mode is a config flag, off by default.
- **Objective coverage v1:** traffic / engagement / leads (Instant Form) / sales
  (conversions need a Pixel/CAPI — phase 4). Awareness + reach as simple extras.

---

## Phase 1 — Marketing API WRITE layer (connector)

New `server/src/connectors/metaCampaigns.ts` — pure request builders + thin I/O, mirroring
`meta.ts`. All calls `POST ${GRAPH}/act_<id>/...` with the write token.

Functions (each returns the created object id, or throws Meta's error message verbatim):
- `createCampaign(acct, token, {name, objective, specialAdCategories, dailyCapUsd})`
  → `/campaigns` (status ALWAYS `PAUSED`).
- `createAdSet(acct, token, {campaignId, name, dailyBudgetUsd, schedule, optimizationGoal,
  billingEvent, bidStrategy, targeting, placements})` → `/adsets` (PAUSED). **Instagram =
  `publisher_platforms:['facebook','instagram']` + `instagram_positions:[…]`.**
- `buildTargeting({geo, ageMin, ageMax, genders, interests, customAudienceIds})` — pure,
  unit-tested (this is where money is wasted if wrong).
- `createAdCreative(acct, token, {name, pageId, instagramActorId, creative})` — creative =
  a workspace image/video (uploaded via `/adimages` or `/advideos`) + primary text +
  headline + description + CTA + link. Reuses a `generate_creative` output file.
- `createAd(acct, token, {adSetId, name, creativeId})` → `/ads` (PAUSED).
- `updateStatus(id, token, 'ACTIVE'|'PAUSED')` — the ONLY path that turns spend on;
  gated behind approval + cap check at the tool layer.
- `updateBudget(adSetId, token, dailyBudgetUsd)` — gated behind approval + cap check.
- `duplicateAdSet` / `getDeliveryEstimate` (nice-to-have).
- Reads reuse the existing `fetchReport` (insights).

Adapter interface: add OPTIONAL write methods to `Adapter` in `connectors/types.ts` (Meta
implements; google/tiktok leave undefined) OR keep the write layer Meta-specific and call it
directly from the tools. **Recommendation:** Meta-specific module now (google/tiktok write is
a separate future arc), exposed via `connectors/index.ts` helpers.

Token source: extend `saveConnector`/`Connector` with a `token_kind` (`user`|`system`) so a
System User token can be stored per-org (superadmin endpoint `POST /api/admin/providers/
meta-systemuser {adAccountId, token}`, encrypted). The write layer prefers the system token.

Tests (`connectors/metaCampaigns.test.ts`, pure): campaign/adset/ad/creative request-shape
locks, `buildTargeting` (geo/age/interests → correct spec, IG placements present), status +
budget builders, "created PAUSED" invariant, USD→minor-unit conversion.

## Phase 2 — money guardrails + audit (the safety spine)

- New `campaign_actions` table (org-scoped, metadata only): id, org_id, robot_id, connector_id,
  action (`create_campaign`|`launch`|`pause`|`budget_change`), object_ids, requested_budget,
  status (`proposed`|`approved`|`executed`|`rejected`|`failed`), approved_by, ts. Backs the
  audit trail + the approval loop + the "what did it spend" report.
- Per-connector **spend caps** in config: `dailyCapUsd`, `campaignCapUsd`, `requireApproval`
  (default true). Stored on the connector row / robot config.
- Pure `guardCampaignAction(action, caps, todaySpend)` — throws on: launch without approval,
  budget above cap, daily projected spend over cap, missing Page/IG for an IG placement.
  Unit-tested with the money cases.
- Wire into `robots/notify.ts`: a `launch`/`budget_change` proposal pings the owner with the
  full plan (objective, audience, placements, budget, projected daily spend, the creative
  preview) → owner replies **APPROVE** (executes `updateStatus ACTIVE`) / **IGNORE** /
  free-text edit (adjust budget/targeting, re-propose). Exactly the existing draft-approval
  mechanism, extended to campaign actions.

## Phase 3 — agent tools (the robot's hands)

New `server/src/agent/tools/metaCampaigns.ts`, gated `available: () => providerAvailable('meta')
&& metaWriteConfigured()`, modes `chat`+`code` (so both the chat agent and a robot build
session can use them):
- `plan_campaign` — pure planner: brief → a structured campaign spec (objective, budget split,
  audience, placements incl. IG, ad count, creative briefs). Returns the plan for approval;
  writes nothing.
- `create_campaign` — executes an approved plan via the Phase-1 layer: builds the
  creative(s) (calls `generate_creative`), uploads media, creates campaign→adset→ad **PAUSED**,
  records `campaign_actions`, returns the object ids + a preview. Never launches.
- `launch_campaign` / `pause_campaign` / `set_budget` — the gated mutations (guard + audit +
  approval). `launch` is the only spend-on switch.
- `campaign_report` — thin wrapper over `fetch_ads` (spend/CTR/CPC/CPA/ROAS by ad) +
  deterministic optimizer suggestions (pause ads with CTR<x after N impressions, shift budget
  to the top ROAS ad) → proposals, not auto-executed (unless autopilot-within-cap is on).

Prompt steering (`prompts.ts`): a MARKETING/ADS block — "campaign asks → plan_campaign →
present for approval → create_campaign (paused) → launch only on approval; always name budget,
audience, placements; generate the creative, never placeholder; read performance with fetch_ads
before proposing changes."

Tests: tool registry lock, gating (no write token → honest error), the create→paused→launch
approval sequence source-locked, optimizer suggestion math.

## Phase 4 — the Campaigns robot (surfacing)

- `client/src/lib/robotUseCases.ts` — 8th job **`adsmanager`** ("Run your Facebook &
  Instagram ads"), group `make`, `replyTools:'commanders'`, capability chips (plan / create /
  launch-on-approval / optimize / weekly report), `postHire`: "Connect your Meta ad account
  under Settings → Connections; set a daily spend cap under Settings → Campaign limits."
- Hire flow: mounts the Connections panel (Meta) + a **Campaign limits** panel (daily/campaign
  cap, approval toggle) in step 3.
- New `client/src/components/CampaignLimits.tsx` + a small robot-ops panel showing live
  campaigns (status, spend today, CTR) with Pause/Approve buttons (reads `campaign_report`,
  writes go through the gated tools). Playwright-QA'd 1280+390.
- Commander bridge (`robots/tasks.ts`): "launch a campaign for X, AED 50/day, target UAE
  25–40 interested in fitness" → build session with the campaign tools → proposes → owner
  approves on their channel → launches. Weekly optimization via `schedule/scheduler.ts`
  (a `campaign` routine: pull performance → propose changes → ping owner).

## Phase 5 — conversions (later, needs Pixel/CAPI)

Sales-objective optimization needs a **Pixel + Conversions API** on the advertiser's site.
Add `create_pixel` / server-side CAPI event forwarding + `custom_conversions`. Deferred —
traffic/leads/engagement work without it.

---

## Verification

1. `npm run typecheck && npm test && npm run build` + new suites green.
2. Sandbox: pure builders + guardrails fully unit-tested (no Meta egress needed). Request
   shapes locked against Meta's documented Marketing API v21 schemas.
3. **Live on your own ad account (Development mode, no review):**
   - Reconnect Meta with `ads_management` → confirm the token carries write.
   - `plan_campaign` → `create_campaign` produces a real **PAUSED** campaign visible in Ads
     Manager (verify structure: campaign→adset with IG placement→ad→creative).
   - Approval flow: propose launch → APPROVE on channel → adset goes ACTIVE → confirm in Ads
     Manager → immediately pause; verify `campaign_actions` audit + cap enforcement (try to
     exceed the cap → blocked).
   - `campaign_report` returns live spend/CTR after a short run.
4. Screenshots of the created campaign + the robot's approval message sent to the operator
   (standing visual-QA rule).

## Money-safety invariants (must all hold, test-locked)

1. Every created object starts **PAUSED**.
2. `launch` / `set_budget` **require an approval** unless autopilot-within-cap is explicitly
   enabled, and **always** enforce the spend cap.
3. No IG placement without a linked Page + Instagram account (checked before create).
4. Every mutation writes a `campaign_actions` row (proposed→approved→executed).
5. The write token is never returned by any API or shown to the model.

## Scope / cost

- Phases 1–4 are the shippable robot (own-accounts, approval-gated). ~4 focused arcs.
- App Review + Business Verification is a separate track, only for the multi-tenant/client
  offering (Phase "go-to-market").
