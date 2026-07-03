# STORY_PLAN — multi-scene story videos: planner → executor → stitcher → Story studio

**Goal:** the user describes a sequence once ("a man walks the desert → zoom to the phone showing
the 'pick up by ecosine' button → a helicopter drops a car → a suited driver opens the door") and
ArksAI plans the scene flow, generates each scene exactly as long as it needs (4 s floor), keeps
people/products/UI consistent across scenes, and stitches ONE playable video — draft first, then
final, with per-scene retakes. Research + live proof: `SCENES_RESEARCH.md` (§8 probe results —
every mechanism verified 2026-07-03; artifacts sent to the operator).

**Doctrine:** quality from the SYSTEM — deterministic planner guards, mechanism-based routing,
composited frames for pixel-exact content, story-level draft ladder, bounded retries. One pass if
it works; iterate only on a named defect (a failed scene, a bad beat the user names).

---

## 0. Locked design decisions (from the probes)

- **Routing is per-MECHANISM, not per-model** (probe §8.6): fresh t2v/i2v shots + ALL drafts →
  **1.5** (23–52 s drafts, immune to the copyright-filter flakiness we hit twice on 2.0-fast t2v);
  continuity ops (extension, reference packs) → **2.0-fast r2v** (never tripped the filter).
- **Four continuity mechanisms**, chosen per scene by the planner:
  `t2v` (fresh shot) · `i2v-composited` (opens on a Chromium-rastered exact frame — app UI,
  poster, menu…) · `frame-chain` (opens on the previous scene's LAST frame — the workhorse cut)
  · `extend` (2.0 r2v continues the previous CLIP — same take, no cut) · plus optional
  `reference_image`s on any 2.0 scene for cast/product identity.
- **Extension inputs must be WEB URLs** (data URLs rejected) → a public token-gated clip route.
- **All clips come out h264/aac/24 fps** → lossless `concat` stream-copy is the default join;
  `xfade`/`acrossfade` only when a transition is explicitly asked.
- **Copyright-filter policy** (2.0): classify `OutputVideoSensitiveContentDetected.*` → ONE
  automatic reword-retry → if it fails again, fall back to the 1.5 equivalent mechanism
  (frame-chain instead of extend) and tell the user plainly in the result.
- **Story caps v1:** ≤ 8 scenes, 4–15 s each, ≤ 60 s total, ≤ 2 consecutive extension hops
  (drift), one aspect ratio per story. Cost estimate shown on the plan BEFORE generating.

## 1. Phase 0 — plumbing (small, shippable alone)

1. **ffmpeg in the image**: Dockerfile layer `apt-get install -y ffmpeg` (non-fatal, LibreOffice
   pattern). Sandbox already validated 6.1.1 via apt.
2. **`server/src/agent/videoStitch.ts`** — thin, PURE-first wrapper:
   - `buildConcatList(files)` / `concatCmd(listFile, out)` (stream-copy) and
     `xfadeCmd(a, b, out, {fadeS, offsetS})` — pure string builders, unit-tested;
   - `stitchClips(files, out, opts)` + `lastFrame(clip, outJpg)` (`-sseof -0.15`) +
     `probeDuration(clip)` (ffprobe) — exec via `execBash`, graceful "ffmpeg missing" error.
3. **Public clip route** for extension inputs — `server/src/routes/videoSrc.ts`:
   `GET /api/video-src/:token` streams ONE whitelisted file from a session's `videos/` dir.
   Tokens: `mintVideoToken(sessionId, relPath)` → random id in an in-memory map with a 15-min
   TTL + single-use consume-on-read is too strict (the API may fetch with ranges/retries) →
   **TTL-only, path-locked, no auth bypass beyond the minted file**. Allowlisted in `auth.ts`
   like `/api/leads`. Base URL from `config.publicBaseUrl` (https://arksai.studio) — works from
   the droplet; in the sandbox extension probes keep using the task's own volces URL (as probed).
4. **`engines/seedance.ts` additions** (all pure-testable in `buildVideoTask`):
   - `spec.videoUrl` → `{type:'video_url', video_url:{url}, role:'reference_video'}`;
   - correct 2.0 id constants: `dreamina-seedance-2-0-260128`, `dreamina-seedance-2-0-fast-260128`
     (probe §8.1 — the `-fast` suffix sits BEFORE the date; no mini/pro on our account);
   - error classifier: `isContentPolicyError(e)` (copyright/sensitive-output codes).
   Tests: role emission, id table, duration clamps per model, classifier.

**Gate:** unit tests green; a hand-run stitch of two real clips on the droplet after deploy
(ffmpeg present); `/api/video-src/:token` serves exactly the minted file, 404s everything else,
red-team test (another session's video, expired token, path traversal).

## 2. Phase 1 — the scene planner

**`server/src/agent/videoStory.ts`** — `planStory(brief, opts) → StoryPlan` (same fail-open
pattern as `videoBrief.ts`/`designBrief.ts`):

```ts
interface ScenePlan {
  id: number;                       // 1-based, stable for retakes
  what: string;                     // user-visible one-liner
  prompt: string;                   // compiled Seedance prompt for THIS scene
  durationS: number;                // 4–15, planner-chosen "exactly as long as necessary"
  mechanism: 't2v' | 'i2v-composited' | 'frame-chain' | 'extend';
  compositeHtml?: string;           // for i2v-composited: the exact-frame HTML (planner emits it)
  castRefs?: string[];              // workspace image paths → reference_image on 2.0 scenes
  audioDirection: string;           // per-scene diegetic line (one shared bed handles music)
}
interface StoryPlan {
  scenes: ScenePlan[];
  styleLine: string;                // ONE style+light+grade sentence injected into EVERY prompt
  aspect: '16:9' | '9:16' | '1:1';
  cast: { name: string; imagePath?: string }[];
  estUsd: number; estMinutes: number;
}
```

- **LLM pass** (session's model via the existing runner LLM seam) with a strict-JSON contract →
  validated + clamped by pure `normalizeStoryPlan()` (caps from §0; first scene can never be
  `frame-chain`/`extend`; `extend` only directly after the scene it continues; ≤2 hops).
- **Mechanism rules baked into the planner prompt**: continues-the-same-take → `extend`;
  hard cut in the same world → `frame-chain`; anything that must be pixel-exact (app UI, sign,
  menu, scoreboard) → `i2v-composited` + emit the HTML; recurring character/product across
  non-adjacent scenes → castRefs; else `t2v`.
- **Fail-open**: if the LLM/JSON pass fails, a heuristic splitter (sentence/beat segmentation,
  all `frame-chain` after scene 1, equal durations) still returns a valid plan.
- Pure tests: normalization caps, mechanism legality, duration fitting, estimator math,
  fail-open path, the ecosine example fixture (4 scenes, scene 2 = i2v-composited).

**Gate:** unit suite + one live plan for the operator's example printed through the real LLM on
the droplet (no generation) — eyeball the scene table.

## 3. Phase 2 — executor + stitcher (the `generate_video_story` tool)

**New tool `tools/videoStory.ts` → `generate_video_story`** (modes chat+code; gated on the
BytePlus key like `generate_video`):

- Params: `story` (the sequence description) · `aspect_ratio` · `audio` · `dialogue`(voiceover)
  · `cast_images[]` (workspace paths) · `duration_hint` · `final:boolean` ·
  `retake_scene:number` + `retake_note` · `transition:'cut'|'dissolve'` (default cut).
- **Run shape (draft pass):** `planStory` → persist `videos/story-<ts>/manifest.json`
  (plan + per-scene file/params/anchors/tokens/cost) → sequential loop per scene:
  1. resolve anchor: composited HTML → Chromium raster (reuse `rasterizeFrame` from
     productShot.ts); frame-chain → `lastFrame(prev)`; extend → mint `/api/video-src` URL for
     prev clip;
  2. create task (1.5 draft for t2v/i2v/frame-chain; 2.0-fast for extend/castRef scenes) →
     poll with progress beats ("Scene 2 of 4 — the phone close-up…") → download;
  3. on `isContentPolicyError`: ONE LLM reword → retry; still failing → downgrade mechanism to
     the 1.5 equivalent; still failing → mark the scene failed and CONTINUE (the story ships
     with N-1 scenes + an honest note, never a dead run);
  4. deterministic QC: file>0, `probeDuration≈durationS±1`, else one silent re-render.
- **Stitch:** `stitchClips` stream-copy (re-encode only for `dissolve`); stitched draft +
  per-scene files all kept in the story dir; total duration checked = Σ scenes.
- **Return:** the stitched draft as the standard video card payload **plus a `story` block**
  (scene list with per-scene thumbs/durations/mechanisms/costs) → client renders a scene strip.
- **Final pass** (`final:true`): reads the manifest, re-renders each APPROVED scene at 1080p
  reusing the SAME anchors/seeds where the API allows, re-stitches. **Retake**
  (`retake_scene:2, retake_note:"slower tap"`): regenerates ONE scene (note appended to its
  prompt), re-chains any dependent anchor (scene 3's first frame if it frame-chained off 2),
  re-stitches. Cost: only what changed.
- **Cost/progress:** per-scene `ctx.addCost()` from usage tokens × config rates
  (`seedance20CostPerKTok` new env knob; operator confirms the console rate) + TOOL_BEAT
  friendly labels; the plan's `estUsd` is surfaced BEFORE generation in the tool's first
  progress message.
- **Prompt steering:** chat block — a multi-scene/sequence/story ask routes to
  `generate_video_story` (NOT chained generate_video calls); the plan is presented as a compact
  scene table in the reply; drafts always first. Marketing expertise gets a `marketing.storyad`
  play.

Tests: manifest round-trip, retake dependency re-chaining (pure), policy-error downgrade ladder
(mocked engine), stitch invocation shapes, tool schema/registration, steering lock-test.

**Gate (live, droplet):** the ecosine example end-to-end through the live agent — one message →
scene table → 4 drafts → stitched draft card with scene strip → retake scene 3 → final. Cost
visible and sane (≈ $0.3–0.6 drafts, ≈ $2–3 final).

## 4. Phase 3 — the Story studio

`VideoStudio.tsx` gains kind `'story'` (Scene · Product · **Story**):

- **Story box** ("what happens, in order — write it like you'd tell a friend") + cast strip
  (upload character/product stills — reuses the multi-photo tile) + the standard format controls
  (aspect/duration-hint/audio/voiceover) + art-style picker (photo-less stories can use any of
  the 24 styles; the styleLine carries it to every scene).
- One button → the brief instructs the agent to call `generate_video_story` with the exact
  params (same pattern as the Product flow's parameter block).
- **StoryCard** (client): stitched player on top + a **scene strip** below — each scene a
  thumbnail chip (its mechanism icon, duration, cost) with **Retake** (prefills
  "retake scene N: …") and the story-level **Render final** / **Download** actions. Extends the
  existing VideoCard payload; Canvas playback unchanged.
- Library groups story outputs by their story dir (the stitched file is the entry; scenes
  expandable).
- Visual QA per the standing rule (390px + 1280px, both kinds' regressions checked).

**Gate:** Playwright walk — story brief → card with scene strip renders (mock payload) + the
live droplet run from Phase 2 repeated through the studio surface; WhatsNew + FEATURES in the
same commit.

## 5. Phase 4 — polish (each item independent)

- **Suno music bed**: optional `music` param → generate one continuous bed → `amix` under the
  stitched diegetic audio (ducking via `sidechaincompress` if dialogue present).
- **Continuity vision QC**: last frame of scene N vs first of N+1 through `analyzeImage`
  ("same person/wardrobe/light?") → one bounded auto-retake on a hard mismatch.
- **Transitions menu** (dissolve/dip-to-black) + per-scene camera overrides in the studio.
- **4K finals** behind explicit ask; captions option; scheduled/robot story runs
  ("weekly product story").
- **Aspect-consistent product-mode bridge**: "make this a story" from a product ad (the staged
  frame becomes scene 1's anchor).

## 6. Risks & mitigations

- **2.0 copyright filter** (hit twice in probes): the §3 downgrade ladder + honest notes; never
  silently swallow a failed scene.
- **Drift over long chains**: ≤2 extension hops, cast refs re-assert identity at cuts,
  Phase-4 continuity QC.
- **Wall time** (4–8 scenes × 25–120 s + polling): per-scene progress beats + the plan table up
  front (the user knows what's coming); drafts are the fast path (probes: 23–52 s/scene).
- **Cost runaway**: estUsd gate before generating; retakes re-pay one scene; the existing
  per-run render cap applies to scenes.
- **Public clip route** abuse: token TTL + path-lock + red-team tests (Phase 0 gate).
- **Ark key**: still the exposed one — operator rotates; everything reads `byteplusRuntime`,
  no code change needed on rotation.

## 7. Sequencing & estimates

| Phase | Scope | Size |
|---|---|---|
| 0 | ffmpeg + stitch lib + clip route + engine roles | ~1 session, ships alone |
| 1 | planner + tests | ~1 session |
| 2 | executor tool + steering + live gate | the big one, 1–2 sessions |
| 3 | Story studio + StoryCard + visual QA | ~1 session |
| 4 | polish items | independent, as asked |

Success criterion (mirrors SEEDANCE_PLAN §6): a non-technical user types the ecosine paragraph,
watches a stitched draft with a scene strip in ~5–8 minutes, taps "Retake scene 3" once, then
"Render final", and downloads one coherent ~20 s 1080p story with sound — without ever seeing a
model name, a mechanism, or a parameter.
