# ModelArk — ArksAI's single model provider

Operator decision (2026-10-20): **no MiniMax anywhere — everything on BytePlus ModelArk**, using the
strongest Seed / DeepSeek Pro models plus GLM-5.2, Seedance and Seedream. Every fact below was
verified LIVE (real API calls / blind bake-offs), not from memory.

## Lanes (branded id → concrete model) — `config.modelarkModels`

| Branded lane | Model | Reasoning | Used for |
|---|---|---|---|
| `arksai-max` | DeepSeek-V4-Pro (`deepseek-v4-pro-ga-260813`) | full | reports, legal, heavy chat |
| `arksai-heavy-glm51` ("ArksAI Heavy") | DeepSeek-V4-Pro | full | **every** code build |
| `arksai-heavy-ds4` | DeepSeek-V4-Pro | `reasoning_effort: low` | spreadsheet / financial-model briefs — code mode, a chat ASK to make/change one (`isChatSpreadsheetAsk`), and every chat follow-up after the conversation made one |
| `arksai-swift` / `arksai-flash` | DeepSeek-V4-Pro | thinking **off** | conversational chat, light planning |
| `arksai-heavy-glm` | GLM-5.2 (`glm-5-2-260617`) | `reasoning_effort: low` | alternate engine (stall ladder) |
| `arksai-heavy-code` | Seed 2.0 Pro (`seed-2-0-pro-260328`) | default | alternate engine (stall ladder) |
| `arksai-heavy-kimi` | DeepSeek-V4-Pro | full | legacy id only (Kimi is not on the key) |

Branded ids are stored in sessions/projects/robots, so they never change — only what they resolve
to. The **stall ladder** (`router.stallLadder`) always switches to a *different concrete model*
(DeepSeek → GLM-5.2 → Seed 2.0 Pro). Rungs: retry → switch → retry → switch → give up, counted only
across CONSECUTIVE stalls — any completed turn resets the count, so a long run that recovered from
occasional stalls is never killed by an old tally.

## Capabilities

| Capability | Model | Endpoint | Notes |
|---|---|---|---|
| Vision (see_image, design gate, deliverable QC, creative zones) | Seed 2.1 Turbo (`dola-seed-2-1-turbo-260628`) | **general** | thinking off: 5/5 planted defects in ~14s; NOT on the coding plan ("UnsupportedModel") |
| One-shot text (design brief, classification, digests, story planning) | DeepSeek-V4-Pro | coding | thinking off |
| SVG / code authoring (logos) | DeepSeek-V4-Pro | coding | |
| Images | Seedream 5.0 Pro (`dola-seedream-5-0-pro-260628`) | **general** | min 921,600 px; ≤2.61 MP = $0.045 tier (`SEEDREAM_SIZES`) |
| Video | Seedance 2.5 → falls back to 2.0 (+1.5 for real-person first frames) | **general** | 2.5 returns **ModelNotOpen** until activated in the ModelArk console; auto-fallback, re-checked hourly |
| Embeddings (screenshot/page/video-frame similarity) | Skylark vision (`skylark-embedding-vision-251215`) | coding | 2048-dim; image↔matching text 0.58, unrelated −0.05 |
| Speech (TTS) | **none** — ModelArk has no speech model | — | `engines/speech.ts` stub; narrated tools + voice replies are gated off; Seedance clips carry native audio |

Endpoints: coding plan `https://ark.ap-southeast.bytepluses.com/api/coding/v3` (flat-rate; LLM,
embeddings); general `…/api/v3` (pay-as-you-go; Seedream, Seedance, Seed 2.1 Turbo). The coding
plan answers `images/generations` with a non-JSON body — media must use the general endpoint.

## Bake-off evidence (blind, de-anonymized means)

Round 1 (3 judges: correctness / design director / customer+speed):

| Workload | DeepSeek-V4-Pro | Seed 2.0 Pro | GLM-5.2 |
|---|---|---|---|
| App build (budget tracker, Playwright-exercised) | **8.3** | 5.3 | 1.0 (6-min reasoning, no output) |
| Designed report (Dune & Date CSV) | **6.0** | 2.7 | 3.8 (thinking off) |
| 24-month formula cash-flow model | **6.8** | 2.0 | 2.2 (thinking off) |
| Bilingual UAE letter before action | **6.8** | 4.0 | 3.7 |
| Chat routing (6 messages) | **8.8** (thinking off) | 5.7 | 6.5 |
| Vision critique | — | 6.2 | — (Seed 2.1 Turbo **7.5**) |

Round 2 (reasoning settings, DeepSeek unless noted): app build — default **8.5**, thinking-off 6.0,
effort-low 5.75 (and it dumped the HTML as chat text instead of calling write_file), GLM effort-low
4.75; spreadsheet — effort-low **7.5**, default 5.5, thinking-off **1.25** (broken models), GLM 2.25;
report — default 4.75 (round 1: 6.0), GLM effort-low 4.75, DeepSeek effort-low 3.0.

`reasoning_effort: "low"` is honoured on GLM-5.2 and DeepSeek (≈half the reasoning tokens, same
answer). `thinking: {type: "disabled"}` is honoured on Seed / GLM / DeepSeek.

## Prices (official ModelArk table, 2026-10-20)

DeepSeek-V4-Pro $1.32 in / $0.044 cached / $3.96 out per M · GLM-5.2 $1.40 / $0.26 / $4.40 · Seed 2.0
Pro $0.50 / $0.10 / $3.00 · Seed 2.1 Turbo $0.50 / $0.10 / $2.50 · Seedream 5.0 Pro $0.045/image
(≤2.61 MP) · Seedance 2.5 $0.103 / $0.231 / $0.569 per second (480p/720p/1080p), 2.0 $0.07 / $0.15 /
$0.37 / $0.78 (4K) · Skylark ≈ $0.0004/image.

## Operating it

- Key: `ARK_API_KEY` env, or no-SSH via `POST /api/admin/providers/byteplus` (encrypted in
  app_settings). It is redacted from all tool output (`registerRuntimeSecret`).
- **Key precedence**: an admin-set key (Admin → Keys) **wins** over `ARK_API_KEY`, including after a
  restart. The Keys panel shows the source ("set here" vs "from the server environment"); **Use
  server key instead** (`DELETE /api/admin/providers/byteplus`, superadmin) deletes the stored key and
  falls back to `ARK_API_KEY` — refused (409) when no env key exists, since that would switch every
  model off. `GET /api/admin/providers` reports `byteplus.source` + `byteplus.envKey` (a boolean,
  never the value).
- **Verify the droplet key**: `POST /api/admin/providers/modelark/verify` (superadmin) — chat +
  embeddings make a REAL 1-token call (the only way to catch "not served on this endpoint"), and only
  a 2xx counts as access: any other rejection (e.g. the endpoint refusing max_tokens or the thinking
  flag) is reported as an error with the API's detail. Images + video use free validation probes
  (InvalidParameter = access OK). A validation-only probe reports OK for models the coding plan won't
  actually serve — don't trust it for chat. Also probed: the robot voice-note ASR model
  (`ROBOT_ASR_MODEL`, default `seed-2-0-mini-260428`, general endpoint).
- **Robot replies**: `model: 'compare'` drafts with the Max lane AND GLM-5.2 (`ARK_REPLY_ALT_MODEL`
  overrides it); when both resolve to the same concrete model it runs single-lane.
- To unlock Seedance 2.5: activate `dreamina-seedance-2-5-260628` in the ModelArk console; video
  switches to it within an hour, no deploy.
- Reinstating speech later = implement `engines/speech.ts` only; every caller already gates on
  `ttsAvailable()`.
