import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveInWorkspace, type ToolDef } from './common';
import { config, repoRoot } from '../../config';
import { synthesizeSpeechBuffer, ttsAvailable, analyzeImage, fileToDataUrl } from '../../engines/minimax';
import { generateMusic } from '../../engines/suno';
import { stitchClips, mixMusicBed, probeDuration, ffmpegAvailable } from '../videoStitch';
import { captureScene, captureSpotFrame, auditSceneHtml } from '../motion/capture';
import { encodeSceneVideo, pickFps, DIMENSION_PRESETS } from '../motion/encode';

/**
 * render_motion_video — narrated VECTOR motion graphics (SVG/text/web animation) exported
 * as a real mp4. The Remotion architecture on our stack: the agent authors each scene as a
 * motion-kit HTML page, narration is synthesized FIRST (per scene) so timing derives from
 * the real audio, frames are captured deterministically (seek-driven), and ffmpeg encodes +
 * losslessly concatenates. No video model anywhere — pixel-crisp text, any length, per-scene
 * retakes for pennies.
 */

// MiniMax system voices for t2a_v2. 'male-qn-qingse' is the live-proven default; the
// English narration set below follows MiniMax's documented system voice ids.
export const MOTION_VOICES: { id: string; note: string }[] = [
  { id: 'Wise_Woman', note: 'warm, credible female narrator (default for explainers)' },
  { id: 'Deep_Voice_Man', note: 'authoritative male narrator' },
  { id: 'Calm_Woman', note: 'soft, reassuring female' },
  { id: 'Friendly_Person', note: 'upbeat, conversational' },
  { id: 'Inspirational_girl', note: 'energetic, youthful' },
  { id: 'Patient_Man', note: 'measured, instructional male' },
  { id: 'male-qn-qingse', note: 'general default (validated live)' },
];

interface MotionScene {
  id: number;
  title: string;
  narration: string;
  htmlFile: string;
  audioFile?: string;
  narrationHash?: string;
  durationMs?: number;
  minMs?: number;
  status: 'pending' | 'ok' | 'failed';
  error?: string;
  qcDefects?: string[];
  clip?: string; // repo-relative scene mp4
}

interface MotionManifest {
  id: string;
  aspect: string;
  width: number;
  height: number;
  fps: number;
  voiceId: string;
  speed: number;
  music?: string;
  musicFile?: string;
  holdLeadMs: number;
  holdTailMs: number;
  scenes: MotionScene[];
  stitched?: string;
  totalMs?: number;
}

const dirName = (id: string) => `videos/motion-${id}`;
const manifestPath = (repoDir: string, id: string) => path.join(repoDir, dirName(id), 'manifest.json');
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function saveManifest(repoDir: string, m: MotionManifest): void {
  const p = manifestPath(repoDir, m.id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
}
function loadManifest(repoDir: string, id: string): MotionManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(repoDir, id), 'utf8'));
  } catch {
    return null;
  }
}
export function latestMotionId(repoDir: string): string | null {
  try {
    const ids = fs
      .readdirSync(path.join(repoDir, 'videos'))
      .filter((d) => d.startsWith('motion-'))
      .map((d) => d.slice('motion-'.length))
      .sort();
    return ids[ids.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** Ensure the motion-kit runtime exists in the workspace (scenes link it relatively). */
function ensureMotionKit(repoDir: string): void {
  const src = path.join(repoRoot, 'server', 'assets', 'motion-kit');
  const dest = path.join(repoDir, 'motion-kit');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
}

async function ttsScene(m: MotionManifest, s: MotionScene, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  const hash = sha(`${m.voiceId}|${m.speed}|${s.narration}`);
  const audioRel = `${dirName(m.id)}/scene-${s.id}.mp3`;
  const audioAbs = path.join(repoDir, audioRel);
  if (s.audioFile === audioRel && s.narrationHash === hash && fs.existsSync(audioAbs)) return; // cached
  const r = await synthesizeSpeechBuffer(s.narration, { voiceId: m.voiceId, speed: m.speed }, signal);
  if (!r.ok || !r.buffer) throw new Error(`narration synthesis failed for scene ${s.id}: ${r.error}`);
  fs.writeFileSync(audioAbs, r.buffer);
  addCost(config.minimaxTtsCost);
  s.audioFile = audioRel;
  s.narrationHash = hash;
}

async function qcScene(m: MotionManifest, s: MotionScene, repoDir: string, htmlAbs: string, signal: AbortSignal): Promise<void> {
  if (!config.minimaxApiKey) return; // vision QC lights up when keyed; deterministic audits still ran
  const defects: string[] = [];
  for (const frac of [0.32, 0.85]) {
    const spot = path.join(repoDir, dirName(m.id), `.qc-${s.id}-${Math.round(frac * 100)}.jpg`);
    try {
      await captureSpotFrame(htmlAbs, { width: m.width, height: m.height, durationMs: s.durationMs!, atMs: s.durationMs! * frac, outAbs: spot }, signal);
      const v = await analyzeImage(
        fileToDataUrl(spot),
        `Frame from scene ${s.id} of a narrated motion-graphics explainer (narration: "${s.narration.slice(0, 140)}"). ` +
          'Answer "OK" if the frame is clean, or list concrete problems, one per line: unreadable/clipped/overflowing text, ' +
          'elements overlapping illegibly, a blank/empty frame, broken layout, or content that contradicts the narration.',
        signal,
      );
      if (v.ok && v.text && !/^\s*ok\b/i.test(v.text)) {
        defects.push(...v.text.split('\n').map((l) => l.trim()).filter((l) => l && !/^ok\b/i.test(l)).slice(0, 3));
      }
    } catch {
      /* QC is best-effort — a capture/vision hiccup never fails the render */
    } finally {
      fs.rmSync(spot, { force: true });
    }
  }
  if (defects.length) s.qcDefects = [...new Set(defects)].slice(0, 4);
}

async function renderScene(
  m: MotionManifest,
  s: MotionScene,
  repoDir: string,
  signal: AbortSignal,
  addCost: (u: number) => void,
): Promise<void> {
  s.error = undefined;
  s.qcDefects = undefined;
  const htmlAbs = path.resolve(repoDir, s.htmlFile);
  if (!fs.existsSync(htmlAbs)) throw new Error(`scene ${s.id}: ${s.htmlFile} does not exist`);
  const problems = auditSceneHtml(fs.readFileSync(htmlAbs, 'utf8'));
  if (problems.length) throw new Error(`scene ${s.id} (${s.htmlFile}): ${problems.join('; ')}`);

  // Narration first — the audio DEFINES the scene duration.
  if (s.narration.trim()) {
    await ttsScene(m, s, repoDir, signal, addCost);
    const audioS = await probeDuration(path.join(repoDir, s.audioFile!), repoDir, signal);
    if (!audioS) throw new Error(`scene ${s.id}: could not measure the narration audio`);
    s.durationMs = Math.max(Math.round(audioS * 1000) + m.holdLeadMs + m.holdTailMs, s.minMs ?? 0);
  } else {
    s.audioFile = undefined;
    s.durationMs = Math.max(s.minMs ?? 0, 3000);
  }

  const framesDir = path.join(repoDir, dirName(m.id), `frames-${s.id}`);
  fs.rmSync(framesDir, { recursive: true, force: true });
  try {
    await captureScene(htmlAbs, { width: m.width, height: m.height, fps: m.fps, durationMs: s.durationMs, framesDir }, signal);
    const clipRel = `${dirName(m.id)}/scene-${s.id}.mp4`;
    await encodeSceneVideo(
      framesDir,
      m.fps,
      path.join(repoDir, clipRel),
      { audioIn: s.audioFile ? path.join(repoDir, s.audioFile) : undefined, durationS: s.durationMs / 1000 },
      repoDir,
      signal,
    );
    s.clip = clipRel;
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true }); // frames are big — never leave them behind
  }
  await qcScene(m, s, repoDir, htmlAbs, signal);
  s.status = 'ok';
}

async function assemble(m: MotionManifest, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  const clips = m.scenes.filter((s) => s.status === 'ok' && s.clip).map((s) => path.join(repoDir, s.clip!));
  if (!clips.length) throw new Error('no scene rendered successfully — nothing to assemble');
  const outRel = `${dirName(m.id)}/explainer.mp4`;
  const outAbs = path.join(repoDir, outRel);
  await stitchClips(clips, outAbs, { transition: 'cut', signal });
  m.totalMs = m.scenes.filter((s) => s.status === 'ok').reduce((a, s) => a + (s.durationMs ?? 0), 0);

  if (m.music) {
    if (!m.musicFile || !fs.existsSync(path.join(repoDir, m.musicFile))) {
      const r = await generateMusic({ prompt: `Instrumental only. ${m.music}`, instrumental: true, title: 'motion score' }, repoDir, signal);
      if (r.ok && r.files[0]) {
        m.musicFile = r.files[0].path;
        addCost(config.sunoCostPerTrack);
      }
    }
    if (m.musicFile) {
      const scored = path.join(repoDir, `${dirName(m.id)}/explainer-scored.mp4`);
      if (await mixMusicBed(outAbs, path.join(repoDir, m.musicFile), scored, { duck: true, signal })) {
        m.stitched = `${dirName(m.id)}/explainer-scored.mp4`;
        return;
      }
    }
  }
  m.stitched = outRel;
}

function describe(m: MotionManifest): string {
  const rows = m.scenes
    .map((s) => {
      const dur = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '—';
      const flag = s.status !== 'ok' ? ` ✗ ${s.error ?? 'failed'}` : s.qcDefects?.length ? ` ⚠ ${s.qcDefects.join(' / ')}` : ' ✓';
      return `  ${s.id}. ${s.title} — ${dur}${flag}`;
    })
    .join('\n');
  const total = m.totalMs ? `${(m.totalMs / 1000).toFixed(1)}s` : '?';
  const issues = m.scenes.filter((s) => s.status !== 'ok' || s.qcDefects?.length);
  let next = '';
  if (issues.length) {
    next =
      `\nFIX THEN RETAKE: edit the listed scene HTML file(s) to fix the named defect, then call ` +
      `render_motion_video again with {"motion_id":"${m.id}","retake_scene":<n>} — only that scene re-renders (cached narration is reused).`;
  } else {
    next = `\nShow the video to the user. Revisions: edit a scene file and retake it by number — never re-render the whole video for one scene.`;
  }
  return (
    `Motion video ${m.stitched ? 'assembled' : 'partially rendered'} (id ${m.id}, ${m.width}x${m.height}@${m.fps}fps, total ${total}` +
    `${m.musicFile ? ', scored' : ''}):\n${rows}\n\nFinal file: ${m.stitched ?? '(not assembled)'}\n${next}`
  );
}

export const renderMotionVideoTool: ToolDef = {
  name: 'render_motion_video',
  description:
    'Render a NARRATED MOTION-GRAPHICS video (mp4) from scene pages you author — vector icons, ' +
    'text and web animation, NO video model (crisp text, any length, per-scene retakes). ' +
    'THIS TOOL DOES NOT WRITE THE SCENE FILES: you must CREATE every html_file with write_file ' +
    'BEFORE calling it (it fails immediately if any listed file does not exist — never retry ' +
    'without writing the files first). ' +
    'WORKFLOW (autonomous): (1) write the narration script and split it into scenes — one idea ' +
    'per scene, ~2 short sentences each (a 60s video ≈ 6-8 scenes; a 7-min explainer ≈ 25-40); ' +
    '(2) get every icon/logo via search_assets and charts via render_chart — NEVER hand-draw; ' +
    '(3) write each scene as a self-contained HTML file using the motion-kit (this tool installs ' +
    'motion-kit/ + read motion-kit/MOTION.md first; link motion-kit/motion.css + motion.js with ' +
    'RELATIVE paths, entrances in the first 1.5-3s, no wall-clock JS, theme via --mg-* vars — one ' +
    'identity across scenes); (4) call this tool with the scenes IN ORDER. It synthesizes the ' +
    'narration per scene (timing derives from the real audio), captures frames deterministically, ' +
    'encodes, quality-checks frames, and assembles the final mp4 (+ optional ducked music bed). ' +
    'Scenes with QC defects come back named — fix the HTML and retake JUST that scene via ' +
    '{motion_id, retake_scene}. Use generate_video (filmed/photographic shots) ONLY when real ' +
    'footage is explicitly wanted.',
  parameters: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        description: 'The ordered scenes (first call). Each: {title, narration, html_file, min_ms?}.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short scene label (for the report).' },
            narration: { type: 'string', description: 'EXACT words to speak over this scene (empty string = silent hold).' },
            html_file: { type: 'string', description: 'Workspace-relative path of the scene page (motion-kit HTML).' },
            min_ms: { type: 'number', description: 'Optional minimum scene duration in ms.' },
          },
          required: ['title', 'narration', 'html_file'],
        },
      },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:5'], description: 'Output dimension (default 16:9 = 1920x1080).' },
      voice_id: {
        type: 'string',
        description: `Narrator voice. One of: ${MOTION_VOICES.map((v) => `"${v.id}" (${v.note})`).join(', ')}.`,
      },
      speed: { type: 'number', description: 'Narration speed 0.8-1.2 (default 1).' },
      music: { type: 'string', description: 'Optional instrumental music-bed brief (auto-ducked under the voice).' },
      motion_id: { type: 'string', description: 'An existing motion video id (for retakes; default = the latest).' },
      retake_scene: { type: 'number', description: 'Re-render ONLY this scene id (after editing its HTML), then reassemble.' },
    },
    required: [],
  },
  modes: ['chat', 'code'],
  available: () => ttsAvailable(),
  summarize: (a) =>
    a.retake_scene ? `retake scene ${a.retake_scene}` : `render ${Array.isArray(a.scenes) ? a.scenes.length : '?'} scenes`,
  async run(args, ctx) {
    if (!(await ffmpegAvailable())) return 'Error: ffmpeg is not installed in this environment — motion video rendering unavailable.';
    ensureMotionKit(ctx.repoDir);

    let m: MotionManifest | null = null;
    const retake = args.retake_scene != null ? Number(args.retake_scene) : null;

    if (retake != null || args.motion_id) {
      const id = String(args.motion_id ?? latestMotionId(ctx.repoDir) ?? '');
      m = id ? loadManifest(ctx.repoDir, id) : null;
      if (!m) return `Error: no motion video manifest found${args.motion_id ? ` for id ${args.motion_id}` : ''} — start with scenes:[...].`;
    }

    if (!m) {
      const list = Array.isArray(args.scenes) ? args.scenes : [];
      if (!list.length)
        return 'Error: pass scenes:[{title, narration, html_file}, …] in order (author the scene HTML files with the motion-kit first — read motion-kit/MOTION.md).';
      if (list.length > 60) return 'Error: 60 scenes max per video.';
      // FAIL EARLY when the scene files were never written (the #1 misuse, seen live: the
      // model lists file paths it never created, then loops the identical call). No
      // manifest, no TTS — one unambiguous instruction instead of a per-scene table.
      const missing = list
        .map((s: any) => String(s?.html_file ?? ''))
        .filter((f: string) => !f || !fs.existsSync(path.resolve(ctx.repoDir, f)));
      if (missing.length) {
        return (
          `STOP — you have NOT created the scene files yet. This tool does not write them for you.\n` +
          `Missing: ${missing.join(', ')}\n` +
          `Create EACH file now with write_file (a full motion-kit HTML page per scene — read motion-kit/MOTION.md ` +
          `for the skeleton), verify they exist, and only THEN call render_motion_video again. ` +
          `Calling again without writing the files will fail exactly the same way.`
        );
      }
      const aspect = String(args.aspect_ratio ?? '16:9');
      const dim = DIMENSION_PRESETS[aspect] ?? DIMENSION_PRESETS['16:9'];
      const scenes: MotionScene[] = list.map((s: any, i: number) => ({
        id: i + 1,
        title: String(s.title ?? `Scene ${i + 1}`).slice(0, 80),
        narration: String(s.narration ?? ''),
        htmlFile: String(s.html_file ?? ''),
        minMs: s.min_ms ? Math.min(30_000, Math.max(0, Number(s.min_ms))) : undefined,
        status: 'pending',
      }));
      // fps derives from a rough total estimate: ~155 words/min narration + holds.
      const words = scenes.reduce((a, s) => a + s.narration.split(/\s+/).filter(Boolean).length, 0);
      const estMs = (words / 155) * 60_000 + scenes.length * 900;
      m = {
        id: String(Date.now()),
        aspect,
        width: dim.w,
        height: dim.h,
        fps: pickFps(estMs),
        voiceId: typeof args.voice_id === 'string' && args.voice_id.trim() ? args.voice_id.trim() : 'Wise_Woman',
        speed: Math.min(1.2, Math.max(0.8, Number(args.speed) || 1)),
        music: args.music ? String(args.music).slice(0, 300) : undefined,
        holdLeadMs: 350,
        holdTailMs: 600,
        scenes,
      };
      // path safety for every scene file up front
      for (const s of m.scenes) {
        try {
          resolveInWorkspace(ctx.repoDir, s.htmlFile);
        } catch (e: any) {
          return `Error: scene ${s.id} html_file: ${e?.message ?? e}`;
        }
      }
      saveManifest(ctx.repoDir, m);
    }

    const targets = retake != null ? m.scenes.filter((s) => s.id === retake) : m.scenes.filter((s) => s.status !== 'ok');
    if (retake != null && !targets.length) return `Error: scene ${retake} not found in motion ${m.id}.`;

    // Render with modest parallelism (2 Chromium contexts) — scenes are independent.
    const queue = [...targets];
    const failures: string[] = [];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        try {
          await renderScene(m!, s, ctx.repoDir, ctx.signal, ctx.addCost);
        } catch (e: any) {
          s.status = 'failed';
          s.error = String(e?.message ?? e).slice(0, 240);
          failures.push(`scene ${s.id}: ${s.error}`);
        }
        saveManifest(ctx.repoDir, m!);
      }
    });
    await Promise.all(workers);

    try {
      await assemble(m, ctx.repoDir, ctx.signal, ctx.addCost);
    } catch (e: any) {
      saveManifest(ctx.repoDir, m);
      return `Error: assembly failed — ${String(e?.message ?? e)}\n${describe(m)}`;
    }
    saveManifest(ctx.repoDir, m);
    return describe(m);
  },
};
