import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { type ToolDef } from './common';
import { config } from '../../config';
import { synthesizeSpeechBuffer, ttsAvailable, analyzeImage, fileToDataUrl, generateImage } from '../../engines/minimax';
import { createVideoTask, pollVideoTask, downloadVideo, seedanceOn, type VideoSpec } from '../../engines/seedance';
import { generateMusic } from '../../engines/suno';
import { stitchClips, stitchClipsSegmented, mixMusicBed, applyFadeOut, probeDuration, ffmpegAvailable } from '../videoStitch';
import { captureOverlay } from '../motion/capture';
import { compositeOverlayScene, pickFps, DIMENSION_PRESETS } from '../motion/encode';
import { hookProblems, scriptProblems } from '../motion/qc';
import { MOTION_VOICES, withRenderSlot, slugifyTitle, ensureMotionKit } from './motionVideo';
import {
  AX_STYLES,
  AX_STYLE_IDS,
  AX_LAYOUTS,
  buildOverlayHtml,
  clipPrompt,
  normalizeOverlay,
  overlayText,
  type AxOverlay,
} from '../motion/overlay';

/**
 * render_animated_explainer — the "animated explainer" LOOK: a narrated video whose scenes are
 * TWO independent layers. Layer 1 is a text-free, non-photoreal GENERATIVE illustrated clip
 * (Seedance, style-locked across scenes). Layer 2 is our pixel-crisp HTML/CSS TEXT, rendered
 * SEPARATELY and composited on top — text is NEVER baked into the generated pixels (which is
 * exactly why generative explainers elsewhere ban on-screen text). One narrator (TTS) carries
 * it; our script/ending gates, music bed and ending fade are reused from the motion engine.
 *
 * Complements render_motion_video (graphic/kinetic-typography) — reach for THIS when the brief
 * wants the illustrated/animated-film aesthetic. Generative clips cost real money + minutes each.
 */

const TRANSITION_KINDS: Record<string, string> = {
  dip: 'fadeblack',
  'dip-white': 'fadewhite',
  dissolve: 'fade',
  wipe: 'smoothleft',
  slide: 'slideleft',
  circle: 'circleopen',
};

interface AxScene {
  id: number;
  title: string;
  narration: string;
  visual: string;
  overlay: AxOverlay;
  transition?: string;
  clipFile?: string; // downloaded generative clip (repo-rel)
  overlayHtml?: string; // rendered overlay page (repo-rel)
  audioFile?: string;
  narrationHash?: string;
  visualHash?: string;
  durationMs?: number;
  minMs?: number;
  extraTailMs?: number;
  status: 'pending' | 'ok' | 'failed';
  error?: string;
  qcDefects?: string[];
  clip?: string; // FINAL composited scene mp4 (repo-rel)
}

interface AxManifest {
  id: string;
  slug: string;
  style: string; // illustrated look id
  aspect: string;
  width: number;
  height: number;
  fps: number;
  voiceId: string;
  speed: number;
  ink?: string;
  accent?: string;
  scrim?: string;
  styleKey?: string; // repo-rel style-key image locked onto every clip
  clipModel: string;
  music?: string;
  musicFile?: string;
  targetSeconds?: number;
  holdLeadMs: number;
  holdTailMs: number;
  scenes: AxScene[];
  stitched?: string;
  totalMs?: number;
}

const dirName = (id: string) => `videos/animated-${id}`;
const manifestPath = (repoDir: string, id: string) => path.join(repoDir, dirName(id), 'manifest.json');
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean).length;
const WPS = 2.4;
const HEX = (s: any) => (/^#[0-9a-fA-F]{6}$/.test(String(s ?? '')) ? String(s) : undefined);

function saveManifest(repoDir: string, m: AxManifest): void {
  const p = manifestPath(repoDir, m.id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
}
function loadManifest(repoDir: string, id: string): AxManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(repoDir, id), 'utf8'));
  } catch {
    return null;
  }
}
function latestId(repoDir: string): string | null {
  try {
    const ids = fs
      .readdirSync(path.join(repoDir, 'videos'))
      .filter((d) => d.startsWith('animated-'))
      .map((d) => d.slice('animated-'.length))
      .sort();
    return ids[ids.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** Clip duration for a scene: aim the generative clip at ~the narration length, clamped to
 *  Seedance's 4–15s range (the composite clone-pads a short clip and cuts to the exact scene). */
function clipSeconds(narration: string): number {
  const s = wordsOf(narration) / WPS + 1.2;
  return Math.min(15, Math.max(4, Math.round(s))); // 4–15s = Seedance 2.0's verified range
}

async function ttsScene(m: AxManifest, s: AxScene, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  const hash = sha(`${m.voiceId}|${m.speed}|${s.narration}`);
  const audioRel = `${dirName(m.id)}/scene-${s.id}.mp3`;
  const audioAbs = path.join(repoDir, audioRel);
  if (s.audioFile === audioRel && s.narrationHash === hash && fs.existsSync(audioAbs)) return;
  const r = await synthesizeSpeechBuffer(s.narration, { voiceId: m.voiceId, speed: m.speed }, signal);
  if (!r.ok || !r.buffer) throw new Error(`narration synthesis failed for scene ${s.id}: ${r.error}`);
  fs.writeFileSync(audioAbs, r.buffer);
  addCost(config.minimaxTtsCost);
  s.audioFile = audioRel;
  s.narrationHash = hash;
}

/** Generate + download the text-free illustrated clip for a scene (cached by visual+style hash). */
async function generateClip(m: AxManifest, s: AxScene, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  const styleTokens = AX_STYLES[m.style]?.tokens ?? AX_STYLES['flat-vector'].tokens;
  const prompt = clipPrompt(s.visual, styleTokens, s.overlay.layout);
  const hash = sha(`${m.clipModel}|${m.styleKey ?? ''}|${m.aspect}|${prompt}`);
  const clipRel = `${dirName(m.id)}/clip-${s.id}.mp4`;
  const clipAbs = path.join(repoDir, clipRel);
  if (s.clipFile === clipRel && s.visualHash === hash && fs.existsSync(clipAbs)) return; // cached
  const spec: VideoSpec = {
    prompt,
    model: m.clipModel,
    aspect: m.aspect,
    duration: clipSeconds(s.narration),
    resolution: '1080p',
    audio: false, // one narrator carries it — the clip is silent illustration
  };
  // Style lock: the style-key image is attached to EVERY clip as a style reference so all
  // scenes share one art direction (the Higgsfield "style key" move, on our engine).
  if (m.styleKey) {
    const keyAbs = path.resolve(repoDir, m.styleKey);
    if (fs.existsSync(keyAbs)) spec.referenceUrls = [fileToDataUrl(keyAbs)];
  }
  const { id, built } = await createVideoTask(spec, signal);
  const done = await pollVideoTask(id, signal);
  if (!done.ok) throw new Error(`clip generation failed for scene ${s.id}: ${done.error}`);
  await downloadVideo(done.videoUrl, clipAbs, signal);
  if (done.tokens) addCost((done.tokens / 1000) * config.seedanceCostPerKTok);
  else addCost(config.seedanceFinalCostPerSec * built.duration);
  s.clipFile = clipRel;
  s.visualHash = hash;
}

async function renderScene(m: AxManifest, s: AxScene, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  s.error = undefined;
  s.qcDefects = undefined;

  // 1 · narration (defines the scene length) + 2 · the illustrated clip — independent, run together.
  await Promise.all([
    s.narration.trim() ? ttsScene(m, s, repoDir, signal, addCost) : Promise.resolve(),
    generateClip(m, s, repoDir, signal, addCost),
  ]);
  if (s.narration.trim()) {
    const audioS = await probeDuration(path.join(repoDir, s.audioFile!), repoDir, signal);
    if (!audioS) throw new Error(`scene ${s.id}: could not measure the narration audio`);
    s.durationMs = Math.max(Math.round(audioS * 1000) + m.holdLeadMs + m.holdTailMs + (s.extraTailMs ?? 0), s.minMs ?? 0);
  } else {
    s.durationMs = Math.max(s.minMs ?? 0, 2500) + (s.extraTailMs ?? 0);
  }

  // FREEZE advisory: the generated clip maxes at 15s (Seedance 2.0), but a long narration can
  // make the scene longer — the composite clone-pads the clip's last frame, so the illustration
  // FREEZES for the overrun. Surface it (advisory, not fatal — a short freeze under the ending
  // music tail is acceptable; a long one should be split).
  {
    const clipS = clipSeconds(s.narration);
    const overS = s.durationMs / 1000 - clipS;
    if (overS > 0.8) {
      s.qcDefects = [
        ...(s.qcDefects ?? []),
        `scene runs ${(s.durationMs / 1000).toFixed(1)}s but the illustrated clip maxes at ${clipS}s — the last ~${overS.toFixed(1)}s FREEZE on the final frame; split this beat into two shorter scenes so every scene keeps moving`,
      ];
    }
  }

  // 3 · render the crisp OVERLAY layer (transparent) for the exact scene duration.
  const overlayRel = `${dirName(m.id)}/overlay-${s.id}.html`;
  fs.writeFileSync(
    path.join(repoDir, overlayRel),
    buildOverlayHtml(s.overlay, { ink: m.ink, accent: m.accent, scrim: m.scrim, width: m.width, height: m.height, kitPrefix: '../../' }),
  );
  s.overlayHtml = overlayRel;
  const framesDir = path.join(repoDir, dirName(m.id), `ov-${s.id}`);
  fs.rmSync(framesDir, { recursive: true, force: true });
  try {
    await captureOverlay(
      path.resolve(repoDir, overlayRel),
      { width: m.width, height: m.height, fps: m.fps, durationMs: s.durationMs, framesDir },
      signal,
    );
    // 4 · composite the two layers into one uniform scene mp4.
    const clipRel = `${dirName(m.id)}/scene-${s.id}.mp4`;
    await compositeOverlayScene(
      path.resolve(repoDir, s.clipFile!),
      framesDir,
      m.fps,
      path.join(repoDir, clipRel),
      { audioIn: s.audioFile ? path.join(repoDir, s.audioFile) : undefined, durationS: s.durationMs / 1000, width: m.width, height: m.height },
      repoDir,
      signal,
    );
    s.clip = clipRel;
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
  await qcScene(m, s, repoDir, signal);
  s.status = 'ok';
}

/** Vision QC on the COMPOSITED result: does layer 1 stay text-free + on-style, is layer 2 legible? */
async function qcScene(m: AxManifest, s: AxScene, repoDir: string, signal: AbortSignal): Promise<void> {
  if (!config.minimaxApiKey || !s.clip) return;
  const defects: string[] = [];
  for (const frac of [0.5, 0.85]) {
    const spot = path.join(repoDir, dirName(m.id), `.qc-${s.id}-${Math.round(frac * 100)}.jpg`);
    try {
      const at = ((s.durationMs! / 1000) * frac).toFixed(2);
      const { execBash } = await import('../../lib/exec');
      const r = await execBash(`ffmpeg -v error -ss ${at} -i ${JSON.stringify(path.join(repoDir, s.clip))} -frames:v 1 -y ${JSON.stringify(spot)}`, { cwd: repoDir, timeoutMs: 60_000, signal });
      if (!r.ok || !fs.existsSync(spot)) continue;
      const v = await analyzeImage(
        fileToDataUrl(spot),
        `A frame from scene ${s.id} of an ANIMATED-ILLUSTRATED explainer (style: ${AX_STYLES[m.style]?.label ?? m.style}). It is TWO layers: a generated illustrated background, and a crisp text overlay on top (narration: "${s.narration.slice(0, 120)}"). ` +
          'Answer "OK" if clean, else list concrete problems (max 3, one per line): ' +
          '(a) the ILLUSTRATION shows baked-in TEXT/letters/captions/watermark/UI (it must be wordless — all text is the overlay); ' +
          '(b) the illustration looks PHOTOREALISTIC / like real footage (it must be illustrated/animated for this style); ' +
          '(c) the overlay TEXT is unreadable, clipped, overflowing, or low-contrast against the illustration; ' +
          '(d) the overlay copy contradicts the narration.',
        signal,
      );
      if (v.ok && v.text && !/^\s*ok\b/i.test(v.text)) {
        defects.push(...v.text.split('\n').map((l) => l.trim()).filter((l) => l && !/^ok\b/i.test(l)).slice(0, 3));
      }
    } catch {
      /* best-effort */
    } finally {
      fs.rmSync(spot, { force: true });
    }
  }
  if (defects.length) s.qcDefects = [...new Set(defects)].slice(0, 4);
}

/** Make the ONE style-key image that locks the look across every clip (best-effort). */
async function ensureStyleKey(m: AxManifest, subject: string, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  if (m.styleKey && fs.existsSync(path.resolve(repoDir, m.styleKey))) return;
  const tokens = AX_STYLES[m.style]?.tokens ?? AX_STYLES['flat-vector'].tokens;
  const prompt = `${tokens}. A representative establishing scene for: ${subject}. Wordless, ${'no text no letters no watermark'}. NEGATIVE: text, letters, photorealism, 3D render, live-action.`;
  try {
    const r = await generateImage(prompt, { aspectRatio: m.aspect }, repoDir, signal);
    if (r.ok && r.files[0]) {
      m.styleKey = r.files[0].path;
      addCost(config.minimaxImageCost);
    }
  } catch {
    /* no style key → clips still carry the style tokens in-prompt, just less tightly locked */
  }
}

async function assemble(m: AxManifest, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  const okScenes = m.scenes.filter((s) => s.status === 'ok' && s.clip);
  const clips = okScenes.map((s) => path.join(repoDir, s.clip!));
  if (!clips.length) throw new Error('no scene rendered successfully — nothing to assemble');
  // ANY failed scene leaves a hole (a missing MIDDLE scene breaks continuity + an authored
  // act-transition spans the wrong seam) — assemble a -draft of the survivors, never a
  // misleadingly-named -final. describe() then tells the agent to retake the failed scene(s).
  const incomplete = m.scenes.some((s) => s.status !== 'ok' || !s.clip);
  if (incomplete) {
    const draftRel = `${dirName(m.id)}/${m.slug}-draft.mp4`;
    await stitchClips(clips, path.join(repoDir, draftRel), { transition: 'cut', signal });
    m.totalMs = okScenes.reduce((a, s) => a + (s.durationMs ?? 0), 0);
    m.stitched = draftRel;
    return;
  }
  const outRel = `${dirName(m.id)}/${m.slug}.mp4`;
  const outAbs = path.join(repoDir, outRel);
  const boundaries = okScenes.slice(0, -1).map((s) => TRANSITION_KINDS[s.transition ?? ''] ?? null);
  if (boundaries.some(Boolean)) await stitchClipsSegmented(clips, outAbs, boundaries, { fadeS: 0.5, signal });
  else await stitchClips(clips, outAbs, { transition: 'cut', signal });
  m.totalMs = okScenes.reduce((a, s) => a + (s.durationMs ?? 0), 0);

  if (m.music) {
    if (!m.musicFile || !fs.existsSync(path.join(repoDir, m.musicFile))) {
      const r = await generateMusic({ prompt: `Instrumental only. ${m.music}`, instrumental: true, title: 'explainer score' }, repoDir, signal);
      if (r.ok && r.files[0]) {
        m.musicFile = r.files[0].path;
        addCost(config.sunoCostPerTrack);
      }
    }
    if (m.musicFile) {
      const scored = path.join(repoDir, `${dirName(m.id)}/${m.slug}-scored.mp4`);
      if (await mixMusicBed(outAbs, path.join(repoDir, m.musicFile), scored, { duck: true, signal })) {
        m.stitched = (await fade(scored, repoDir, m, signal, 1.8)) ?? `${dirName(m.id)}/${m.slug}-scored.mp4`;
        return;
      }
    }
  }
  m.stitched = (await fade(outAbs, repoDir, m, signal)) ?? outRel;
}

async function fade(videoAbs: string, repoDir: string, m: AxManifest, signal: AbortSignal, fadeS = 0.9): Promise<string | null> {
  const rel = `${dirName(m.id)}/${m.slug}-final.mp4`;
  const ok = await applyFadeOut(videoAbs, path.join(repoDir, rel), fadeS, signal);
  return ok ? rel : null;
}

function describe(m: AxManifest): string {
  const rows = m.scenes
    .map((s) => {
      const dur = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '—';
      const flag = s.status !== 'ok' ? ` ✗ ${s.error ?? 'failed'}` : s.qcDefects?.length ? ` ⚠ ${s.qcDefects.join(' / ')}` : ' ✓';
      return `  ${s.id}. ${s.title} — ${dur}${flag}`;
    })
    .join('\n');
  const total = m.totalMs ? `${(m.totalMs / 1000).toFixed(1)}s` : '?';
  const issues = m.scenes.filter((s) => s.status !== 'ok' || s.qcDefects?.length);
  const last = m.scenes[m.scenes.length - 1];
  let next: string;
  if (last && last.status !== 'ok') {
    next =
      `\n⚠ INCOMPLETE — the CLOSING scene (${last.id}) FAILED, so this cut has NO ENDING (assembled as a -draft). ` +
      `Fix it (${last.error ?? 'see above'}) then call render_animated_explainer with {"explainer_id":"${m.id}","retake_scene":${last.id}}.`;
  } else if (issues.length) {
    next = `\nFIX THEN RETAKE: adjust the named scene's overlay/visual and call render_animated_explainer with {"explainer_id":"${m.id}","retake_scene":<n>, scenes:[…just that scene…]} — only that scene regenerates (cached narration/clip reused when unchanged).`;
  } else {
    next = `\nShow the video to the user. Revisions: retake one scene by number, never re-render the whole video.`;
  }
  return (
    `Animated explainer ${m.stitched ? 'assembled' : 'partially rendered'} (id ${m.id}, look ${AX_STYLES[m.style]?.label ?? m.style}, ${m.width}x${m.height}@${m.fps}fps, total ${total}${m.musicFile ? ', scored' : ''}):\n` +
    `${rows}\n\nFinal file: ${m.stitched ?? '(not assembled)'}\n${next}`
  );
}

function buildScenes(list: any[], m: AxManifest): AxScene[] {
  return list.map((s: any, i: number) => ({
    id: i + 1,
    title: String(s.title ?? `Scene ${i + 1}`).slice(0, 80),
    narration: String(s.narration ?? ''),
    visual: String(s.visual ?? '').slice(0, 600),
    overlay: normalizeOverlay(s.overlay),
    transition: TRANSITION_KINDS[String(s?.transition ?? '')] ? String(s.transition) : undefined,
    minMs: s.min_ms ? Math.min(30_000, Math.max(0, Number(s.min_ms))) : undefined,
    extraTailMs: i === list.length - 1 ? (m.music ? 2600 : 800) : undefined,
    status: 'pending',
  }));
}

export const renderAnimatedExplainerTool: ToolDef = {
  name: 'render_animated_explainer',
  description:
    'Render an ANIMATED-ILLUSTRATED explainer video (mp4) in the "generative-look" aesthetic — flowing, ' +
    'AI-animated illustrated scenes with a locked art style, ONE narrator, and crisp on-brand text. It is ' +
    'built as TWO INDEPENDENT LAYERS: (layer 1) a text-free non-photoreal generative CLIP per scene, and ' +
    '(layer 2) our pixel-crisp text composited on top — text is NEVER generated into the video, so it is ' +
    'always sharp, legible and on-brand (unlike baked-in AI text). Pick an illustrated LOOK (style): ' +
    `${AX_STYLE_IDS.join(', ')}. Each scene = {title, narration, visual, overlay}. "visual" describes the ` +
    'WORDLESS illustrated scene (the tool bans on-screen text + realism and reserves negative space for the ' +
    'overlay). "overlay" is the crisp text layer: {layout: lower|center|stat|caption|none, kicker?, title?, ' +
    'sub?, num?, unit?, label?, caption?} — lower = lower-third title, center = centered hook, stat = a ' +
    'number+label card, caption = a subtitle line, none = no text this scene. The tool locks ONE style-key ' +
    'image onto every clip so all scenes share the look, synthesizes narration (script + hook + ending gates ' +
    'apply, ~2.4 words/s — set target_seconds), renders the overlay, composites the two layers, and assembles ' +
    'with an optional ducked music bed + ending fade. NOTE: generative clips cost real money and take minutes ' +
    'each — a 6-scene video is ~6 clip generations. Use render_motion_video instead for graphic / ' +
    'kinetic-typography / data-heavy explainers (crisp, instant, free). Retake ONE scene via {explainer_id, ' +
    'retake_scene, scenes:[…that scene…]}.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The subject in a few words — names the output file (<slug>-final.mp4).' },
      scenes: {
        type: 'array',
        description: 'Ordered scenes. Each: {title, narration, visual, overlay:{layout,…}, transition?, min_ms?}.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            narration: { type: 'string', description: 'EXACT words spoken over this scene (empty = silent beat).' },
            visual: { type: 'string', description: 'The WORDLESS illustrated scene to generate (no text — that is the overlay).' },
            overlay: {
              type: 'object',
              description: `The crisp text layer. layout one of: ${AX_LAYOUTS.join(', ')}. Slots: kicker, title, sub (lower/center); num, unit, label (stat); caption (caption).`,
              properties: {
                layout: { type: 'string', enum: [...AX_LAYOUTS] },
                kicker: { type: 'string' },
                title: { type: 'string' },
                sub: { type: 'string' },
                num: { type: 'string' },
                unit: { type: 'string' },
                label: { type: 'string' },
                caption: { type: 'string' },
              },
              required: ['layout'],
            },
            transition: { type: 'string', enum: ['cut', 'dip', 'dip-white', 'dissolve', 'wipe', 'slide', 'circle'], description: 'Transition INTO the next scene (default cut; designed transitions for act breaks only).' },
            min_ms: { type: 'number' },
          },
          required: ['title', 'narration', 'visual', 'overlay'],
        },
      },
      style: { type: 'string', enum: [...AX_STYLE_IDS], description: `The illustrated look locked across all scenes: ${AX_STYLE_IDS.map((id) => `${id} (${AX_STYLES[id].label})`).join(', ')}.` },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: 'Output dimension (default 16:9).' },
      target_seconds: { type: 'number', description: 'Intended total length — validates the narration word budget before any paid generation.' },
      voice_id: { type: 'string', description: `Narrator voice. One of: ${MOTION_VOICES.map((v) => `"${v.id}"`).join(', ')}.` },
      speed: { type: 'number', description: 'Narration speed 0.8–1.2 (default 1).' },
      ink: { type: 'string', description: 'Overlay TEXT colour hex (default near-white — overlay sits on a dark scrim over the illustration).' },
      accent: { type: 'string', description: 'Overlay accent hex (kicker/stat unit).' },
      scrim: { type: 'string', description: 'Overlay scrim/veil colour hex (default near-black).' },
      music: { type: 'string', description: 'Optional instrumental music-bed brief (auto-ducked under the voice).' },
      explainer_id: { type: 'string', description: 'An existing explainer id (for retakes; default = latest).' },
      retake_scene: { type: 'number', description: 'Re-render ONLY this scene id, then reassemble. Pass the updated scene in scenes:[…] to change its content.' },
    },
    required: [],
  },
  modes: ['chat', 'code'],
  available: () => ttsAvailable() && seedanceOn(),
  summarize: (a) => (a.retake_scene ? `retake scene ${a.retake_scene}` : `animate ${Array.isArray(a.scenes) ? a.scenes.length : '?'} scenes`),
  async run(args, ctx) {
    if (!seedanceOn()) return 'Error: the generative video engine is not configured (needs the ArksAI Video key) — animated explainers are unavailable. Use render_motion_video for a crisp graphic explainer instead.';
    if (!(await ffmpegAvailable())) return 'Error: ffmpeg is not installed — animated explainers unavailable.';
    ensureMotionKit(ctx.repoDir);

    const retake = args.retake_scene != null ? Number(args.retake_scene) : null;
    let m: AxManifest | null = null;
    let scriptNotes: string[] = [];

    if (retake != null || args.explainer_id) {
      const id = String(args.explainer_id ?? latestId(ctx.repoDir) ?? '');
      m = id ? loadManifest(ctx.repoDir, id) : null;
      if (!m) return `Error: no animated explainer manifest found${args.explainer_id ? ` for id ${args.explainer_id}` : ''} — start with scenes:[…].`;
      // Retake with updated content: replace that scene from scenes:[…] if provided.
      if (retake != null && Array.isArray(args.scenes) && args.scenes.length) {
        const src = args.scenes.find((x: any, i: number) => (x?.id ? Number(x.id) === retake : i === 0)) ?? args.scenes[0];
        const idx = m.scenes.findIndex((s) => s.id === retake);
        if (idx >= 0 && src) {
          // The on-screen-text guard applies to retakes too — text belongs in the overlay, never
          // the paid clip (the whole point of the two-layer design).
          if (/\b(text|caption|title|words?|letters|writes?|says|label reading|sign reading)\b/i.test(String(src?.visual ?? '')))
            return `Error: the retaken scene's "visual" asks for TEXT — the illustration is always wordless; put every word in the "overlay" instead (layout + kicker/title/sub/caption).`;
          const old = m.scenes[idx];
          const rebuilt = buildScenes([src], m)[0];
          // PRESERVE the cache fields so the per-field hash guards regenerate ONLY what actually
          // changed: fixing the overlay text (same visual) reuses the paid Seedance clip; an
          // unchanged narration reuses the TTS. Without this the most common retake — tightening
          // the overlay copy after a legibility flag — silently re-pays for a full clip + TTS.
          m.scenes[idx] = {
            ...rebuilt,
            id: retake,
            extraTailMs: old.extraTailMs,
            clipFile: old.clipFile,
            visualHash: old.visualHash,
            audioFile: old.audioFile,
            narrationHash: old.narrationHash,
          };
        }
      }
    }

    if (!m) {
      const list = Array.isArray(args.scenes) ? args.scenes : [];
      if (!list.length) return 'Error: pass scenes:[{title, narration, visual, overlay}, …] in order.';
      if (list.length > 30) return 'Error: 30 scenes max per animated explainer (generative clips are expensive).';
      const bad = list
        .map((s: any, i: number) => (!String(s?.visual ?? '').trim() || !s?.overlay?.layout ? i + 1 : 0))
        .filter(Boolean);
      if (bad.length) return `Error: scene(s) ${bad.join(', ')} need both a "visual" (the wordless illustration) and an "overlay" with a layout.`;

      // GATES — before any paid generation.
      const hookIssue = hookProblems(String(list[0]?.narration ?? ''));
      if (hookIssue) return `Error: ${hookIssue}`;
      const script = scriptProblems(list.map((s: any) => String(s?.narration ?? '')));
      const targetSeconds = Number(args.target_seconds) > 0 ? Math.min(3600, Number(args.target_seconds)) : undefined;
      const totalWords = list.reduce((a: number, s: any) => a + wordsOf(String(s?.narration ?? '')), 0);
      const wps = targetSeconds && targetSeconds <= 30 ? 2.0 : WPS;
      const estS = totalWords / wps + list.length * 0.95;
      const overBudget = targetSeconds && estS > targetSeconds * 1.25;
      if (script.hard.length || overBudget) {
        const parts: string[] = [];
        if (script.hard.length) parts.push(`script quality — fix the narration and call again (nothing generated):\n${script.hard.map((p) => `- ${p}`).join('\n')}`);
        if (overBudget) parts.push(`the narration is ~${Math.round(estS)}s against a ${targetSeconds}s target — cut whole MIDDLE beats (the hook and the closing punch-out are untouchable).`);
        return `Error: ${parts.join('\n\nALSO: ')}`;
      }
      scriptNotes = script.advisory;

      // On-screen-text guard: text belongs in the overlay, never in the visual prompt.
      const leaky = list
        .map((s: any, i: number) => (/\b(text|caption|title|words?|letters|writes?|says|label reading|sign reading)\b/i.test(String(s?.visual ?? '')) ? i + 1 : 0))
        .filter(Boolean);
      if (leaky.length)
        return `Error: scene(s) ${leaky.join(', ')} ask for TEXT in the "visual" — the illustration is always wordless; put every word in that scene's "overlay" instead (layout + kicker/title/sub/caption). Rephrase the visual to describe only imagery.`;

      const aspect = ['16:9', '9:16', '1:1'].includes(String(args.aspect_ratio)) ? String(args.aspect_ratio) : '16:9';
      const dim = DIMENSION_PRESETS[aspect] ?? DIMENSION_PRESETS['16:9'];
      const style = AX_STYLE_IDS.includes(String(args.style)) ? String(args.style) : 'flat-vector';
      const id = String(Date.now());
      const estMs = estS * 1000;
      m = {
        id,
        slug: slugifyTitle(String(args.title ?? '')) || slugifyTitle(String(list[0]?.title ?? '')) || 'explainer',
        style,
        aspect,
        width: dim.w,
        height: dim.h,
        fps: pickFps(estMs),
        voiceId: typeof args.voice_id === 'string' && args.voice_id.trim() ? args.voice_id.trim() : 'Wise_Woman',
        speed: Math.min(1.2, Math.max(0.8, Number(args.speed) || 1)),
        ink: HEX(args.ink),
        accent: HEX(args.accent),
        scrim: HEX(args.scrim),
        clipModel: 'arksai-video-20', // 2.0 keeps the style-key reference across scenes
        music: args.music ? String(args.music).slice(0, 300) : undefined,
        targetSeconds,
        holdLeadMs: 350,
        holdTailMs: 600,
        scenes: [],
      };
      m.scenes = buildScenes(list, m);
      saveManifest(ctx.repoDir, m);
    }

    const targets = retake != null ? m.scenes.filter((s) => s.id === retake) : m.scenes.filter((s) => s.status !== 'ok');
    if (retake != null && !targets.length) return `Error: scene ${retake} not found in explainer ${m.id}.`;

    return withRenderSlot(async (queuedMs) => {
      if (ctx.signal.aborted) return 'Error: the run was cancelled while this render was queued.';
      const queuedNote = queuedMs > 5000 ? `(waited ${(queuedMs / 1000).toFixed(0)}s in the render queue)\n` : '';

      // Lock the style key first (once per video) so every clip shares the look.
      await ensureStyleKey(m!, `${args.title ?? m!.scenes[0]?.title ?? 'the topic'}`, ctx.repoDir, ctx.signal, ctx.addCost);
      saveManifest(ctx.repoDir, m!);

      // Modest parallelism (2 at a time): each scene is an independent clip-gen + overlay + composite.
      const queue = [...targets];
      const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
        for (;;) {
          const s = queue.shift();
          if (!s) return;
          try {
            await renderScene(m!, s, ctx.repoDir, ctx.signal, ctx.addCost);
          } catch (e: any) {
            s.status = 'failed';
            s.error = String(e?.message ?? e).slice(0, 240);
          }
          saveManifest(ctx.repoDir, m!);
        }
      });
      await Promise.all(workers);

      try {
        await assemble(m!, ctx.repoDir, ctx.signal, ctx.addCost);
      } catch (e: any) {
        saveManifest(ctx.repoDir, m!);
        return `Error: assembly failed — ${String(e?.message ?? e)}\n${describe(m!)}`;
      }
      saveManifest(ctx.repoDir, m!);
      const scriptNote = scriptNotes.length ? `\n\nSCRIPT NOTES (fix in the narration next pass):\n${scriptNotes.map((p) => `- ${p}`).join('\n')}` : '';
      return queuedNote + describe(m!) + scriptNote;
    });
  },
};
