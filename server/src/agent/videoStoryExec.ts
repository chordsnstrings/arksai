import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { generateText, analyzeImage, fileToDataUrl, modelarkReady, embedImage, cosine } from '../engines/modelark';
import { generateMusic } from '../engines/suno';
import {
  createVideoTask,
  pollVideoTask,
  downloadVideo,
  isContentPolicyError,
  videoCostEstimate,
  type VideoSpec,
} from '../engines/seedance';
import { compileVideoPrompt, splitSentences } from './videoBrief';
import { rasterizeFrame } from './productShot';
import {
  stitchClips,
  extractLastFrame,
  extractFirstFrame,
  extractFrameAt,
  probeDuration,
  mixMusicBed,
  burnCaptions,
} from './videoStitch';
import { mintVideoToken } from '../routes/videoSrc';
import { Semaphore } from '../lib/semaphore';
import {
  planStory,
  estimateStory,
  EXTEND_INPUT_KTOK_480P,
  type ScenePlan,
  type StoryPlan,
  type PlanStoryOpts,
} from './videoStory';

/**
 * Story executor (STORY_PLAN Phase 2) — runs a StoryPlan scene by scene, resolves each scene's
 * continuity anchor, survives the provider's output-copyright filter with a bounded ladder,
 * stitches the result, and persists a MANIFEST so retakes and finals only re-pay what changed.
 *
 * Mechanism → engine routing (probe-locked, SCENES_RESEARCH §8):
 *   t2v / i2v-composited / frame-chain → Video 1.5 (draft mode for the draft pass)
 *   extend / any scene with castRefs   → Video 2.0-fast r2v (no draft tier; still 480p drafts)
 * Copyright-filter ladder: one LLM reword → downgrade extend→frame-chain (2.0→1.5) →
 * mark the scene failed and CONTINUE — a story ships with N-1 scenes and an honest note,
 * never as a dead run.
 * After the scenes render, a Skylark-embedding CONTINUITY REVIEW (advisory, never fatal) scores
 * every chained cut and each scene's look against the first scene — see continuityAdvisories.
 * NARRATION (operator choice: Seedance native audio, no TTS): the story's `dialogue` is split by
 * sentence across the scenes in proportion to their durations (splitNarration) and each part is
 * voiced natively inside its scene's render as an off-screen narrator (buildScenePrompt).
 */

export interface SceneResult {
  id: number;
  what: string;
  mechanismPlanned: ScenePlan['mechanism'];
  mechanismUsed: ScenePlan['mechanism'];
  status: 'ok' | 'failed';
  file?: string; // repo-relative clip path
  durationS?: number; // probed actual
  tokens?: number;
  note?: string;
  /** Branded model + resolution actually rendered (drives the per-second cost estimate). */
  model?: string;
  resolution?: string;
}

export interface StoryManifest {
  id: string;
  createdAt: number;
  story: string;
  aspect: string;
  audio: boolean;
  dialogue?: string;
  transition: 'cut' | 'dissolve' | 'fade-black';
  plan: StoryPlan;
  pass: 'draft' | 'final';
  scenes: SceneResult[];
  stitched?: string; // repo-relative stitched output
  totalTokens: number;
  costUsd: number;
  /** Phase 4 options, persisted so finals/retakes repeat them. */
  music?: string; // a music-bed style description (Suno)
  musicFile?: string; // the generated bed, reused across passes
  captions?: boolean;
  openingFrame?: string; // workspace image path anchoring scene 1 (product-story bridge)
  /** Universal style key (workspace image path): attached as a style-only reference to every
   *  plain t2v scene so the look never drifts across shots (the Higgsfield style-key pattern).
   *  Scenes with their own visual anchor (cast refs, opening frame, frame-chain, extend,
   *  composited frame) keep that stronger anchor instead. */
  styleAnchor?: string;
  resolution?: '1080p' | '4k';
  /** Skylark continuity review of the latest pass: raw similarity scores (kept for threshold
   *  calibration) and the advisory notes they produced. Advisory only — never fails a story. */
  continuityScores?: ContinuityScore[];
  advisories?: string[];
}

/* ── Skylark continuity review (advisory) ────────────────────────────────── */

/** Cosine floor between a scene's last frame and the next chained scene's first frame. A
 *  frame-chained cut opens ON the previous last frame, so a healthy cut scores high. Initial
 *  calibration — tune against real stories using the persisted continuityScores. */
export const CONTINUITY_MIN_COSINE = 0.8;
/** Cosine floor between each scene's middle frame and the first scene's (style/look drift).
 *  Different shots of one story legitimately differ in content, so this floor sits lower. */
export const STYLE_DRIFT_MIN_COSINE = 0.7;

export interface ContinuityScore {
  kind: 'cut' | 'style';
  sceneId: number;
  /** The scene it was compared against (the previous clip for a cut, the first clip for style). */
  refSceneId: number;
  cosine: number;
}

/** Advisory notes for the scores under their floors. PURE. */
export function continuityAdvisories(scores: ContinuityScore[]): string[] {
  const out: string[] = [];
  for (const s of scores) {
    if (s.kind === 'cut' && s.cosine < CONTINUITY_MIN_COSINE) {
      out.push(
        `scene ${s.sceneId} may not continue cleanly from scene ${s.refSceneId} (similarity ${s.cosine.toFixed(2)} across the cut) — a retake of scene ${s.sceneId} usually fixes it`,
      );
    } else if (s.kind === 'style' && s.cosine < STYLE_DRIFT_MIN_COSINE) {
      out.push(`scene ${s.sceneId}'s look may have drifted from scene ${s.refSceneId} (style similarity ${s.cosine.toFixed(2)})`);
    }
  }
  return out;
}

export type FramePos = 'first' | 'mid' | 'last';

export interface ContinuityPair {
  kind: ContinuityScore['kind'];
  sceneId: number;
  refSceneId: number;
  at: FramePos; // which frame of the scene
  refAt: FramePos; // which frame of the reference scene
}

/**
 * Which comparisons the review makes over the successful scenes (plan order). PURE.
 *  - cut: only scenes that are SUPPOSED to continue the previous clip (frame-chain / extend),
 *    last frame of the previous successful clip → first frame of this one. Fresh shots (t2v) and
 *    composited exact-frame openings cut to something new by design, so they're not scored.
 *  - style: each scene's middle frame vs the first scene's middle frame. Composited exact-frame
 *    scenes (an app UI, a sign) are a different look by design and are skipped.
 */
export function continuityPairs(scenes: Pick<SceneResult, 'id' | 'mechanismUsed'>[]): ContinuityPair[] {
  const pairs: ContinuityPair[] = [];
  for (let i = 1; i < scenes.length; i++) {
    const s = scenes[i];
    if (s.mechanismUsed === 'frame-chain' || s.mechanismUsed === 'extend') {
      pairs.push({ kind: 'cut', sceneId: s.id, refSceneId: scenes[i - 1].id, at: 'first', refAt: 'last' });
    }
  }
  const styled = scenes.filter((s) => s.mechanismUsed !== 'i2v-composited');
  for (let i = 1; i < styled.length; i++) {
    pairs.push({ kind: 'style', sceneId: styled[i].id, refSceneId: styled[0].id, at: 'mid', refAt: 'mid' });
  }
  return pairs;
}

/* ── billing ─────────────────────────────────────────────────────────────── */

/** Seedance 2.0 OUTPUT-token density at 480p, in K tokens per second — probed SCENES_RESEARCH §8.8
 *  (a 4 s 2.0-fast r2v with an image ref = 40.6 k tokens ≈ 10.15 k/s). Scales with frame area. */
const V20_OUT_KTOK_PER_S_480P = 10.15;
const RES_AREA_VS_480P: Record<string, number> = { '480p': 1, '720p': 2.25, '1080p': 5.0625, '4k': 20.25 };

/**
 * The INPUT-clip component of an extension (reference_video) render, which the per-second table
 * (output only) doesn't cover. Token-based when the task reported its usage — total tokens minus
 * the output's own share — else the same planning constant estimateStory quotes
 * (EXTEND_INPUT_KTOK_480P, scaled by frame area for a higher-resolution pass). PURE.
 */
export function extendInputClipUsd(tokens: number | undefined, resolution: string, durationS: number): number {
  const area = RES_AREA_VS_480P[String(resolution).toLowerCase()] ?? 1;
  const kTok = tokens
    ? Math.max(0, tokens / 1000 - V20_OUT_KTOK_PER_S_480P * area * Math.max(0, Number(durationS) || 0))
    : EXTEND_INPUT_KTOK_480P * area;
  return kTok * config.seedanceCostPerKTok;
}

export const storyDirName = (id: string) => `videos/story-${id}`;
const manifestPath = (repoDir: string, id: string) => path.join(repoDir, storyDirName(id), 'manifest.json');

export function saveManifest(repoDir: string, m: StoryManifest): void {
  const p = manifestPath(repoDir, m.id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
}

export function loadManifest(repoDir: string, id: string): StoryManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(repoDir, id), 'utf8'));
  } catch {
    return null;
  }
}

/** The most recent story in the workspace (for final/retake calls that omit the id). */
export function latestStoryId(repoDir: string): string | null {
  try {
    const dirs = fs
      .readdirSync(path.join(repoDir, 'videos'))
      .filter((d) => d.startsWith('story-') && fs.existsSync(path.join(repoDir, 'videos', d, 'manifest.json')))
      .sort();
    const last = dirs.pop();
    return last ? last.slice('story-'.length) : null;
  } catch {
    return null;
  }
}

/**
 * Which scenes must be re-rendered when `sceneId` changes: the scene itself plus every
 * DOWNSTREAM scene whose anchor depends on it (a contiguous run of frame-chain/extend). PURE.
 */
export function dependentScenes(plan: Pick<StoryPlan, 'scenes'>, sceneId: number): number[] {
  const ids = [sceneId];
  const scenes = plan.scenes;
  const start = scenes.findIndex((s) => s.id === sceneId);
  if (start < 0) return ids;
  for (let i = start + 1; i < scenes.length; i++) {
    if (scenes[i].mechanism === 'frame-chain' || scenes[i].mechanism === 'extend') ids.push(scenes[i].id);
    else break;
  }
  return ids;
}

/* ── narration (native audio, no TTS) ────────────────────────────────────── */

/** A natural narration pace is ~2.5 words/s; past this the voiceover is rushed or clipped. */
export const NARRATION_MAX_WORDS_PER_S = 3;

const wordCount = (t: string): number => t.split(/\s+/).filter(Boolean).length;

/** Split a voiceover into sentences — videoBrief's abbreviation/initial-aware splitter, so "Mr. Khan"
 *  is never voiced as "Say hi to Mr." in one scene and "Khan." after a cut. A blank line is a hard
 *  break; a single newline is a soft wrap unless the line ends a sentence (judged with the next
 *  line's first word); a lowercase continuation — `"Ready?" she asks.` — stays one sentence, and a
 *  trailing emoji run stays with its sentence (never a scene of its own). PURE. */
export function narrationSentences(text: string): string[] {
  return splitSentences(text);
}

/** Scenes whose share of the voiceover (one splitNarration part each, in scene order) exceeds
 *  NARRATION_MAX_WORDS_PER_S × that scene's duration — the global guard can pass while sentence
 *  granularity still crams one long sentence into a short scene. PURE. */
export function overPackedScenes(
  parts: string[],
  scenes: Pick<ScenePlan, 'id' | 'durationS'>[],
): { id: number; words: number; durationS: number }[] {
  return scenes
    .map((s, i) => ({ id: s.id, words: wordCount(parts[i] ?? ''), durationS: s.durationS }))
    .filter((p) => p.words > NARRATION_MAX_WORDS_PER_S * p.durationS);
}

/**
 * Split the story's voiceover across its scenes: whole sentences only (never mid-sentence), in
 * order, each scene's share of the words as close as possible to its share of the running time
 * (an exact DP over contiguous sentence groups minimising squared deviation; ties put a line in
 * the EARLIER scene, so a single line opens the story). A scene can get '' when there are fewer
 * sentences than scenes. Returns one entry per scene. PURE.
 */
export function splitNarration(dialogue: string | undefined, durations: number[]): string[] {
  const n = durations.length;
  const out: string[] = new Array(n).fill('');
  const sentences = narrationSentences(dialogue ?? '');
  const k = sentences.length;
  if (!n || !k) return out;
  const pre = [0];
  for (const t of sentences) pre.push(pre[pre.length - 1] + Math.max(1, wordCount(t)));
  const W = pre[k];
  const dur = durations.map((d) => Math.max(0, Number(d) || 0));
  const D = dur.reduce((a, b) => a + b, 0);
  const target = dur.map((d) => (D > 0 ? (W * d) / D : W / n));
  // best[j][i] = min cost of giving sentences [0, i) to scenes [0, j); cut[j][i] = where scene j-1 starts.
  const best = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(Infinity));
  const cut = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0));
  best[0][0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = 0; i <= k; i++) {
      for (let h = i; h >= 0; h--) {
        if (best[j - 1][h] === Infinity) continue;
        const c = best[j - 1][h] + (pre[i] - pre[h] - target[j - 1]) ** 2;
        if (c < best[j][i] - 1e-9) {
          best[j][i] = c;
          cut[j][i] = h;
        }
      }
    }
  }
  for (let j = n, i = k; j >= 1; j--) {
    const h = cut[j][i];
    out[j - 1] = sentences.slice(h, i).join(' ');
    i = h;
  }
  return out;
}

/**
 * The full per-scene prompt: scene prompt + the shared style line + diegetic audio, plus this
 * scene's part of the voiceover when the story has one. Narration uses videoBrief's proven
 * synced-speech signal — the spoken words IN QUOTES after "Audio:" — framed as an OFF-SCREEN
 * narrator so nobody on screen lip-syncs it; the scene's ambience stays underneath. PURE.
 */
export function buildScenePrompt(scene: ScenePlan, styleLine: string, extra?: string, narration?: string): string {
  const ambience = scene.audioDirection.trim().replace(/[.\s]+$/, '');
  const vo = narration?.trim().replace(/"/g, "'");
  const audio = vo
    ? `Audio: a clear narrator says "${vo}" (off-screen voiceover, spoken verbatim, unhurried), with ${ambience} softly underneath.`
    : `Audio: ${ambience}.`;
  const parts = [scene.prompt.trim(), styleLine.trim(), audio];
  if (extra?.trim()) parts.push(extra.trim());
  return compileVideoPrompt({ brief: parts.join(' '), durationSec: scene.durationS });
}

/** Wrap a planner-emitted composite fragment into a full sized page for rastering. PURE. */
export function compositePage(html: string, w: number, h: number): string {
  const doc = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}</style></head><body>${html}</body></html>`;
  return doc;
}

const FRAME_SIZES: Record<string, { w: number; h: number }> = {
  '16:9': { w: 1280, h: 720 },
  '9:16': { w: 720, h: 1280 },
  '1:1': { w: 1024, h: 1024 },
};

async function rewordPrompt(prompt: string, signal: AbortSignal): Promise<string> {
  try {
    if (modelarkReady()) {
      const r = await generateText(
        `Rewrite this video prompt so it cannot be mistaken for copyrighted or branded footage — keep the exact same action, subject and mood, change phrasing and any brand-adjacent detail to generic equivalents. Keep any words inside double quotes (lines spoken aloud) EXACTLY verbatim, still in double quotes. Output only the rewritten prompt.\n\n${prompt.slice(0, 1500)}`,
        signal,
        { maxTokens: 700, system: 'You rewrite prompts. Output only the rewritten prompt, nothing else.' },
      );
      if (r.ok && r.text && r.text.trim().length > 20) return r.text.trim();
    }
  } catch {
    /* fall through */
  }
  return `Original, generic, unbranded footage (no resemblance to any existing film or ad): ${prompt}`;
}

export interface ExecuteOpts {
  repoDir: string;
  signal: AbortSignal;
  addCost: (usd: number) => void;
  final?: boolean;
  /** Restrict execution to these scene ids (retakes); others reuse manifest clips. */
  onlyScenes?: number[];
  retakeNote?: string;
  /** Test seam: fake the generate step (returns a local file). */
  generate?: (spec: VideoSpec, sceneId: number) => Promise<{ file: string; tokens?: number }>;
  /** Test seam: embed one frame of a clip for the continuity review (null = unavailable). By
   *  default Skylark runs only on real renders (not under a faked `generate`). */
  embedFrame?: (clipAbs: string, at: FramePos, durationS?: number) => Promise<number[] | null>;
}

/** Generate ONE scene (with the copyright ladder). Returns the clip path + bookkeeping. */
async function runScene(
  scene: ScenePlan,
  plan: StoryPlan,
  m: StoryManifest,
  prevClipAbs: string | null,
  o: ExecuteOpts,
  narration?: string,
): Promise<SceneResult> {
  const dir = path.join(o.repoDir, storyDirName(m.id));
  fs.mkdirSync(dir, { recursive: true });
  const size = FRAME_SIZES[m.aspect] ?? FRAME_SIZES['16:9'];
  let mechanism = scene.mechanism;
  let note: string | undefined;

  // Anchors that need the previous clip degrade honestly when it's missing (a failed prev scene).
  if ((mechanism === 'frame-chain' || mechanism === 'extend') && !prevClipAbs) {
    note = 'previous scene unavailable — rendered as a fresh shot';
    mechanism = 't2v';
  }

  const buildSpec = async (mech: ScenePlan['mechanism'], prompt: string): Promise<VideoSpec> => {
    const useRefs = (scene.castRefs?.length ?? 0) > 0;
    // Style anchor applies ONLY to plain t2v scenes with no anchor of their own — every other
    // mechanism already carries a stronger visual anchor (cast, prev frame, composite, video).
    const anchorAbs = m.styleAnchor ? path.resolve(o.repoDir, m.styleAnchor) : null;
    // Scene 1's opening frame only anchors when the file actually RESOLVES (existsSync below),
    // so the style-anchor suppression must key off the SAME existence check — otherwise a
    // truthy-but-missing openingFrame (typo path, checkpoint-resumed workspace) would leave
    // scene 1 with NEITHER anchor, the exact first-shot drift the style anchor exists to prevent.
    const openingFrameAbs =
      scene.id === 1 && m.openingFrame && mech !== 'i2v-composited' ? path.resolve(o.repoDir, m.openingFrame) : null;
    const openingFrameApplies = !!openingFrameAbs && fs.existsSync(openingFrameAbs);
    const useStyleAnchor =
      !!anchorAbs && fs.existsSync(anchorAbs) && mech === 't2v' && !useRefs && !openingFrameApplies;
    const spec: VideoSpec = {
      prompt: useStyleAnchor
        ? `Match the reference image's visual STYLE exactly — palette, colour grade, lighting, lens character — but do NOT copy its content or subjects. ${prompt}`
        : prompt,
      aspect: m.aspect,
      duration: scene.durationS,
      // A scene that carries narration MUST render native audio — it's the only voice there is.
      audio: m.audio || !!narration?.trim(),
      model: mech === 'extend' || useRefs || useStyleAnchor ? 'arksai-video-20-fast' : 'arksai-video-15',
      draft: !o.final,
      // 4K only when the story explicitly asked for it (STORY_PLAN Phase 4).
      resolution: o.final ? (m.resolution === '4k' ? '4k' : '1080p') : '480p',
    };
    if (useRefs) {
      spec.referenceUrls = (scene.castRefs ?? []).map((p) => fileToDataUrl(path.resolve(o.repoDir, p)));
    } else if (useStyleAnchor) {
      spec.referenceUrls = [fileToDataUrl(anchorAbs!)];
    }
    // Product-story bridge: an explicit opening frame anchors scene 1 (e.g. the staged
    // product frame from a product ad — "make this a story"). Same existence gate as the
    // style-anchor suppression above, so exactly one of the two anchors scene 1.
    if (openingFrameApplies) spec.imageUrl = fileToDataUrl(openingFrameAbs!);
    if (mech === 'i2v-composited' && scene.compositeHtml) {
      const frame = path.join(dir, `scene-${scene.id}-frame.jpg`);
      await rasterizeFrame(compositePage(scene.compositeHtml, size.w, size.h), size.w, size.h, frame);
      spec.imageUrl = fileToDataUrl(frame);
    } else if (mech === 'frame-chain' && prevClipAbs) {
      const anchor = path.join(dir, `scene-${scene.id}-anchor.jpg`);
      await extractLastFrame(prevClipAbs, anchor, o.signal);
      spec.imageUrl = fileToDataUrl(anchor);
    } else if (mech === 'extend' && prevClipAbs) {
      const token = mintVideoToken(prevClipAbs);
      spec.videoUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/api/video-src/${token}`;
      spec.prompt = `Continue this exact video seamlessly from its final moment — same subjects, same setting, same light, same camera: ${prompt}`;
    }
    return spec;
  };

  const generateOnce = async (
    mech: ScenePlan['mechanism'],
    prompt: string,
  ): Promise<{ file: string; tokens?: number; model?: string; resolution?: string }> => {
    const spec = await buildSpec(mech, prompt);
    const used = { model: spec.model, resolution: spec.resolution };
    if (o.generate) return { ...(await o.generate(spec, scene.id)), ...used };
    const { id, built } = await createVideoTask(spec, o.signal);
    const done = await pollVideoTask(id, o.signal);
    if (!done.ok) throw new Error(done.error);
    const file = path.join(dir, `scene-${scene.id}${o.final ? '-final' : ''}.mp4`);
    await downloadVideo(done.videoUrl, file, o.signal);
    return { file, tokens: done.tokens, model: built.model, resolution: built.resolution };
  };

  const prompt0 = buildScenePrompt(scene, plan.styleLine, o.onlyScenes?.includes(scene.id) ? o.retakeNote : undefined, narration);
  // The ladder: as planned → reworded → mechanism downgraded to the 1.5 cut → failed-but-continue.
  const attempts: { mech: ScenePlan['mechanism']; prompt: () => Promise<string>; note?: string }[] = [
    { mech: mechanism, prompt: async () => prompt0 },
    { mech: mechanism, prompt: async () => rewordPrompt(prompt0, o.signal), note: 'reworded after a content-policy block' },
  ];
  if (mechanism === 'extend') {
    attempts.push({
      mech: prevClipAbs ? 'frame-chain' : 't2v',
      prompt: async () => prompt0,
      note: 'the provider blocked the continuation — rendered as a cut instead',
    });
  }
  let lastErr = '';
  for (const attempt of attempts) {
    try {
      const r = await generateOnce(attempt.mech, await attempt.prompt());
      const durationS = await probeDuration(r.file, undefined, o.signal);
      return {
        id: scene.id,
        what: scene.what,
        mechanismPlanned: scene.mechanism,
        mechanismUsed: attempt.mech,
        status: 'ok',
        file: path.relative(o.repoDir, r.file),
        durationS: durationS || scene.durationS,
        tokens: r.tokens,
        note: [note, attempt.note].filter(Boolean).join('; ') || undefined,
        model: r.model,
        resolution: r.resolution,
      };
    } catch (e: any) {
      lastErr = String(e?.message ?? e);
      if (o.signal.aborted) break;
      if (!isContentPolicyError(lastErr)) break; // only the policy filter walks the ladder
    }
  }
  return {
    id: scene.id,
    what: scene.what,
    mechanismPlanned: scene.mechanism,
    mechanismUsed: mechanism,
    status: 'failed',
    note: `scene failed: ${lastErr.slice(0, 200)}`,
  };
}

/** Execute a plan (or re-execute part of one). Persists the manifest as it goes. */
export async function executeStory(
  m: StoryManifest,
  o: ExecuteOpts,
): Promise<StoryManifest> {
  const dir = path.join(o.repoDir, storyDirName(m.id));
  fs.mkdirSync(dir, { recursive: true });
  let prevClipAbs: string | null = null;
  let continuityRetakes = 1; // Phase 4: at most ONE vision-driven auto-retake per story pass
  const results: SceneResult[] = [];
  // The voiceover, split by sentence across the planned scenes (deterministic, so a retake or a
  // final re-voices exactly the same part of the line in the same scene).
  const narrationParts = splitNarration(m.dialogue, m.plan.scenes.map((s) => s.durationS));
  const narrationFor = (sceneId: number): string | undefined =>
    narrationParts[m.plan.scenes.findIndex((s) => s.id === sceneId)] || undefined;
  // Bill every render that came back (a clip discarded by the continuity retake was still
  // paid for): the official per-second rate for the model × resolution actually rendered, plus
  // — for an extension — the tokenized input clip the per-second table doesn't cover.
  // Tokens are still tallied; a result without a recorded model falls back to the token rate
  // (a task's total tokens already include any input clip).
  const bill = (r: SceneResult, fallbackS: number): void => {
    if (r.status !== 'ok') return;
    const resolution = r.resolution ?? (o.final ? '1080p' : '480p');
    const durationS = r.durationS ?? fallbackS;
    const usd = r.model
      ? videoCostEstimate(r.model, resolution, durationS) +
        (r.mechanismUsed === 'extend' ? extendInputClipUsd(r.tokens, resolution, durationS) : 0)
      : ((r.tokens ?? 0) / 1000) * config.seedanceCostPerKTok;
    m.costUsd += usd;
    m.totalTokens += r.tokens ?? 0;
    if (usd) o.addCost(usd);
  };
  for (const scene of m.plan.scenes) {
    if (o.signal.aborted) break;
    const reuse = o.onlyScenes && !o.onlyScenes.includes(scene.id) ? m.scenes.find((s) => s.id === scene.id && s.status === 'ok') : null;
    let res: SceneResult;
    if (reuse?.file && fs.existsSync(path.join(o.repoDir, reuse.file))) {
      res = reuse;
    } else {
      res = await runScene(scene, m.plan, m, prevClipAbs, o, narrationFor(scene.id));
      bill(res, scene.durationS);
      // Continuity vision QC (Phase 4): a frame-chained cut whose opening visibly breaks from
      // the previous scene (person/wardrobe/light) gets ONE bounded auto-retake.
      if (
        res.status === 'ok' &&
        res.file &&
        scene.mechanism === 'frame-chain' &&
        prevClipAbs &&
        continuityRetakes > 0 &&
        modelarkReady() &&
        !o.generate
      ) {
        const verdict = await continuityCheck(prevClipAbs, path.join(o.repoDir, res.file), dir, scene.id, o.signal, o.addCost);
        if (verdict === 'mismatch') {
          continuityRetakes -= 1;
          const retry = await runScene(
            { ...scene, prompt: `${scene.prompt} CONTINUITY: match the provided first frame exactly — the same person, same wardrobe, same lighting, same setting.` },
            m.plan,
            m,
            prevClipAbs,
            o,
            narrationFor(scene.id),
          );
          bill(retry, scene.durationS);
          if (retry.status === 'ok') {
            res = { ...retry, note: [retry.note, 'auto-retaken once for continuity'].filter(Boolean).join('; ') };
          }
        }
      }
    }
    results.push(res);
    if (res.status === 'ok' && res.file) prevClipAbs = path.join(o.repoDir, res.file);
    m.scenes = mergeScenes(m.scenes, results);
    saveManifest(o.repoDir, m);
  }
  m.scenes = mergeScenes(m.scenes, results);
  // Stitch whatever succeeded, in scene order.
  const okScenes = m.plan.scenes
    .map((s) => m.scenes.find((r) => r.id === s.id))
    .filter((r): r is SceneResult => !!r && r.status === 'ok' && !!r.file);
  const okFiles = okScenes.map((r) => path.join(o.repoDir, r.file!));
  if (!o.signal.aborted) await continuityReview(m, okScenes, dir, o);
  if (okFiles.length) {
    // Output named for its SUBJECT (from the user's own story words), never a generic "story".
    const slug =
      m.story
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/g, '') || 'story';
    let out = path.join(dir, o.final ? `${slug}-final.mp4` : `${slug}-draft.mp4`);
    await stitchClips(okFiles, out, { transition: m.transition, signal: o.signal });
    // Phase 4: ONE continuous music bed under the whole story (diegetic scene audio stays;
    // the bed ducks under the natively-voiced narration when there's a voiceover). The bed is
    // generated once and reused.
    if (m.music) {
      const bedAbs = await ensureMusicBed(m, o);
      if (bedAbs) {
        const mixed = out.replace(/\.mp4$/, '-scored.mp4');
        if (await mixMusicBed(out, bedAbs, mixed, { duck: !!m.dialogue, signal: o.signal })) out = mixed;
      }
    }
    // Phase 4: burned captions of the voiceover line, only on explicit ask.
    if (m.captions && m.dialogue) {
      const captioned = out.replace(/\.mp4$/, '-captioned.mp4');
      if (await burnCaptions(out, captioned, m.dialogue, o.signal)) out = captioned;
    }
    m.stitched = path.relative(o.repoDir, out);
  }
  m.pass = o.final ? 'final' : 'draft';
  saveManifest(o.repoDir, m);
  return m;
}

/** Generate (once) and cache the Suno music bed for a story. Fail-soft: null keeps the clean cut. */
async function ensureMusicBed(m: StoryManifest, o: ExecuteOpts): Promise<string | null> {
  if (m.musicFile) {
    const abs = path.resolve(o.repoDir, m.musicFile);
    if (fs.existsSync(abs)) return abs;
  }
  if (!config.sunoApiKey || !m.music) return null;
  try {
    const r = await generateMusic(
      { prompt: `Instrumental only. ${m.music}`, instrumental: true, style: m.music.slice(0, 900), title: 'story score' },
      o.repoDir,
      o.signal,
    );
    const f = r.ok ? r.files[0]?.path : undefined;
    if (!f) return null;
    o.addCost(config.sunoCostPerTrack);
    m.musicFile = f;
    saveManifest(o.repoDir, m);
    return path.resolve(o.repoDir, f);
  } catch {
    return null;
  }
}

/** Vision continuity check: prev scene's final frame vs the new scene's opening frame. Both
 *  frames go into ONE vision message (the model compares them directly). */
async function continuityCheck(
  prevClipAbs: string,
  newClipAbs: string,
  dir: string,
  sceneId: number,
  signal: AbortSignal,
  addCost: (usd: number) => void,
): Promise<'match' | 'mismatch' | 'unknown'> {
  const a = path.join(dir, `.qc-${sceneId}-prev.jpg`);
  const b = path.join(dir, `.qc-${sceneId}-next.jpg`);
  try {
    await extractLastFrame(prevClipAbs, a, signal);
    await extractFirstFrame(newClipAbs, b, signal);
    const r = await analyzeImage(
      [fileToDataUrl(a), fileToDataUrl(b)],
      'The FIRST image is the final frame of one scene; the SECOND image is the first frame of the next scene, which cuts directly from it. Judge only gross continuity across the cut: same person (if any), same wardrobe, same location, compatible lighting. Answer exactly MATCH or MISMATCH followed by a 5-word reason.',
      signal,
    );
    if (r.ok || r.costUsd) addCost(r.costUsd ?? config.arkVisionCost);
    if (!r.ok || !r.text) return 'unknown';
    return /\bMISMATCH\b/i.test(r.text) ? 'mismatch' : 'match';
  } catch {
    return 'unknown';
  } finally {
    for (const f of [a, b]) fs.rmSync(f, { force: true });
  }
}

/** ffmpeg frame extractions for the continuity review run at most this many at once — process-wide
 *  (each is a decode process; a review asks for ~2 frames per scene, and stories in different
 *  sessions can review at the same time). The Skylark embeds ride the engine's own embed limiter. */
export const FRAME_EXTRACT_CONCURRENCY = 2;
const frameExtractLimiter = new Semaphore(FRAME_EXTRACT_CONCURRENCY);

/** Extract one frame (first / middle / last) of a clip to `out` with ffmpeg. */
async function extractReviewFrame(clipAbs: string, at: FramePos, out: string, durationS: number | undefined, signal: AbortSignal): Promise<void> {
  if (at === 'first') await extractFirstFrame(clipAbs, out, signal);
  else if (at === 'last') await extractLastFrame(clipAbs, out, signal);
  else {
    const dur = durationS || (await probeDuration(clipAbs, undefined, signal));
    await extractFrameAt(clipAbs, dur / 2, out, signal);
  }
}

/** Default frame embedder: extract the frame with ffmpeg (bounded by FRAME_EXTRACT_CONCURRENCY),
 *  embed it with Skylark. Fail-soft (null). `deps` is a test seam. */
export function skylarkFrameEmbedder(
  dir: string,
  o: Pick<ExecuteOpts, 'signal' | 'addCost'>,
  deps: { extract?: typeof extractReviewFrame; embed?: typeof embedImage } = {},
): NonNullable<ExecuteOpts['embedFrame']> {
  const extract = deps.extract ?? extractReviewFrame;
  const embed = deps.embed ?? embedImage;
  return async (clipAbs, at, durationS) => {
    const out = path.join(dir, `.emb-${path.basename(clipAbs, path.extname(clipAbs))}-${at}.jpg`);
    try {
      const release = await frameExtractLimiter.acquire(o.signal);
      try {
        await extract(clipAbs, at, out, durationS, o.signal);
      } finally {
        release();
      }
      const r = await embed(out, o.signal);
      if (!r.ok || !r.vector) return null;
      o.addCost(config.arkEmbedCost);
      return r.vector;
    } catch {
      return null;
    } finally {
      fs.rmSync(out, { force: true });
    }
  };
}

/**
 * Skylark continuity review (advisory): embeds the frames continuityPairs asks for, scores each
 * pair by cosine, and records the scores + advisories on the manifest. NEVER throws and never
 * fails a story — an embedding error just leaves that pair unscored.
 */
async function continuityReview(m: StoryManifest, okScenes: SceneResult[], dir: string, o: ExecuteOpts): Promise<void> {
  m.continuityScores = undefined;
  m.advisories = undefined;
  const embedFrame = o.embedFrame ?? (!o.generate && modelarkReady() ? skylarkFrameEmbedder(dir, o) : null);
  if (!embedFrame || okScenes.length < 2) return;
  try {
    const pairs = continuityPairs(okScenes);
    const byId = new Map(okScenes.map((s) => [s.id, s]));
    // Each (scene, frame) is embedded once (memoised). Pairs are scored concurrently, but the
    // default embedder runs at most FRAME_EXTRACT_CONCURRENCY ffmpeg extractions at a time and its
    // Skylark calls queue on the engine's embed limiter — so the fan-out is bounded at both steps.
    const memo = new Map<string, Promise<number[] | null>>();
    const vec = (id: number, at: FramePos): Promise<number[] | null> => {
      const key = `${id}:${at}`;
      if (!memo.has(key)) {
        const s = byId.get(id)!;
        memo.set(key, embedFrame(path.join(o.repoDir, s.file!), at, s.durationS).catch(() => null));
      }
      return memo.get(key)!;
    };
    const scored = await Promise.all(
      pairs.map(async (p) => {
        const [a, b] = await Promise.all([vec(p.sceneId, p.at), vec(p.refSceneId, p.refAt)]);
        if (!a || !b) return null;
        return { kind: p.kind, sceneId: p.sceneId, refSceneId: p.refSceneId, cosine: Math.round(cosine(a, b) * 1000) / 1000 };
      }),
    );
    const scores = scored.filter((s): s is ContinuityScore => !!s);
    if (!scores.length) return;
    m.continuityScores = scores;
    const advisories = continuityAdvisories(scores);
    if (advisories.length) {
      m.advisories = advisories;
      console.warn(`[story ${m.id}] continuity advisories: ${advisories.join(' | ')}`);
    }
  } catch {
    /* advisory only — never fail a story over the review */
  }
}

/** Merge fresh results over prior ones by scene id. PURE. */
export function mergeScenes(prior: SceneResult[], fresh: SceneResult[]): SceneResult[] {
  const byId = new Map(prior.map((s) => [s.id, s]));
  for (const f of fresh) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Create a fresh manifest for a newly planned story. */
export async function planAndInitStory(
  story: string,
  o: {
    repoDir: string;
    aspect?: string;
    audio?: boolean;
    dialogue?: string;
    transition?: 'cut' | 'dissolve' | 'fade-black';
    music?: string;
    captions?: boolean;
    openingFrame?: string;
    styleAnchor?: string;
    resolution?: '1080p' | '4k';
  } & PlanStoryOpts,
): Promise<StoryManifest> {
  const plan = await planStory(story, o);
  // Re-price now that the story-level anchors are known: a style anchor moves plain t2v scenes
  // onto 2.0-fast (and an opening frame keeps it off scene 1) — the planner priced them on 1.5.
  const resolves = (p?: string): boolean => !!p && fs.existsSync(path.resolve(o.repoDir, p));
  Object.assign(plan, estimateStory(plan.scenes, { styleAnchor: resolves(o.styleAnchor), openingFrame: resolves(o.openingFrame) }));
  const voWords = wordCount(o.dialogue ?? '');
  const totalS = plan.scenes.reduce((n, s) => n + s.durationS, 0);
  if (voWords > NARRATION_MAX_WORDS_PER_S * totalS) {
    plan.notes.push(
      `the voiceover (~${voWords} words) is long for a ~${totalS}s story — it may sound rushed or be clipped; ~${Math.floor(2.5 * totalS)} words fits comfortably`,
    );
  }
  const packed = overPackedScenes(splitNarration(o.dialogue, plan.scenes.map((s) => s.durationS)), plan.scenes);
  if (packed.length) {
    const list = packed.map((p) => `scene ${p.id} (~${p.words} words in ${p.durationS}s; ~${Math.floor(2.5 * p.durationS)} fits)`).join(', ');
    plan.notes.push(
      `the voiceover is over-packed in ${list} — whole sentences can't be split across a cut, so that part may sound rushed or be clipped; use shorter sentences or lengthen ${packed.length > 1 ? 'those scenes' : 'that scene'}`,
    );
  }
  const id = String(Date.now());
  const m: StoryManifest = {
    id,
    createdAt: Date.now(),
    story,
    aspect: plan.aspect,
    audio: o.audio !== false,
    dialogue: o.dialogue,
    transition: o.transition ?? 'cut',
    plan,
    pass: 'draft',
    scenes: [],
    totalTokens: 0,
    costUsd: 0,
    music: o.music,
    captions: o.captions,
    openingFrame: o.openingFrame,
    styleAnchor: o.styleAnchor,
    resolution: o.resolution,
  };
  saveManifest(o.repoDir, m);
  return m;
}
