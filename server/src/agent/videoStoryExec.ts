import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { generateTextM3, fileToDataUrl } from '../engines/minimax';
import {
  createVideoTask,
  pollVideoTask,
  downloadVideo,
  isContentPolicyError,
  type VideoSpec,
} from '../engines/seedance';
import { compileVideoPrompt } from './videoBrief';
import { rasterizeFrame } from './productShot';
import { stitchClips, extractLastFrame, probeDuration } from './videoStitch';
import { mintVideoToken } from '../routes/videoSrc';
import { planStory, type ScenePlan, type StoryPlan, type PlanStoryOpts } from './videoStory';

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
}

export interface StoryManifest {
  id: string;
  createdAt: number;
  story: string;
  aspect: string;
  audio: boolean;
  dialogue?: string;
  transition: 'cut' | 'dissolve';
  plan: StoryPlan;
  pass: 'draft' | 'final';
  scenes: SceneResult[];
  stitched?: string; // repo-relative stitched output
  totalTokens: number;
  costUsd: number;
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

/** The full per-scene prompt: scene prompt + the shared style line + diegetic audio. PURE. */
export function buildScenePrompt(scene: ScenePlan, styleLine: string, extra?: string): string {
  const parts = [scene.prompt.trim(), styleLine.trim(), `Audio: ${scene.audioDirection}.`];
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
    if (config.minimaxApiKey) {
      const r = await generateTextM3(
        `Rewrite this video prompt so it cannot be mistaken for copyrighted or branded footage — keep the exact same action, subject and mood, change phrasing and any brand-adjacent detail to generic equivalents. Output only the rewritten prompt.\n\n${prompt.slice(0, 1500)}`,
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
}

/** Generate ONE scene (with the copyright ladder). Returns the clip path + bookkeeping. */
async function runScene(
  scene: ScenePlan,
  plan: StoryPlan,
  m: StoryManifest,
  prevClipAbs: string | null,
  o: ExecuteOpts,
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
    const spec: VideoSpec = {
      prompt,
      aspect: m.aspect,
      duration: scene.durationS,
      audio: m.audio,
      model: mech === 'extend' || useRefs ? 'arksai-video-20-fast' : 'arksai-video-15',
      draft: !o.final,
      resolution: o.final ? '1080p' : '480p',
    };
    if (useRefs) {
      spec.referenceUrls = (scene.castRefs ?? []).map((p) => fileToDataUrl(path.resolve(o.repoDir, p)));
    }
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

  const generateOnce = async (mech: ScenePlan['mechanism'], prompt: string): Promise<{ file: string; tokens?: number }> => {
    const spec = await buildSpec(mech, prompt);
    if (o.generate) return o.generate(spec, scene.id);
    const { id } = await createVideoTask(spec, o.signal);
    const done = await pollVideoTask(id, o.signal);
    if (!done.ok) throw new Error(done.error);
    const file = path.join(dir, `scene-${scene.id}${o.final ? '-final' : ''}.mp4`);
    await downloadVideo(done.videoUrl, file, o.signal);
    return { file, tokens: done.tokens };
  };

  const prompt0 = buildScenePrompt(scene, plan.styleLine, o.onlyScenes?.includes(scene.id) ? o.retakeNote : undefined);
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
  const results: SceneResult[] = [];
  for (const scene of m.plan.scenes) {
    if (o.signal.aborted) break;
    const reuse = o.onlyScenes && !o.onlyScenes.includes(scene.id) ? m.scenes.find((s) => s.id === scene.id && s.status === 'ok') : null;
    let res: SceneResult;
    if (reuse?.file && fs.existsSync(path.join(o.repoDir, reuse.file))) {
      res = reuse;
    } else {
      res = await runScene(scene, m.plan, m, prevClipAbs, o);
      if (res.tokens) {
        const usd = (res.tokens / 1000) * config.seedanceCostPerKTok;
        m.costUsd += usd;
        m.totalTokens += res.tokens;
        o.addCost(usd);
      }
    }
    results.push(res);
    if (res.status === 'ok' && res.file) prevClipAbs = path.join(o.repoDir, res.file);
    m.scenes = mergeScenes(m.scenes, results);
    saveManifest(o.repoDir, m);
  }
  m.scenes = mergeScenes(m.scenes, results);
  // Stitch whatever succeeded, in scene order.
  const okFiles = m.plan.scenes
    .map((s) => m.scenes.find((r) => r.id === s.id))
    .filter((r): r is SceneResult => !!r && r.status === 'ok' && !!r.file)
    .map((r) => path.join(o.repoDir, r.file!));
  if (okFiles.length) {
    const out = path.join(dir, o.final ? 'story-final.mp4' : 'story-draft.mp4');
    await stitchClips(okFiles, out, { transition: m.transition, signal: o.signal });
    m.stitched = path.relative(o.repoDir, out);
  }
  m.pass = o.final ? 'final' : 'draft';
  saveManifest(o.repoDir, m);
  return m;
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
  o: { repoDir: string; aspect?: string; audio?: boolean; dialogue?: string; transition?: 'cut' | 'dissolve' } & PlanStoryOpts,
): Promise<StoryManifest> {
  const plan = await planStory(story, o);
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
  };
  saveManifest(o.repoDir, m);
  return m;
}
