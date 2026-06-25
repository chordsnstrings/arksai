# MiniMax Hailuo — Video Prompt Playbook & Refiner (validated 2026-06-25)

_Goal: get a near-perfect clip on the FIRST try — we only get ~3 generations/day.
Everything below was confirmed with LIVE API calls + the Toronto example._

---

## 1. Our own system — current state & the real gaps

- Tool `generate_video` → `engines/minimax.ts generateVideo()`.
- Endpoint (validated working): `POST https://api.minimax.io/v1/video_generation` →
  poll `GET /v1/query/video_generation?task_id=` → `GET /v1/files/retrieve?file_id=`.
- Refiner LLM (validated): **M3 via the Anthropic endpoint** `POST https://api.minimax.io/anthropic/v1/messages`
  (thinking off → fast, decisive; returns clean prose). Use this, not the OpenAI `/v1` surface
  (which forces unbounded thinking on M3).
- Models: `MiniMax-Hailuo-02` (our config default) · **`MiniMax-Hailuo-2.3`** (better motion — used for the
  validated clips) · `MiniMax-Hailuo-2.3-fast` (cheaper drafts).

### Validated API param rules (Hailuo 2.3)
- `duration`: **6 or 10** seconds (anything else → error 2013).
- `resolution`: **"768P" or "1080P"**. **10s+1080P is REJECTED** — 1080P is limited to 6s. So:
  - want 10s → use **768P**.  want 1080P → use **6s**.
- `aspect_ratio`: **accepted**; `"9:16"` works for vertical/phone. (Also 16:9 etc.)
- `first_frame_image`: optional data-URL/path to lock the opening frame.
- **Our code gap:** `generateVideo` only sends `{model, prompt, first_frame_image}` — NO
  `duration`/`resolution`/`aspect_ratio`. So today we always get the defaults (16:9, default length).
  Fix when wiring: thread these three params through the tool → engine.
- **Egress gotcha:** the API host `api.minimax.io` is allow-listed, but the result MP4 lives on
  `video-product.cdn.minimax.io`, which the sandbox proxy BLOCKS (403). The download URL is signed
  and expires in a few hours — hand the URL to the user (their browser fetches it fine), or the
  Droplet (open egress) downloads it for the workspace.

---

## 2. How Hailuo wants to be prompted
Hailuo is a **"Director's AI"** — it wants a *script/narrative*, NOT comma-separated tags.

**Element order (matters):**
> **[camera framing + movement] → [action] → [scene with NAMED landmarks/props] → [light + weather + mood] → [how it ends]**
written as ONE flowing, present-tense paragraph.

### Rules that moved the needle (each learned from a real miss)
1. **One continuous shot per generation.** No cuts / "then it switches to…". 6–10s is a single take.
2. **POV is fragile — anchor it hard.** ⚠️ _The #1 failure we hit._ "first person view" alone got
   rewritten to "handheld tracking shot" and Hailuo produced a **third-person follow**. For POV you MUST:
   open with **"First-person POV, head-mounted camera,"** reinforce ("shot entirely from the walker's
   own eyes, no body or back of a person visible"), and **NEVER describe the camera-holder's wardrobe
   or body** — mentioning a coat made Hailuo spawn a separate person walking ahead. Anchor the WORLD,
   not the wearer.
3. **Lighting defaults dim — push it bright.** ⚠️ _Second miss._ "flat cold sunlight / long shadows /
   winter / overcast" rendered dark. Use **"bright midday sun, clear blue sky, warm golden sunlight,
   crisp and well-lit, high-key."**
4. **Name things concretely.** "Yonge-Dundas Square, neon billboards, a red streetcar" >> "a city street."
5. **Pick ONE coherent location.** A 10s walk can't pass landmarks that are miles apart; choose the most
   iconic and let others sit in the skyline.
6. **Strip meta-instructions.** "ensuring the key places are shown" → instead place the landmarks
   physically along the camera's path so they appear naturally.
7. **Write the ending as motion**, e.g. "…and merges into a dense crowd that fills the frame."
8. **For phones:** pass `aspect_ratio:"9:16"` AND tell the prompt "vertical phone framing, tall portrait
   composition; towers rising up the tall frame."
9. **Given 3 gens/day:** refine first (free), prefer 10s@768P for journeys (or 6s@1080P for a crisp hero),
   generate once.

---

## 3. The Refiner (production system prompt — validated)

Run this as a hidden M3 refine step (Anthropic endpoint) BEFORE `generate_video`. Costs ~nothing,
saves a precious daily generation.

```
You are a cinematographer who writes prompts for the MiniMax Hailuo video model.
Rewrite the user's idea into ONE flowing, present-tense shot description (a single
continuous 6-10s take, no cuts). Element order:
[camera framing + movement] -> [action] -> [scene with NAMED landmarks/props] ->
[light + weather + mood] -> [how it ends].

POV IS CRITICAL: for first-person/POV, open with "First-person POV, head-mounted
camera," reinforce it ("shot entirely from the walker's own eyes, no body or back of
a person visible"), and NEVER describe the camera-holder's wardrobe or body (it spawns
a third-person subject). Anchor the WORLD, not the wearer. For third-person, frame an
external subject normally with wardrobe anchors.

LIGHTING: render BRIGHT and well-lit by default — "bright midday sun, clear blue sky,
warm golden sunlight, crisp and luminous." Avoid dark/cold/flat/overcast/winter/
long-shadow wording (it comes out dim) unless the user explicitly wants night/moody.

FRAMING: if the target is phones/social, compose vertical — "vertical phone framing,
tall portrait composition," emphasise what's straight ahead and overhead.

OTHER: one unbroken move, no cuts. Replace vague nouns with concrete named ones. Pick
ONE coherent location; far-apart icons go only in the skyline. Never copy meta-
instructions ("make sure X is shown") — place X physically along the path. Simple,
non-conflicting camera terms. End with the requested final beat written as motion.
40-90 words. No tag lists, no quality words. Output ONLY the rewritten prompt.
```

Deterministic params to attach alongside: `duration:10, resolution:"768P"` (or `6/"1080P"`),
`aspect_ratio:"9:16"` for phones / `"16:9"` for wide, `model:"MiniMax-Hailuo-2.3"`.

---

## 4. Worked example — the Toronto request (3 real runs)

**User's line:** "a first person view of someone walking in the streets of toronto canada, ensuring
the key toronto places are shown, and ends with walking into a crowd"

**Run 1 (FAILED — third person):** refiner dropped POV → "Handheld tracking shot… the camera carrying
a dark wool overcoat…" → Hailuo followed a woman in a coat from behind. Lesson → rules #2.

**Run 2 (POV fixed, but dim):** "First-person POV, head-mounted camera… flat cold sunlight… slushy
pavement…" → correct POV, but too dark. Lesson → rule #3.

**Run 3 (FINAL — bright, vertical, phone):**
> First-person POV, head-mounted camera, walking through downtown Toronto entirely from the walker's
> own eyes, no body visible. Bright midday sun, clear blue sky, warm golden sunlight, crisp and
> well-lit. Vertical phone framing, tall portrait composition. The camera moves forward along a sunlit
> sidewalk, passing the reflective glass curves of the Rogers Centre rising up the frame on the left,
> then approaching the tall CN Tower rising straight overhead into the blue sky ahead. Continuing
> forward, the Steam Whistle Brewing sign and the giant white letters of the Toronto Sign appear
> directly ahead in Nathan Phillips Square. Walking onward, the view moves steadily toward a dense
> crowd of pedestrians gathered in the sunlit square, the camera merging into the crowd.

Params: `MiniMax-Hailuo-2.3`, `duration:10`, `resolution:"768P"`, `aspect_ratio:"9:16"`.

---

## 5. To wire live (small, when given the go)
1. Hidden M3 refine step (§3 prompt) → optional one-tap approval of the refined prompt.
2. Thread `duration` / `resolution` / `aspect_ratio` through `generate_video` → `generateVideo`
   (the current gap). Default 10s/768P, expose a "phone vs wide" choice → 9:16 vs 16:9.
3. On the Droplet (open egress) the MP4 downloads into the workspace; in-sandbox, return the signed URL.
4. Default model → `MiniMax-Hailuo-2.3`.
