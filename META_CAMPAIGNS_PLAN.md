# Social Media Manager Robot — build plan (Facebook + Instagram: organic + engagement + paid)

Goal: a robot that runs a real social-media presence end-to-end — **publishes organic
content, replies to comments & DMs, and buys/optimises paid ads** — for Facebook + Instagram,
from a plain-language brief, reusing ArksAI's creative engine, robot inbound/reply engine,
scheduler, and Meta connector. Approval-gated, spend-capped, audit-logged.

A real campaign is THREE jobs, not one: **Publish (organic) · Engage (community) · Advertise
(paid)**, wrapped by listening/analytics. All three ride the SAME connector + robot spine.

Governing rule: **flawless or it isn't live.** Paid spend AND public posts/replies are
money- and brand-sensitive → **nothing goes public or spends without an approval (default),
a cap on paid, and an audit row.**

## Current state (reused, verified in-repo)

- `connectors/meta.ts` — Meta OAuth (Facebook Login for Business, `config_id`
  `2004716123621967`, app `980303688203652`), long-lived token, `fetchReport` (ad insights),
  `external_user_id` + deletion callbacks. Scope today = `ads_read,business_management` (READ).
- `connectors/store.ts` — encrypted per-org tokens; `findForProvider`, `saveConnector`.
- Robot inbound/reply engine — `robots/channels/inbound.ts` (`handleChannelInbound`:
  dedupe, ask/auto, escalate-not-guess, locked recipient), `robots/reply.ts`, personas +
  knowledge base (`robots/personas.ts`), notify/approve (`robots/notify.ts`), gated actions
  (`robots/actions.ts`), analytics, `schedule/scheduler.ts`. **Comment/DM handling reuses
  this wholesale — a Page is just another channel.**
- Creative engine — `generate_creative` (finished image+copy+logo, hook variants),
  `generate_image` (text-free), `render_motion_video` / story video (Reels).
- `agent/tools/ads.ts` `fetch_ads` — reused as the measure loop.
- File hosting — published-app URLs (`/apps/<slug>/`) + minted `robot-file` token links →
  the **public media URL** Instagram container publishing requires.
- `client/src/lib/robotUseCases.ts` — hire catalog (add the social job).

## Meta-side prerequisites (operator, one-time)

Business assets: a **Business Portfolio**, a **Facebook Page**, an **Instagram Business/
Creator account linked to that Page**, and (for paid) an **ad account with a funded payment
method**. Permissions added to the Login-for-Business configuration `2004716123621967`:

| Capability | Permissions | Token |
| --- | --- | --- |
| Organic FB posts | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` (+`pages_manage_engagement` for Reels) | Page token |
| Organic IG posts | `instagram_basic`, `instagram_content_publish` | Page/IG token |
| FB comments | `pages_manage_engagement`, `pages_read_user_content` | Page token |
| IG comments | `instagram_manage_comments` | Page/IG token |
| DMs (later) | `instagram_manage_messages`, `pages_messaging` | Page token |
| Paid ads | `ads_read`, `ads_management`, `business_management` | user / system-user token |

**Access tier:** your OWN Page/IG/ad account (app has a role) → Development mode, **no App
Review**, build + run now. Managing OTHER businesses' assets → App Review of the above +
Business Verification. Constraints designed-around: **IG = 25 published posts / rolling 24 h**;
IG media must be a **public URL** (we host it); IG images JPEG, aspect 4:5–1.91:1.

## Design defaults (flip on request)

- Scope now: **own Page/IG/ad account**, Development mode (no review).
- Autonomy: **approval-gated** — the robot proposes posts, replies, launches, budget moves;
  owner taps APPROVE on their channel. Per-capability autopilot flags (e.g. "auto-reply to
  comments within policy", "auto-publish the scheduled calendar") off by default.
- Comment auto-reply obeys the §5c reply doctrine already in the engine (locked recipient,
  data-minimised, escalate on anything sensitive/negative).

---

## TRACK A — Organic publishing

**A1. Connector: publish layer** `connectors/metaPublish.ts` (pure builders + I/O):
- `getPageToken(connector)` — exchange the user token for the Page token (`/me/accounts`),
  store per-connector.
- FB: `publishFbPost({pageId, message, link?, mediaPaths?, scheduledAt?})` → `/feed|/photos|
  /videos` (scheduled = `published:false,scheduled_publish_time`).
- IG: `createIgContainer({igUserId, mediaUrl, caption, kind})` → `/media`; `publishIgContainer
  (creationId)` → `/media_publish`; carousels = children containers then a carousel parent.
  Enforce the **25/24 h** budget + container-expiry (24 h) with a pre-check.
- Media hosting: `hostForPublish(workspacePath)` → a public URL via the deployments/robot-file
  layer (IG can't take a local path).
- Reads: `pagePostInsights`, `mediaInsights` (reach/likes/comments/saves).

**A2. Tools** `agent/tools/social.ts` (chat+code, gated on the Page/IG scopes):
- `publish_post` — {platforms:[fb,ig], caption, media?/generate?, schedule?} → generates the
  creative if asked, hosts media, publishes or schedules; records a `social_posts` row;
  returns the live permalink(s). Approval-gated by default.
- `plan_content_calendar` — brief → a dated set of post specs (hook, copy, creative brief,
  platform, time) for approval; writes nothing.
- `list_posts` / `post_report` — recent posts + insights (+ deterministic "what worked").

**A3. Content-calendar routine** — a `schedule/scheduler.ts` `social` job: on cadence, take
the approved calendar → generate creative → publish the due post (respecting the 25/24 h cap)
→ report. The commander lane ("post 3 times this week about X") builds the calendar → approval
→ scheduled publishing.

## TRACK B — Community management (comments + DMs)

This is the existing robot reply engine pointed at a **new `social` channel** — minimal new
code, maximum reuse.

**B1. Webhooks** — extend `routes/robotHooks.ts` with `POST /api/hooks/meta` (page/IG comment
+ message fields; the deletion/deauthorize verify pattern for signature). Auth-allowlisted;
HMAC-verified with the app secret (we already have `parseSignedRequest`/HMAC helpers).
Subscribe the Page to `feed`/`comments`/`messages` webhook fields at connect time.

**B2. Channel adapter** `robots/channels/meta.ts` implementing the channel interface:
- inbound: a new comment/DM → `ChannelInbound` → `handleChannelInbound` (persona, knowledge,
  ask/auto, escalate). Sentiment/negativity → escalate to the owner, never auto-reply.
- outbound `sendOnChannel`: post the reply via `/{comment-id}/replies` (IG) or
  `/{comment-id}/comments` (FB), or the Messenger send API for DMs; hide/delete for spam.
- Dedupe on comment/message id (the engine already does message-id dedupe).

**B3. Controls** — per-robot: auto-reply on/off, "reply to questions, escalate complaints",
hide-spam keywords, quiet hours. Every posted reply is a `robot_drafts` row (audit + thread
memory) — the conversation-memory feature already threads by sender.

## TRACK C — Paid media buying (the original plan, unchanged)

**C1. Write layer** `connectors/metaCampaigns.ts` — `createCampaign/createAdSet(+IG
placements)/createAdCreative/createAd/updateStatus/updateBudget`, `buildTargeting` (pure).
Everything created **PAUSED**. System-user token support.
**C2. Money guardrails + audit** — `campaign_actions` table, per-connector spend caps, pure
`guardCampaignAction` (no launch/budget without approval + cap; no IG ad without Page+IG),
wired into the notify/approve lane.
**C3. Tools** `agent/tools/metaCampaigns.ts` — `plan_campaign → create_campaign (paused) →
launch_campaign/set_budget (gated) → campaign_report (fetch_ads + optimizer suggestions)`.
**C4. Boost** — `boost_post` turns a top organic post into a paid ad (bridges Track A→C).

## SHARED — surfacing + safety

- New DB: `social_posts` (org, robot, platform, object_id, permalink, status, scheduled_at,
  insights_json) + `campaign_actions` (Track C). Metadata only.
- Hire job `client/src/lib/robotUseCases.ts` → **`social`** ("Run your Facebook & Instagram")
  with capability chips: post & schedule / reply to comments & DMs / run ads / weekly report;
  group `make`, `replyTools:'commanders'`. Hire step 3 mounts Connections (Meta) + a
  **Social settings** panel (auto-reply toggles, spend cap, approval toggle, quiet hours).
- New `client/src/components/SocialOps.tsx` — live posts (permalink, reach, comments),
  pending replies (approve/edit), live campaigns (status/spend/CTR, pause/approve). Reuses the
  "Needs You" inbox pattern. Playwright-QA'd 1280+390.
- Prompt steering (`prompts.ts`): a SOCIAL block routing post/schedule/reply/ad asks to the
  right tools; "generate the creative, never placeholder; respect the 25/day IG cap; escalate
  negative comments; ads created paused, launched only on approval."

## Safety invariants (test-locked)

1. Organic posts + comment replies are **proposed for approval** unless the per-capability
   autopilot flag is on; negative/sensitive comments **always** escalate.
2. Paid: every object created **PAUSED**; launch/budget require approval + enforce the cap.
3. No IG publish/ad without a linked Page+IG; IG publish respects the 25/24 h budget.
4. Every publish / reply / ad mutation writes an audit row.
5. Tokens never returned by any API or shown to the model; per-org isolation.

## Phasing (shippable increments)

1. **Track B first** (highest value, most reuse) — comment webhooks + `meta` channel +
   auto/ask reply. "It answers your Facebook & Instagram comments."
2. **Track A** — `publish_post` + calendar + scheduler. "It posts for you."
3. **Track C** — the paid campaign engine + guardrails + boost.
4. **DMs** (`instagram_manage_messages`) + **conversions/Pixel/CAPI** — later.
5. Multi-tenant (clients' pages) = App Review + Business Verification track.

## Verification (per track)

- Pure builders + guardrails + the 25/day + container-expiry checks fully unit-tested (no
  Meta egress needed); request shapes locked to Marketing/Pages/IG Graph v21 schemas.
- Live on your OWN Page/IG/ad account (Dev mode, no review): publish a real FB + IG post
  (permalink verified), post a comment from a second account → webhook → the robot's reply
  appears under it, create a PAUSED campaign → approve → goes ACTIVE → pause. Screenshots to
  the operator (standing visual-QA rule).
