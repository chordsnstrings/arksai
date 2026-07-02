# SEEDANCE_PLAN — video that non-technical people can actually direct

**Goal:** when a user asks for a video, ArksAI guides them to the best possible output with zero
prompt engineering: **one intake round → a cheap 480p draft they can watch → one tweak → the final
render.** Seedance 1.5 Pro is the workhorse; Seedance 2.0 adds editing/extension/reference later.
Same product thesis as everything else here: quality comes from the SYSTEM (intake → prompt
compiler → draft ladder → QC), the model is swappable.

---

## 1. Verified capabilities (probed live on our BytePlus account, 2026-07-02)

Everything marked ✓ was confirmed against `ark.ap-southeast.bytepluses.com/api/v3` with the live
ark key (rejection-probes + one succeeded 480p draft task). Do not re-discover.

### Seedance 1.5 Pro — `seedance-1-5-pro-251215` (the default)
- ✓ Tasks: **TextToVideo + ImageToVideo** (`image_url` content, `role:"first_frame"` accepted → first/last-frame control).
- ✓ Duration: **4–12 s** (3 rejected, 4–12 pass, 13+ rejected).
- ✓ Resolution: **480p / 720p / 1080p / 4K** (2K rejected; 4K passes validation).
- ✓ **Native audio by default** (`generate_audio: true` on the task): synchronized dialogue, SFX,
  ambience generated WITH the video. The headline capability — videos come out with sound.
- ✓ **Draft mode**: `draft: true` → **480p only** (API: "draft task only support resolution 480p"),
  fast + cheap. Our probe draft succeeded end-to-end in ~2 min. THIS is the UX unlock.
- ✓ NOT supported: reference-media mode (`r2v` → "does not support model seedance-1-5-pro").
- Aspect ratios (docs): 16:9, 9:16, 1:1, 4:3, 21:9; adaptive for i2v.
- ✓ Flow: async — `POST /api/v3/contents/generations/tasks` → `{id}` → `GET .../tasks/{id}` until
  `succeeded` (typ. 45 s–3 min) → download the video URL immediately (external URLs expire).
  `DELETE .../tasks/{id}` cancels ✓ (409 once running).
- Also active: `seedance-1-0-pro` and `seedance-1-0-pro-fast` (fallback tier, ~$0.0010/K).

### Seedance 2.0 — `dreamina-seedance-2-0-260128` (+ `-fast`, `-mini`) — the editor's suite
- ✓ **Active on the account** (the June "suspended" note is STALE — all three respond).
- ✓ Tasks: **MultimodalToVideo (r2v) + VideoEditing + VideoExtension**; inputs text+image+video+audio.
- ✓ Reference roles enforced by the API: `reference_video`, `reference_audio` (+ reference images) —
  "make it like this clip", "use my voiceover", "keep this product/character".
- ✓ Duration: **4–15 s** (16+ rejected). ✓ Draft mode NOT supported on 2.0.
- Prompt-level `--params` parse from the text (`--resolution`, `--duration`, `--ratio` …); invalid
  ratio/fps are tolerated/defaulted, duration+resolution are strictly validated (in that order).

### Billing/ops notes
- Console (June): 1.5-pro ≈ $0.0012–0.0024 / K video tokens; 2 M free video tokens on the account.
  A 480p draft is cents; budget guidance below. **Operator: confirm video billing draws on the ark
  key's plan** (the probes succeeded, so it's live — but check which wallet).
- Same ark key + general `api/v3` endpoint; key already DB-configured (`byteplusRuntime`), no new secret.

---

## 2. The UX — "describe it → watch a draft → approve the final"

### Flow A — from an idea (chat, the main path)
1. **Intake, ONE round** (the canonical intake rule). Video-intent detected in chat → ask in one
   message, in user language, only what's missing:
   - *What's it for?* ad / social reel / product demo / explainer / cinematic shot
   - *Where will it run?* TikTok–Reels (9:16) · YouTube (16:9) · square feed (1:1)
   - *Anyone talking?* dialogue or voiceover (native audio) vs music/ambience only
   - *Starting from anything?* nothing / this image (animate it) / this clip (→ 2.0)
   Sensible defaults if the user says "just make it": 9:16, 8 s, audio on, ambient.
2. **Compile the Seedance prompt** (invisible): rewrite the casual ask into the model's grammar —
   SUBJECT + ACTION + **CAMERA** (push-in, orbit, handheld, static) + STYLE/LIGHTING + AUDIO CUES
   (what we hear), per the official 1.5-pro prompt guide. The user never sees `--params`.
3. **DRAFT first, always**: 480p draft render (~2 min, cents) → shown as a **playing video card**
   in chat with param chips (9:16 · 8 s · audio on) and two actions:
   - **Render final** → same prompt at 1080p (4K only on explicit ask)
   - **Tweak** → ONE adjustment round (pacing / camera / style / audio), new draft.
   One-pass doctrine applies: a good draft goes straight to final; iterate only on a named issue.
4. **Deliver**: final video saved to `videos/`, playable in chat, downloadable. Cost line on the card.

### Flow B — animate an image (i2v)
Uploaded image + "make this move / bring this to life" → skip most intake (the image answers
style), ask only motion + where it'll run → i2v draft with `first_frame` → same ladder.

### Flow C — edit / extend / "like this" (Seedance 2.0, Phase 3)
An uploaded VIDEO + "continue it / change X / make one like this" → route to 2.0
(`reference_video` / editing / extension roles); voiceover file → `reference_audio`.
No draft mode on 2.0 → confirm cost in the intake round instead, use `-fast`/`-mini` tiers.

### Model naming + selection (operator, 2026-07-02)
Branded, selectable video models — the provider name never appears in the UI:
- **`arksai-video-15` → label "ArksAI Video 1.5"** → `seedance-1-5-pro-251215` (drafts, native
  audio, 4–12 s — the default engine).
- **`arksai-video-20` → label "ArksAI Video 2.0"** → `dreamina-seedance-2-0-260128` (reference
  video/audio, editing, extension, 4–15 s; `-fast`/`-mini` used internally as cost tiers).
The **Video studio has a model selector** (chips: Auto · Video 1.5 · Video 2.0; Auto default), and
chat accepts "use video 2.0". Registry entries + per-model cost lines use the branded labels only.

### Model routing (when "Auto", invisible to the user)
- Default **ArksAI Video 1.5** (draft + native audio + cheap).
- **ArksAI Video 2.0** only when the request needs reference/editing/extension.
- `seedance-1-0-pro-fast` as the degraded fallback if 1.5 errors (internal only, never shown).

---

## 3. Architecture (existing seams, nothing exotic)

- **`server/src/engines/seedance.ts` (new)** — async task client: `createVideoTask(spec)`,
  `pollVideoTask(id, signal, onPhase)`, `cancelVideoTask(id)`, `downloadVideo(url, destAbs)`.
  Uses `byteplusKey()` from `byteplusRuntime` + a new `config.byteplusVideoBaseUrl`
  (default `https://ark.ap-southeast.bytepluses.com/api/v3`). Builds the `content[]` payload
  (text with `--resolution/--duration/--ratio`, `image_url`/`video_url`/`audio_url` + roles) and
  the body flags (`draft`, `generate_audio`). Pure `buildVideoContent(spec)` for unit tests.
- **`server/src/agent/videoBrief.ts` (new)** — the prompt compiler (same fail-open pattern as
  `designBrief.ts`): deterministic scaffold (subject/action/camera/style/audio) + a bounded LLM
  pass to enrich; returns the final Seedance prompt string. Falls back to the raw ask.
- **`tools/minimax.ts → generate_video` (rewired)** — provider dispatch: Seedance when the
  BytePlus key is configured (else Hailuo unchanged). New params: `brief`, `aspect_ratio`,
  `duration`, `audio`, `dialogue`, `image` (workspace path → i2v), `final` (bool — false = draft),
  `resolution` (final only), `video`/`audio_ref` (Phase 3). The tool: compile → create task →
  poll with progress beats ("Casting the scene… Rendering the draft…") → download to `videos/` →
  return the card payload + cost. Draft params cached to `videos/.last-video.json` so "render the
  final" never re-asks.
- **Client `VideoCard.tsx` (new)** — timeline card: HTML5 `<video controls>` (served via the
  session file route), param chips, **Render final / Tweak** buttons that send a prefilled chat
  message (same pattern as the completion card). Canvas gets a `video` doc kind for full-size playback.
- **Prompt steering** — chat block: video intent → the ONE intake round → generate_video (draft
  default); code/report modes may embed produced videos in pages. Marketing expertise: a
  `marketing.videoteaser` play + video-craft standards (hook in first second, one message,
  9:16 safe-area, captions burned only on ask).
- **Cost** — `config.seedanceDraftCost` / `seedanceFinalCostPerSec` (env-tunable estimates) via
  `ctx.addCost()`; shown on the card. Registry entry in `engines/registry.ts` ("Seedance video",
  gated on the BytePlus key).
- **QC (cheap, deterministic first)** — file exists + size sane + duration matches ask (reject
  0-byte/HTML error bodies). Phase 4: extract a frame → `analyzeImage` gate (subject fidelity,
  same pattern as creatives).

## 4. Phases, each shippable + gated

**Phase 1 — engine + tool + draft ladder (1.5-pro), text-only UI.**
`seedance.ts`, `videoBrief.ts`, `generate_video` rewire, chat steering, costs, registry.
Tests: pure `buildVideoContent` (params/roles/flags incl. draft→480p, duration 4–12 clamp),
compiler fail-open, provider dispatch (no key → Hailuo path untouched). Gate: **live on
arksai.studio** — a real chat ask produces a draft, then a final, both playable; cost visible.

**Phase 2 — the VIDEO STUDIO (a dedicated surface, like the Android section — operator direction
2026-07-02).** Video is a studio workflow, not a chat thread. A sidebar entry **"Video"** opens a
full-page studio (`client/src/components/VideoStudio.tsx`, route `/video`, same pattern as the
Android/Robots surfaces):
- **Brief composer** (left): structured, zero-jargon fields — what it's for (ad / reel / demo /
  cinematic), where it runs (9:16 / 16:9 / 1:1 chips), length slider (4–12 s), audio toggle
  (+ optional dialogue line), an optional image drop (animate it). One button: **"Make a draft"**.
- **Draft rail** (right): every draft as a playing card — video player, param chips, cost line,
  and per-card actions **Render final (1080p)** · **Tweak** (one adjustment field) · **Download**.
  Finals get a ★ and live at the top. This is the draft-ladder made visual: compare drafts
  side-by-side, promote the winner.
- **Library** (below): all videos ever made in the workspace (from `videos/` across sessions),
  filter by aspect/date, re-open params to remix.
- Engine-wise the studio drives the SAME `generate_video` tool through a lightweight session (like
  the Android surface drives build_apk) — no parallel pipeline to maintain. The chat flow (Flow A)
  keeps working and shows a compact `VideoCard` that links into the studio.
Gate: Playwright — studio renders, brief→draft→final walk works, library lists; WhatsNew/FEATURES.

**Phase 3 — Seedance 2.0 suite.** Edit/extend/reference flows (uploads of video/audio already
land in `uploads/`), routing rules, `-fast`/`-mini` tiers, cost confirmation in intake (no draft
on 2.0). Gate: live edit + extension on a real uploaded clip.

**Phase 4 — polish.** Frame-based vision QC; department plays; scheduled/robot use ("weekly
product teaser"); 4K behind explicit ask; captions/subtitles option.

## 5. Guardrails & risks
- **Cost:** draft-first is the guardrail; defaults 8 s / draft / 1080p-final; 4K + >12 s (2.0 15 s)
  only on explicit ask; per-run video cap (e.g. 3 renders) before asking.
- **URL expiry:** generated video URLs expire — ALWAYS download to `videos/` immediately (image
  pipeline already does this).
- **Droplet egress** to `ark.ap-southeast.bytepluses.com` works for LLM (Swift lane live) — same
  host, no new allowlist. Verify the CDN download host on the first live run.
- **Billing wallet** for video vs the coding plan — operator confirms on the first paid render.
- **Dormancy:** everything key-gated; no key → Hailuo behavior unchanged, zero regression.

## 6. Success criteria
A non-technical user types "make me a video ad for my juice bar" and, within ~5 minutes and one
choice round, watches a draft with sound in the chat, taps **Render final**, and downloads a
1080p vertical video with synchronized audio — for under ~$1 — without ever seeing a model name
or a parameter.
