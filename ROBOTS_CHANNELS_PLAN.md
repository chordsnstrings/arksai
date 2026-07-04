# Robots — multichannel + personas + knowledge + the commander bridge (2026-07-04)

Operator directive: beyond the working EMAIL robot, add **WhatsApp, Telegram and SMS (SMSALA
first) auto-responders**, reusable **personas**, a per-robot **knowledge base**, and — the end
state — **"text the robot on Telegram/email → it builds a website/app/document/deck with ArksAI
→ delivers it directly to a named email/WhatsApp."** Governing rule stays: *flawless or it isn't
live*; the §5c trifecta pattern (locked recipient, data-minimized, escalate-not-guess) extends to
every channel.

## 0. API research (verified live, 2026-07-04)

- **Telegram Bot API** — the easy, webhook-free channel. Per-robot bot (token from @BotFather).
  `GET /bot<token>/getMe` (verify), `getUpdates?offset=&timeout=0` (long-poll from OUR side —
  no public webhook needed), `sendMessage {chat_id,text}`, `sendDocument` (multipart, real file
  delivery). `api.telegram.org` is blocked by the SANDBOX proxy only (CONNECT 403) — the droplet
  has open egress; tests mock the API.
- **WhatsApp Cloud API (Meta)** — webhook-based. Send: `POST graph.facebook.com/v22.0/
  {phone_number_id}/messages` with `{messaging_product:'whatsapp', to, type:'text',
  text:{body}}`; documents by **public link**: `type:'document', document:{link, filename,
  caption}` (we mint short-lived token URLs — the videoSrc pattern). Inbound: Meta POSTs
  `entry[].changes[].value.{contacts[],messages[]}` (from, id, timestamp, text.body) to OUR
  webhook; GET verify handshake echoes `hub.challenge` when `hub.verify_token` matches;
  authenticity via `X-Hub-Signature-256` = HMAC-SHA256(raw body, app secret). Needs per-org
  Meta setup (business app + phone number id + permanent token). Reachable from the sandbox.
- **SMSALA** (api.smsala.com, verified against their live docs + probe) — send:
  `POST /api/SendSMS {api_id, api_password, sms_type:'T', encoding:'T'|'U', sender_id,
  phonenumber, textmessage, uid, callback_url}` → `{message_id, status:'S'|'F', remarks}`.
  Inbound (two-way): SMSALA calls OUR URL with `ChannelNumber, MessageText, IncomingNumber`
  (configured in their admin panel; no signature → we embed a per-channel secret key in the URL).
  `CheckBalance` for the connection test. **GOTCHA: the account must whitelist the caller IP**
  (probe returned "IP not Whitelisted") → operator must whitelist the droplet IP 159.89.172.210.
  SMS can't carry files — deliverables go as a short link.

## 1. Architecture (reuse-first)

One channel-agnostic spine; email stays exactly as built.

- **`robot_channels`** table — per-robot, one row per kind (`telegram|whatsapp|sms`):
  `id, robot_id, org_id, kind, label, secrets (AES-256-GCM JSON via lib/crypto)`,
  `meta` (plain JSON: botUsername, phoneNumberId, senderId, channelNumber, verifyToken,
  hookKey), `state` (JSON: telegram update offset), `enabled, verified_at, created_at,
  updated_at`. UNIQUE(robot_id, kind).
- **Adapters** `server/src/robots/channels/{telegram,whatsapp,sms}.ts` implementing
  `{verify, send(text), sendFile?, fetchInbound?}` + shared `types.ts` (`ChannelInbound`:
  id/from/fromName/text/ts). Telegram = poll-based (fetchInbound from the 60s robot poller
  tick, offset persisted). WhatsApp + SMS = webhook routes push into the same handler.
- **`handleChannelInbound(robot, channel, msg)`** in `channels/inbound.ts` — mirrors the email
  poll loop exactly: dedupe by channel message id (`draftExistsFor`), self/loop guard,
  `draftReply` (same §5c engine; chat channels get a "conversational, short, no email
  signature" style note; SMS additionally "≤450 chars"), draft with `to_addr` LOCKED to the
  inbound sender, `ask` → pending, `auto` → send via the adapter.
- **`robot_drafts`** gains `channel TEXT DEFAULT 'email'` — the send endpoint dispatches by
  channel (email → SMTP; others → adapter). UI shows a channel badge.
- **Webhook routes** (`routes/robotHooks.ts`, PUBLIC in the auth allowlist):
  `GET/POST /api/hooks/whatsapp` (GET = hub.challenge verify against any enabled channel's
  verifyToken; POST = signature-checked when an app secret is stored, routed by
  phone_number_id), `GET/POST /api/hooks/sms/:hookKey` (matched by per-channel random key +
  ChannelNumber). Raw body for HMAC is stashed by the JSON parser (`req.rawBody`).

## 2. Personas (org-level, reusable)

- **`robot_personas`**: `id, org_id, name, description, voice` (the persona/tone text),
  `language, signature, created_at, updated_at`. CRUD under `/api/orgs/:id/personas`.
- Robot config gains `personaId`; the poller/routes resolve it and pass the voice+signature
  into `buildSystem` (explicit `config.persona` still wins — additive, nothing breaks).
- Console: a Personas manager (create/edit/delete) + a persona picker in the robot office.

## 3. Knowledge base (per-robot files, data-minimized retrieval)

- **`robot_kb_docs`**: `id, robot_id, org_id, name, text, created_at`. Upload route accepts a
  file (txt/md/pdf/docx/csv via `lib/extract.extractText`) or pasted text.
- **Pure retrieval** `selectKnowledge(docs, message, budget)` — chunk each doc (~800 chars on
  paragraph boundaries), score chunks by query-term overlap, pack the top chunks into ~4k chars.
  Only the RELEVANT slices enter the reply context (data-minimization preserved: the model sees
  one message + selected knowledge, never the whole corpus).
- Folded into `buildSystem` alongside the existing free-text `config.knowledge`.

## 4. The commander bridge (text → ArksAI build → direct delivery)

The trifecta-safe shape for "I text the robot and it builds + delivers":

- **`robot_commanders`**: `id, robot_id, org_id, channel, address, label` — the OWNER'S OWN
  identities (their Telegram chat id, email, WhatsApp number), managed in the console. Only a
  message from a listed commander can trigger a build or name a delivery destination. Everyone
  else stays in the §5c reply-only lane — a customer message can NEVER start a build or
  redirect output (prompt injection lands in a locked-recipient reply at worst).
- **Intent**: commander messages run through `classifyCommand` (strict JSON:
  `{action:'chat'|'build', brief, deliverables, deliver_to:[{channel,address}]}`) — the
  deliver_to comes from the human commander's own text (trusted instruction), recorded on the
  task, capped, audited.
- **`robot_tasks`**: `id, robot_id, org_id, channel, commander, request, session_id, status
  ('running'|'delivering'|'delivered'|'error'), deliver_to, artifacts, error, created_at,
  finished_at`. One running task per robot (cap).
- **Execution** = the scheduler's exact spawn pattern: `createSession({orgId, mode:'chat',
  task, model})` + timeline seed + `manager.startRun(brief + unattended-run suffix)`. The
  poller tick watches running tasks; when the session goes idle it collects deliverables
  (docs produced in the workspace, the newest export zip, a published `/apps/<slug>/` URL from
  the deployments table) and delivers: email → attachments via the robot mailbox; Telegram →
  `sendDocument`; WhatsApp → document-by-link (minted token URL); SMS → link text. Progress
  pings ("On it — building your deck…", "Done — sent to X") go back on the commanding channel.
- Failure = honest message back to the commander + task `error` + Needs-You surface.

## 5. Phases (each ships green: typecheck + tests + build; live verify needs droplet creds)

1. **Channel spine + Telegram** — tables, adapters, inbound handler, poller integration,
   draft channel dispatch, routes (+ connection test), console Channels panel.
2. **WhatsApp + SMS** — webhook routes (public allowlist, HMAC/hook-key), adapters, delivery
   file-link route.
3. **Personas + KB** — tables, retrieval, buildSystem folding, console UI.
4. **Commander bridge** — commanders, classifyCommand, robot_tasks executor + watcher,
   delivery, caps + audit; console Tasks feed.

Live verification needs (operator): a BotFather token for Telegram (2 min), Meta business app
creds for WhatsApp, SMSALA api_id/password + droplet IP whitelisted, and the existing robot
mailbox. Until then: unit tests (mocked HTTP), boot verification, and the console UI verified
via Playwright.
