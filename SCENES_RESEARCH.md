# SCENES_RESEARCH — multi-scene videos, stitched in the platform (research only, 2026-07-03)

**The ask (operator):** describe a sequence — e.g. *"A person walks through the desert holding a
phone → camera zooms to the phone showing an app with a button 'pick up by ecosine' → a helicopter
drops a Tesla in front of him → a suited driver steps out and opens the door"* — and ArksAI plans
the scene flow, generates each scene exactly as long as it needs to be, and stitches the result
into ONE video. This document is the research + proposed design. **Nothing here is implemented.**

---

## 1. What we already have (verified in-repo, do not re-discover)

- **Seedance 1.5 Pro** (probed live 2026-07-02, SEEDANCE_PLAN.md): t2v + i2v with `first_frame`
  AND `last_frame` roles, 4–12 s, native audio, 480p **draft mode** (~2 min, cents), async task
  API, cancel. Our `engines/seedance.ts` already builds these roles.
- **Seedance 2.0** (active on our account): **MultimodalToVideo (r2v) + VideoEditing +
  VideoExtension** task types; `reference_video`/`reference_audio`/reference-image roles; 4–15 s;
  NO draft mode. Our engine does NOT yet send `video_url`/extension roles (planned Phase 3).
- **Multi-shot inside ONE clip** already shipped: the studio's drag-and-drop **shot sequencer**
  compiles beats into a timed plan (Seedance 2.0 renders chained motions natively in one take,
  ≤15 s) — and the product-ad engine compiles per-style timed beats the same way.
- **Deterministic first frames**: the product-ad compositor (isolate → stage on backdrop →
  Chromium raster → `first_frame_image`). The same trick generalises: ANY exact frame we can
  raster in HTML (e.g. **a real phone screen showing a real "pick up by ecosine" button**) can
  open or anchor a scene with pixel-exact fidelity.
- **Draft ladder + video cards + library** in chat and the Video studio; videos download to
  `videos/` immediately (URLs expire).
- **NOT present:** `ffmpeg` — not in the sandbox, not in the Dockerfile. (apt has 6.1.1;
  installable the LibreOffice non-fatal way. `ffmpeg-static` npm is NOT usable in the sandbox —
  its postinstall pulls from GitHub releases, blocked — but apt works on the droplet.)

## 2. What the field does (researched live, 2026-07-03)

**The reference pattern is Google Flow (Veo):** a **Scene Builder** where each clip can be
**"Extend…"** (continue from the last frame + motion of the previous segment) or **"Jump to…"**
(a new shot that keeps the cast/world), plus a defined **cast of characters** reused across
scenes; chaining clips builds 30 s–1 min+ stories. That's exactly the shape the operator asked
for, and each primitive maps to something Seedance offers.

**Continuity mechanisms, ranked by strength (industry consensus):**
1. **Single-generation multi-shot** — Seedance 2.0 renders multi-shot sequences with natural cuts
   *within one 15 s generation* (strongest consistency: same latent world; "feels like an edited
   clip"). Kling 2 / Veo 3 top out at ~8 s per pass; Seedance's 15 s is the longest single pass.
2. **Video extension chaining** — 2.0's VideoExtension continues an uploaded clip ("extend 5 s
   with 5 s of generation"); communities report **60–90 s of coherent output** via sequential
   extension. Same take continues → motion AND ambience carry over. Risk: slow drift compounding
   per hop; each hop is a full paid generation.
3. **Frame chaining (last→first)** — extract the LAST frame of scene N (ffmpeg), pass it as
   `first_frame` of scene N+1 ("keyframe stitching"). Forces visual continuity at every cut;
   works on cheap 1.5 (draft mode!). Weakness: only the final *frame* carries over — motion,
   audio, and off-screen world state do not; lighting can drift shot to shot.
4. **Reference pack (omni-reference)** — 2.0 r2v accepts **up to 12 tagged files (9 images +
   3 videos + 3 audios)** with `@mention` roles (subject/environment/motion/audio). 2–3 stills of
   the SAME character (front/¾/profile, same lighting) locks identity across separately generated
   scenes; multiple subjects can be locked simultaneously (our suited driver + the hero + the
   Tesla). Guides measure ~60 % drift reduction going from ad-hoc refs to a consistent 2–3-image
   pack. This is the "cast" concept from Flow.

**Audio:** BOTH generations produce native audio (1.5 verified live on our account; 2.0 per its
API guide — dialogue with lip-sync, SFX, ambience, music following the narrative). The seam
problem is real though: independently generated clips have *different* ambience/music beds →
audible jumps at cuts. Mitigations used in practice: (a) prompt the SAME audio direction into
every scene, (b) audio crossfades at cuts (`acrossfade`), (c) the strongest fix — keep scene
audio as diegetic SFX/dialogue only and lay ONE continuous music bed under the whole stitched
timeline (we have Suno for exactly this), (d) on 2.0, `reference_audio` can force one voiceover
across scenes.

**Stitching (ffmpeg, settled tech):**
- Same codec/resolution/fps (true for our clips — same model + params) → **concat demuxer**,
  stream-copy, zero quality loss, milliseconds.
- Transitions → **`xfade`** (cross-dissolve etc., needs re-encode) + **`acrossfade`** for audio.
  For ads, hard cuts are the norm; dissolves only on explicit ask.
- Last-frame extraction → `ffmpeg -sseof -0.1 -i clip.mp4 -frames:v 1 last.jpg`.

**Operational limits that shape the design (2.0 public data):** ~**QPS 2, max 3 concurrent
tasks** per account → scenes generate mostly sequentially; frame/extension chaining is *forced*
sequential anyway (each scene needs the previous one's output). Pricing (3rd-party figures —
confirm on OUR console): 2.0 ≈ $0.01–0.02/s (Fast), $0.05–0.10/s (Standard); 1.5 finals ≈ our
configured $0.08/s estimate; 1.5 drafts are cents. **A 25 s 4-scene story ≈ $2–3 in finals +
pennies in drafts; wall time ≈ 10–20 min** (3–5 min/scene sequential, drafts faster).

## 3. How the operator's example decomposes (the planner's job)

| # | Scene | Length | Mechanism |
|---|---|---|---|
| 1 | Wide: man walks the desert holding a phone; camera pushes in | 6 s | t2v (1.5 draft→final), or 2.0 with the hero's reference pack |
| 2 | Macro: the phone screen — app UI with the **"pick up by ecosine"** button, thumb taps | 4 s | **i2v from a COMPOSITED frame**: we raster the real UI in Chromium (existing pipeline) → `first_frame` → model animates the tap. Pixel-perfect text — the one thing gen models still fumble — solved deterministically |
| 3 | Helicopter lowers a Tesla in front of him | 6 s | frame-chain from scene 1's last frame (same desert, same light) + Tesla/hero refs on 2.0 |
| 4 | Suited driver steps out, opens the door | 5 s | extension of scene 3 (same take continues) or frame-chain + driver ref |
| — | Stitch: hard cuts, one music bed (Suno) under diegetic SFX, `acrossfade` at seams | — | ffmpeg concat |

~21 s total, 4 generations + 1 stitch. The planner picks per-scene mechanism AND length (4 s
granularity floor — "exactly as long as necessary" means the model's 4 s minimum per scene,
beats within a scene are free-form).

## 4. Proposed architecture (for when we build — not now)

1. **Scene planner** (`scenePlan.ts`, same fail-open pattern as videoBrief/designBrief): LLM pass
   turns the user's story into a typed plan: `scenes[{ prompt, durationS, mechanism:
   't2v'|'i2v-composited'|'frame-chain'|'extend'|'ref-pack', castRefs[], audioDirection }]` +
   one global `cast` (uploaded/generated stills per character/product) + one `audioPlan`
   (per-scene diegetic direction + optional Suno bed). Deterministic guards: total ≤ ~60 s v1,
   ≤ 8 scenes, per-scene 4–15 s clamp, the SAME style/lighting/audio line injected into every
   scene prompt.
2. **Sequential scene executor** in `generate_video` (or a new `generate_video_story` tool):
   for each scene — resolve its anchor (composited frame / previous last-frame / previous clip
   for extension / reference pack) → create task → poll → download. Respects the 2-QPS/3-task
   ceiling; progress beats per scene ("Scene 2 of 4 — the phone close-up…").
3. **Stitcher** (`videoStitch.ts`): ffmpeg concat demuxer (stream-copy; re-encode only when a
   transition is asked), optional `xfade`/`acrossfade`, optional Suno bed mix
   (`amix`), last-frame extraction helper. Dockerfile: `apt-get install ffmpeg` (non-fatal,
   LibreOffice pattern). Deterministic QC: per-clip duration ≈ plan, stitched duration = Σ scenes,
   file non-zero; Phase-2 QC: extract 1 frame/scene → `analyzeImage` continuity check.
4. **Draft ladder at the STORY level**: all scenes draft at 480p first (1.5 drafts; 2.0 scenes
   use `-fast`) → stitched DRAFT shown as one playable card + a **scene strip** (each scene its
   own mini-card: Retake this scene / adjust its line) → approve → finals re-render scene-by-scene
   (reusing approved drafts' anchors) → final stitch. A retake only regenerates ONE scene and
   re-stitches — never the whole story.
5. **Studio UI**: a third kind alongside Scene/Product — **"Story"**: a scene-list editor
   (auto-filled by the planner from one story box, each row editable: what happens / length /
   cast), a cast strip (upload or generate the character/product stills), and the same
   format/audio controls. Chat flow mirrors it ("plan → show the scene table → confirm → build").

## 5. What must be validated LIVE before building (in order)

1. **VideoExtension request shape on OUR account** (task type, `video_url` role, length rules,
   cost) — probe with the ark key; our engine has never sent it.
2. **2.0 r2v @mention reference pack** — same-character consistency across two separately
   generated scenes with a 3-still pack; and whether 2.0's native audio fires on r2v tasks.
3. **Frame chaining quality on 1.5** — desert scene → extract last frame → next scene opens on
   it: does lighting/palette hold well enough for a hard cut?
4. **Composited-UI scene** — raster a phone-screen frame (our HTML pipeline) → i2v "thumb taps
   the button": does the text stay legible through the motion? (This is scene 2 of the example
   and OUR differentiator.)
5. **ffmpeg on the droplet** — Dockerfile layer + concat/xfade/acrossfade of two real Seedance
   clips; verify stream-copy works (same codec/fps) and audio seams with/without a music bed.
6. **2.0 pricing + wallet on our console** (3rd-party figures above are not billing truth), and
   the real per-account concurrency (docs say QPS 2 / 3 tasks).
7. **Audio continuity A/B** — same-audio-direction prompts vs music-bed-over-diegetic: which
   sounds seamless to a normal ear.

## 6. Risks / honest limits

- **Drift compounds**: extension chains slowly drift (faces/props mutate over many hops); the
  planner should prefer ≤2 extension hops and reset identity with the reference pack at cuts.
- **Text in video** stays unreliable EXCEPT via our composited-frame trick or 2.0 reference
  images; never promise arbitrary in-scene text without one of those.
- **Wall time**: 4–8 scenes sequential = 10–30 min. The draft ladder + per-scene progress beats
  keep it feeling alive (same "visible competence" doctrine as builds).
- **Cost**: a full story is multiple paid generations; retakes re-pay one scene. Keep the
  per-run render cap and show a cost estimate on the plan BEFORE generating.
- **Provider policy**: real-person photos still route via the 1.5 first-frame path (existing
  auto-route); a cast still of a real person can't be a 2.0 reference (anti-deepfake) —
  the planner must know this when choosing mechanisms.

## 6b. Operator observation (2026-07-03): "Seedance 2.0 is better at understanding prompts and generating videos"

Taken as a routing steer, and the research backs it: 2.0 is the newer architecture (multi-shot in
one pass, omni-reference, stronger instruction-following per every third-party comparison, native
audio incl. lip-synced dialogue). The current "1.5 default, 2.0 only for reference/edit/extend"
routing exists for ONE reason: 1.5 has the cheap 480p draft mode. But the public tier pricing
suggests **2.0-fast (~$0.01–0.02/s) may be as cheap as or cheaper than a 1.5 draft path** — if a
live probe confirms quality + cost on our account, the right move is **2.0-FIRST routing**:
drafts on `dreamina-seedance-2-0-…-fast`, finals on standard (Pro/2K only on ask), 1.5 kept for
the real-person first-frame path (2.0 declines real-person photos on every image role — provider
policy) and as fallback. This also simplifies the story engine: extension, reference packs and
multi-shot all live on 2.0, so scenes wouldn't hop between model families. **Add to the §5 probe
list: (8) 2.0-fast vs 1.5-draft bake-off — same brief, compare quality/latency/cost — and
(9) 2.0 prompt-following A/B on a complex multi-beat prompt (the operator's observed edge).**

## 7. Recommendation

Build it as **"Flow, but with our deterministic edge"**: scene planner → per-scene mechanism
choice (single-pass multi-shot ≤15 s first; frame-chain for cuts; extension for continuations;
2.0 reference pack for cast consistency; composited frames for anything that must be pixel-exact,
like app UI) → sequential generation with story-level draft ladder → ffmpeg stitch with one music
bed. Per the operator's 2.0 steer (§6b): if the 2.0-fast probe confirms cost+quality, run the
whole story engine **2.0-first** (drafts on -fast, finals on standard; 1.5 only for real-person
first-frame scenes and fallback). Phase 1 = planner + frame-chaining + concat; Phase 2 =
extension + reference packs + the Story studio UI; Phase 3 = transitions, Suno bed mixing,
per-scene vision QC. Validate §5 items 1–5 plus the §6b bake-off with ~$3 of live probes before
any code.

## 8. PROBE RESULTS (run live from the sandbox, 2026-07-03 — ~$0.5–0.9 total, all §5 items answered)

Every §5/§6b question was probed against the real API with the ark key. Artifacts sent to the
operator (story-cut.mp4, d-uitap.mp4, b-extend.mp4). Facts, not guesses:

1. **Model ids on our account:** `dreamina-seedance-2-0-260128` (standard) +
   `dreamina-seedance-2-0-fast-260128` (fast — suffix BEFORE the date; the plan's `-260128-fast`
   guess was wrong). No `-mini`/`-pro`. A video input silently routes to an internal
   `…-fast-r2v` variant.
2. **Extension = r2v with `reference_video`** — there is no separate extension flag on this API
   (unknown body fields are ignored; the ONLY accepted video role is `reference_video`).
   **Videos must be WEB URLs — data URLs are rejected** ("must be provided as a web url") →
   the platform must serve the previous scene's clip at a public URL (token-gated route on
   arksai.studio, same pattern as the Android build source route). Result quality: **seamless** —
   the continuation opened on the source clip's exact final state (same man, same helicopter,
   same grade) and executed "lower the car on cables" perfectly. 117 s wall, **141 k tokens**
   (~3× a draft — the input video is tokenized too).
3. **Frame chaining is cheap and excellent**: ffmpeg `-sseof` last-frame → `first_frame` on a
   1.5 draft; scene 3 opened pixel-continuous with scene 1 (wardrobe/light/helicopter all held).
   23 s wall, 36 k tokens. This is the workhorse cut mechanism.
4. **Composited-UI scene EXCEEDED expectations**: our Chromium-rastered phone frame (real
   "Pick up by ecosine" button) → 1.5 i2v — the model *staged the phone INTO a real desert*
   (sand, dunes, matching light) while keeping the UI text pixel-legible, then animated a thumb
   tapping the button. 52 s, 24 k tokens. Deterministic in-video text: proven.
5. **Reference-pack consistency works with ONE image**: the same jar (gold lid, label layout)
   held across two INDEPENDENT 2.0-fast r2v generations (marble bathroom + candlelit slate).
   69–75 s, 40.6 k tokens each. Micro-text on the label softens slightly — pack labels that must
   be readable should use the composited-frame trick instead.
6. **⚠️ 2.0-fast t2v is FLAKY on our account**: the same multi-beat desert prompt failed TWICE
   (fully reworded the second time) with `OutputVideoSensitiveContentDetected.PolicyViolation`
   ("copyright restrictions") after 113–128 s of wall time each — while plain 1.5 rendered the
   identical prompt fine, and 2.0-fast **r2v** (extension + both reference probes) never tripped
   it. Revises §6b: NOT blanket "2.0-first" but **mechanism-based routing** — 1.5 for fresh t2v
   shots (its drafts finished in 23–52 s (!) — far faster than the plan's 2-min estimate),
   2.0-fast r2v for continuity (extension/reference). The story engine needs retry-with-reword +
   honest surfacing for the copyright filter.
7. **Stitching verified end-to-end**: all clips come out h264/aac/24 fps → concat demuxer
   stream-copy is instant and lossless (14.1 s two-scene story produced); `xfade`+`acrossfade`
   re-encode also verified. ffmpeg 6.1.1 installs cleanly via apt (Dockerfile line needed —
   NOT yet added).
8. **Cost/usage observed** (usage.total_tokens returned per task): 8 s 480p draft = 48.5 k tok,
   6 s draft = 36.4 k, 4 s draft = 24.4 k, 6 s extension = 141 k, 4 s r2v w/ image ref = 40.6 k.
   At the console's 1.5 rate ($0.0012–0.0024/K) the whole probe battery cost ≈ $0.5–0.9.
   2.0 per-token rate still needs a console check (operator).
9. **Concurrency**: 3 tasks ran simultaneously without queuing errors, matching the documented
   3-concurrent ceiling.

**Net effect on the recommendation:** unchanged architecture, two amendments — (a) routing is
per-MECHANISM (1.5 t2v/i2v for fresh shots + drafts; 2.0-fast r2v for extension/reference), not
per-model; (b) the executor needs a public token-gated clip URL for extension inputs, and a
copyright-filter retry policy. Everything the operator's example needs is now PROVEN: scenes 1+3
were generated, frame-chained and stitched; scene 2's exact-UI tap was generated from a
composited frame; the extension and reference mechanisms both work.

## Sources (checked 2026-07-03)

- In-repo: `SEEDANCE_PLAN.md` §1 (live-probed capabilities), `engines/seedance.ts`,
  `agent/videoBrief.ts`, `agent/productShot.ts`.
- BytePlus ModelArk docs + Seedance 2.0 API guides: docs.byteplus.com/en/docs/ModelArk/1520757;
  help.apiyi.com (6 core capabilities: 12-file omni-reference = 9 img + 3 vid + 3 aud, native
  audio flag, 15 s max single pass, QPS 2 / 3 concurrent, tier pricing), datacamp.com Seedance
  2.0 guide, evolink.ai/seedance-2-0, replicate.com/bytedance/seedance-2.0.
- Extension + long-form chaining: seedance2.ai, hailuoai.video blog (extension workflows,
  60–90 s coherent via sequential generation).
- Consistency guides: wavespeed (Medium) reference-pack rules, magichour.ai Seedance 2.0
  reference tagging, crepal.ai character-consistency (front/¾/profile 3-still pack),
  vicsee.com omni-reference, motion.verticalstudio.ai character-consistency guide (frame
  chaining / keyframe stitching).
- Flow/Veo scene workflow: therobbiedshow.medium.com (Extend vs Jump-to), chaipeau.com +
  mindstudio.ai Flow guides (Scene Builder, cast, 30 s–1 min chains), toolfolio.io.
- Stitching: ottverse.com xfade guide, ffmpeg-micro.com concat (demuxer vs filter vs protocol),
  editframe.com + royshil gist (xfade + acrossfade sync).
