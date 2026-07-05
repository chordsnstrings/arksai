import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveInWorkspace, type ToolDef } from './common';
import { config, repoRoot } from '../../config';
import { synthesizeSpeechBuffer, ttsAvailable, analyzeImage, fileToDataUrl } from '../../engines/minimax';
import { generateMusic } from '../../engines/suno';
import { stitchClips, stitchClipsSegmented, mixMusicBed, applyFadeOut, probeDuration, ffmpegAvailable } from '../videoStitch';
import { captureScene, captureSpotFrame, auditSceneHtml } from '../motion/capture';
import { encodeSceneVideo, pickFps, DIMENSION_PRESETS, frameName, frameCount } from '../motion/encode';
import { materializeScaffold, workspaceAssetReader, SCAFFOLD_IDS, SCAFFOLD_DOC } from '../motion/scaffolds';
import { auditSceneMotion, auditFrameFill, isPacingMonotone, hookProblems } from '../motion/qc';

/**
 * render_motion_video — narrated VECTOR motion graphics (SVG/text/web animation) exported
 * as a real mp4. The Remotion architecture on our stack: scenes come from SCAFFOLDS
 * (slot-driven archetypes with the choreography baked in) or agent-authored motion-kit
 * pages, narration is synthesized FIRST (per scene) so timing derives from the real audio,
 * frames are captured deterministically (seek-driven), and ffmpeg encodes + concatenates
 * (with designed transitions at act boundaries). No video model anywhere — pixel-crisp
 * text, any length, per-scene retakes for pennies.
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

/** Designed transitions between scenes (the tool maps them to voice-safe xfades). */
const TRANSITION_KINDS: Record<string, string> = {
  dip: 'fadeblack',
  'dip-white': 'fadewhite',
  dissolve: 'fade',
  wipe: 'smoothleft',
  slide: 'slideleft',
  circle: 'circleopen',
};

interface MotionScene {
  id: number;
  title: string;
  narration: string;
  htmlFile: string;
  scaffoldId?: string;
  transition?: string; // designed transition INTO the next scene ('cut' default)
  audioFile?: string;
  narrationHash?: string;
  durationMs?: number;
  minMs?: number;
  extraTailMs?: number; // the FINAL scene breathes before the fade-out
  status: 'pending' | 'ok' | 'failed';
  error?: string;
  qcDefects?: string[];
  clip?: string; // repo-relative scene mp4
}

type MotionStyle = 'clean' | 'nutshell' | 'broadcast' | 'vox' | 'nordic';

interface MotionManifest {
  id: string;
  style: MotionStyle;
  aspect: string;
  width: number;
  height: number;
  fps: number;
  voiceId: string;
  speed: number;
  music?: string;
  musicFile?: string;
  targetSeconds?: number;
  holdLeadMs: number;
  holdTailMs: number;
  scenes: MotionScene[];
  stitched?: string;
  totalMs?: number;
}

/**
 * GLOBAL RENDER SEMAPHORE (ops lesson 2026-07-05): two concurrent motion renders — four
 * Chromium capture contexts plus parallel ffmpeg encodes — thrashed the 4GB droplet into
 * a ~1min outage. ONE render (capture+encode+assemble) runs at a time server-wide; later
 * arrivals queue here in FIFO order instead of overloading the box. Cheap validation
 * (hook gate, word budget, scaffold materialization) stays OUTSIDE the slot.
 */
let renderTail: Promise<void> = Promise.resolve();
export async function withRenderSlot<T>(fn: (queuedMs: number) => Promise<T>): Promise<T> {
  const prev = renderTail;
  let release!: () => void;
  renderTail = new Promise<void>((resolve) => (release = resolve));
  const t0 = Date.now();
  try {
    await prev; // strict FIFO — never times out: renders are bounded and abort releases via finally
    return await fn(Date.now() - t0);
  } finally {
    release();
  }
}

const dirName = (id: string) => `videos/motion-${id}`;
const manifestPath = (repoDir: string, id: string) => path.join(repoDir, dirName(id), 'manifest.json');
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean).length;
const WPS = 2.4; // ~145 wpm — the explainer narration band

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

/** Ensure the motion-kit runtime exists in the workspace (scenes link it relatively).
 *  Files only — the kit dir also holds previews/ (style-picker thumbnails), which the
 *  workspace doesn't need and copyFileSync would choke on. */
function ensureMotionKit(repoDir: string): void {
  const src = path.join(repoRoot, 'server', 'assets', 'motion-kit');
  const dest = path.join(repoDir, 'motion-kit');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const abs = path.join(src, f);
    if (fs.statSync(abs).isFile()) fs.copyFileSync(abs, path.join(dest, f));
  }
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

/** Vision QC spot times: early (does the scene read within ~1s of the cut?), mid, and
 *  late-but-before-the-exit (82% — at 98% the content has exited by design). */
function spotTimes(durationMs: number): number[] {
  return [Math.min(1000, Math.round(durationMs * 0.2)), Math.round(durationMs * 0.45), Math.round(durationMs * 0.82)];
}

async function qcScene(m: MotionManifest, s: MotionScene, repoDir: string, htmlAbs: string, signal: AbortSignal): Promise<void> {
  if (!config.minimaxApiKey) return; // vision QC lights up when keyed; deterministic audits still ran
  const defects: string[] = [];
  const times = spotTimes(s.durationMs!);
  for (let idx = 0; idx < times.length; idx++) {
    const atMs = times[idx];
    const spot = path.join(repoDir, dirName(m.id), `.qc-${s.id}-${idx}.jpg`);
    const position = idx === 0 ? 'EARLY (~1s in — the HEADLINE and primary anchor must have landed; secondary labels/counters arrive later BY DESIGN, so do NOT flag sparseness or a mid-count number here)' : idx === 1 ? 'MID (fully assembled — judge fill and composition on THIS frame)' : 'LATE (still assembled; exits have not started; counters show final values)';
    try {
      await captureSpotFrame(htmlAbs, { width: m.width, height: m.height, durationMs: s.durationMs!, atMs, outAbs: spot }, signal);
      const v = await analyzeImage(
        fileToDataUrl(spot),
        `${position} frame from scene ${s.id} of a narrated motion-graphics explainer in the "${m.style ?? 'clean'}" style (narration: "${s.narration.slice(0, 140)}"). ` +
          'Grade it like a senior motion-design director against the media-house bar. Answer "OK" if clean, or list concrete problems, one per line (max 3): ' +
          'unreadable/clipped/overflowing text or low-contrast kicker; an icon that does NOT depict its adjacent label (name both); ' +
          'a mostly-empty or half-assembled frame; floating icon-on-flat-background with no ground/depth; ' +
          'slide-like typography (uniform text sizes in one centered stack — demand scale contrast and creative placement); ' +
          'more than ~12 words on screen; content contradicting the narration.',
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
    s.durationMs = Math.max(Math.round(audioS * 1000) + m.holdLeadMs + m.holdTailMs + (s.extraTailMs ?? 0), s.minMs ?? 0);
  } else {
    s.audioFile = undefined;
    s.durationMs = Math.max(s.minMs ?? 0, 2000) + (s.extraTailMs ?? 0);
  }

  const framesDir = path.join(repoDir, dirName(m.id), `frames-${s.id}`);
  fs.rmSync(framesDir, { recursive: true, force: true });
  try {
    await captureScene(htmlAbs, { width: m.width, height: m.height, fps: m.fps, durationMs: s.durationMs, framesDir }, signal);

    // DETERMINISTIC STILLNESS AUDIT (2026-07-05): a pixel-frozen scene is a slideshow,
    // not a video — hard failure, same severity as a missing file. The delivered LDL
    // videos measured 0.00 frame-diff over 5s spans and sailed through spot-frame QC.
    if (s.durationMs >= 3000) {
      const motion = await auditSceneMotion(framesDir, s.durationMs, m.fps, signal);
      if (motion?.static) {
        throw new Error(
          `scene ${s.id} is pixel-STATIC mid-scene (max frame diff ${motion.maxDiff.toFixed(3)} across ${motion.sampled} samples) — ` +
            `every element needs an ambient idle (.mg-breathe/.mg-float/.mg-bob) or a camera move (.mg-cam-in/-out/-drift on the stage wrapper). See MOTION.md "NOTHING IS EVER STATIC".`,
        );
      }
    }
    // Frame-fill audit (advisory): a mostly-empty mid frame is the "student project" tell.
    const midFrame = path.join(framesDir, frameName(Math.floor(frameCount(s.durationMs, m.fps) / 2)));
    const fill = await auditFrameFill(midFrame, m.width, m.height, signal);
    if (fill?.mostlyEmpty) {
      s.qcDefects = [
        ...(s.qcDefects ?? []),
        `frame is mostly empty (${fill.flatCells}/9 regions flat) — fill ~85-100% of the frame: a ground, an oversized anchor (.mg-prop-hero / .mg-hero-stat), depth layers`,
      ];
    }

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

/**
 * Cross-scene VARIETY + CUT QC (operator 2026-07-04/05): tile two stills per scene (18% and
 * 82% — near the cuts) into a contact sheet and let vision judge whether consecutive scenes
 * read as real cuts AND whether the cuts land on composed frames. Best-effort; the verdict
 * is reported as a defect note, never fatal.
 */
async function varietyCheck(m: MotionManifest, repoDir: string, signal: AbortSignal): Promise<string | null> {
  if (!config.minimaxApiKey) return null;
  const clips = m.scenes.filter((s) => s.status === 'ok' && s.clip).slice(0, 8);
  if (clips.length < 3) return null;
  const dir = path.join(repoDir, dirName(m.id));
  const stills: string[] = [];
  try {
    for (const s of clips) {
      for (const frac of [0.18, 0.82]) {
        const out = path.join(dir, `.var-${s.id}-${Math.round(frac * 100)}.jpg`);
        const at = (((s.durationMs ?? 4000) / 1000) * frac).toFixed(2);
        const r = await execBashQuiet(
          `ffmpeg -v error -ss ${at} -i ${JSON.stringify(path.join(repoDir, s.clip!))} -frames:v 1 -vf scale=300:-1 -y ${JSON.stringify(out)}`,
          repoDir,
          signal,
        );
        if (r && fs.existsSync(out)) stills.push(out);
      }
    }
    if (stills.length < 6) return null;
    const sheet = path.join(dir, '.var-sheet.jpg');
    const inputs = stills.map((f) => `-i ${JSON.stringify(f)}`).join(' ');
    const refs = stills.map((_, i) => `[${i}:v]`).join('');
    const ok = await execBashQuiet(
      `ffmpeg -v error ${inputs} -filter_complex "${refs}hstack=inputs=${stills.length}" -y ${JSON.stringify(sheet)}`,
      repoDir,
      signal,
    );
    if (!ok || !fs.existsSync(sheet)) return null;
    const v = await analyzeImage(
      fileToDataUrl(sheet),
      `These are the scenes of one motion-graphics video (style pack: ${m.style ?? 'clean'}), in order — TWO stills per scene (shortly after its cut in, and shortly before its cut out). ` +
        `Judge (a) SCENE-TO-SCENE CONTRAST: do consecutive scenes vary in ground (light/dark/accent) AND composition (centered vs split vs giant-number vs grid), reading as real cuts? ` +
        `(b) CUT QUALITY: does each scene already read composed shortly after its cut in (no near-empty frames), and still composed before its cut out? ` +
        `Answer "OK" if both hold, otherwise name the scene numbers and what to fix (one line each, at most 3 lines).`,
      signal,
    );
    fs.rmSync(sheet, { force: true });
    if (v.ok && v.text && !/^\s*ok\b/i.test(v.text)) return v.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' / ');
    return null;
  } catch {
    return null;
  } finally {
    for (const f of stills) fs.rmSync(f, { force: true });
  }
}

async function execBashQuiet(cmd: string, cwd: string, signal: AbortSignal): Promise<boolean> {
  try {
    const { execBash } = await import('../../lib/exec');
    const r = await execBash(cmd, { cwd, timeoutMs: 60_000, signal });
    return r.ok;
  } catch {
    return false;
  }
}

async function assemble(m: MotionManifest, repoDir: string, signal: AbortSignal, addCost: (u: number) => void): Promise<void> {
  const okScenes = m.scenes.filter((s) => s.status === 'ok' && s.clip);
  const clips = okScenes.map((s) => path.join(repoDir, s.clip!));
  if (!clips.length) throw new Error('no scene rendered successfully — nothing to assemble');
  const outRel = `${dirName(m.id)}/explainer.mp4`;
  const outAbs = path.join(repoDir, outRel);
  // Designed transitions at marked seams (scene.transition = INTO the next scene);
  // everything else stays a lossless stream-copy cut.
  const boundaries = okScenes.slice(0, -1).map((s) => TRANSITION_KINDS[s.transition ?? ''] ?? null);
  if (boundaries.some(Boolean)) {
    await stitchClipsSegmented(clips, outAbs, boundaries, { fadeS: 0.5, signal });
  } else {
    await stitchClips(clips, outAbs, { transition: 'cut', signal });
  }
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
        m.stitched = (await finishWithFade(scored, repoDir, m.id, signal)) ?? `${dirName(m.id)}/explainer-scored.mp4`;
        return;
      }
    }
  }
  m.stitched = (await finishWithFade(outAbs, repoDir, m.id, signal)) ?? outRel;
}

/** The ending lands, never stops: fade the last ~0.9s of video+audio to black. */
async function finishWithFade(videoAbs: string, repoDir: string, id: string, signal: AbortSignal): Promise<string | null> {
  const rel = `${dirName(id)}/explainer-final.mp4`;
  const ok = await applyFadeOut(videoAbs, path.join(repoDir, rel), 0.9, signal);
  return ok ? rel : null;
}

function describe(m: MotionManifest): string {
  const rows = m.scenes
    .map((s) => {
      const dur = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '—';
      const flag = s.status !== 'ok' ? ` ✗ ${s.error ?? 'failed'}` : s.qcDefects?.length ? ` ⚠ ${s.qcDefects.join(' / ')}` : ' ✓';
      const file = s.status !== 'ok' || s.qcDefects?.length ? ` [${s.htmlFile}]` : '';
      return `  ${s.id}. ${s.title} — ${dur}${flag}${file}`;
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
  let pacing = '';
  const durations = m.scenes.filter((s) => s.status === 'ok' && s.durationMs).map((s) => s.durationMs!);
  if (isPacingMonotone(durations)) {
    pacing =
      `\nPACING NOTE: every scene is ~the same length (±15% of median) — that reads as a slideshow. ` +
      `Mix beat lengths next time: 1-2 punch beats (≤6 words or a silent min_ms scene) and at most one long dwell per minute.`;
  }
  const target = m.targetSeconds && m.totalMs ? checkTarget(m.targetSeconds, m.totalMs) : '';
  return (
    `Motion video ${m.stitched ? 'assembled' : 'partially rendered'} (id ${m.id}, style ${m.style ?? 'clean'}, ${m.width}x${m.height}@${m.fps}fps, total ${total}` +
    `${m.musicFile ? ', scored' : ''}):\n${rows}\n\nFinal file: ${m.stitched ?? '(not assembled)'}${target}${pacing}\n${next}`
  );
}

function checkTarget(targetS: number, totalMs: number): string {
  const actualS = totalMs / 1000;
  const ratio = actualS / targetS;
  if (ratio > 1.25) return `\nLENGTH: ${actualS.toFixed(0)}s vs the ${targetS}s target (${Math.round((ratio - 1) * 100)}% over) — tighten the narration.`;
  if (ratio < 0.7) return `\nLENGTH: ${actualS.toFixed(0)}s vs the ${targetS}s target — noticeably short.`;
  return '';
}

export const renderMotionVideoTool: ToolDef = {
  name: 'render_motion_video',
  description:
    'Render a NARRATED MOTION-GRAPHICS video (mp4) — vector icons, text and web animation, ' +
    'NO video model (crisp text, any length, per-scene retakes). ' +
    'SCAFFOLDS FIRST: pass most scenes as {scaffold:{id,slots}} — pre-built archetypes with media-house ' +
    'choreography (entrances, exits, camera, idles, composition, style-pack skin) baked in, so you focus on ' +
    `script + content + asset picks. Scaffolds: ${SCAFFOLD_DOC} ` +
    'Icons/charts in slots are workspace-relative paths you materialized FIRST via search_assets / render_chart; ' +
    'plates come from search_photos (real photography) or generate_image. ' +
    'Hand-written {html_file} scenes are the escape hatch for signature moments — THIS TOOL DOES NOT WRITE ' +
    'THE SCENE FILES: create every html_file with write_file BEFORE calling (it fails immediately if any ' +
    'listed file does not exist — never retry without writing the files first). ' +
    'SCRIPT DOCTRINE (read motion-kit/MOTION.md first — the tool enforces parts of it): ' +
    'scene 1 is a HOOK ≤5s that poses the payoff as a question/bold claim/stake (greetings, "in this video", ' +
    'topic statements are REJECTED before rendering); scenes chain with BUT/THEREFORE; one idea per scene, ' +
    '~2 short sentences each; on-screen text never duplicates narration (scaffold slots enforce word ceilings); ' +
    'vary beat lengths (punch scenes via min_ms + empty narration); END on a short punch-out (end-punch), never ' +
    'a disclaimers wall. Set target_seconds and the tool checks your word budget (~2.4 words/s) BEFORE paying for TTS. ' +
    'Pick ONE STYLE PACK per video (style param: nutshell / broadcast / vox / clean) — it skins every scaffold. ' +
    'NOTHING IS EVER STATIC: scenes that render pixel-frozen FAIL (scaffolds carry idles + a camera move; ' +
    'hand-written scenes must too). SCENE CONTRAST is required: adjacent scenes must differ in ground AND ' +
    'composition (scaffold grounds auto-rotate when you omit ground) — consecutive scenes must read as a real ' +
    'CUT, never the same slide re-worded. TRANSITIONS: cuts are choreographed by the scaffolds (exit → entrance); ' +
    'reserve designed transitions for act boundaries via {transition: dip|dissolve|wipe|slide|circle} on the ' +
    'scene BEFORE the seam (1-2 per minute max, one grammar per video). ' +
    'The tool synthesizes narration per scene (timing derives from the real audio), captures frames ' +
    'deterministically, audits motion + frame fill, encodes, vision-checks frames, and assembles the final mp4 ' +
    '(+ optional ducked music bed). Scenes with defects come back named — fix and retake JUST that scene via ' +
    '{motion_id, retake_scene}. Use generate_video (filmed/photographic shots) ONLY when real footage is ' +
    'explicitly wanted.',
  parameters: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        description:
          'The ordered scenes (first call). Each: {title, narration, scaffold?:{id,slots} OR html_file, transition?, min_ms?}. Prefer scaffolds.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short scene label (for the report).' },
            narration: { type: 'string', description: 'EXACT words to speak over this scene (empty string = silent punch beat).' },
            scaffold: {
              type: 'object',
              description: `A scaffold spec {id, slots} — preferred. id one of: ${SCAFFOLD_IDS.join(', ')}.`,
              properties: {
                id: { type: 'string' },
                slots: { type: 'object', description: 'The scaffold slots (see the tool description).' },
              },
              required: ['id'],
            },
            html_file: { type: 'string', description: 'Workspace-relative path of a hand-written scene page (motion-kit HTML) — only when no scaffold fits.' },
            transition: {
              type: 'string',
              enum: ['cut', 'dip', 'dip-white', 'dissolve', 'wipe', 'slide', 'circle'],
              description: 'Transition INTO THE NEXT scene. Default cut. Designed transitions for act boundaries only (1-2/min).',
            },
            min_ms: { type: 'number', description: 'Optional minimum scene duration in ms (punch beats: empty narration + 1500-2500).' },
          },
          required: ['title', 'narration'],
        },
      },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:5'], description: 'Output dimension (default 16:9 = 1920x1080).' },
      target_seconds: { type: 'number', description: 'Intended total length — the tool validates the narration word budget (~2.4 words/s) BEFORE synthesis and flags overshoot.' },
      voice_id: {
        type: 'string',
        description: `Narrator voice. One of: ${MOTION_VOICES.map((v) => `"${v.id}" (${v.note})`).join(', ')}.`,
      },
      speed: { type: 'number', description: 'Narration speed 0.8-1.2 (default 1).' },
      style: {
        type: 'string',
        enum: ['clean', 'nutshell', 'broadcast', 'vox', 'nordic'],
        description:
          'The STYLE PACK the scenes were authored in (see motion-kit/MOTION.md): nutshell = neon flat vector on cosmic grounds (Kurzgesagt-inspired); broadcast = bright stage + shouting callout labels (Infographics-inspired); vox = annotated-evidence plates + yellow boxed labels; nordic = Swiss/Scandinavian grid editorial (paper+ink+one accent, oversized numerals, hairlines, disciplined kinetic type — ONE device per scene); clean = the house style (default). The pack you name here MUST match how you wrote the scene HTML.',
      },
      accent: { type: 'string', description: 'Optional brand accent hex for the scaffold theme (e.g. #0a7d5b).' },
      accent_2: { type: 'string', description: 'Optional secondary accent hex.' },
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
        return 'Error: pass scenes:[{title, narration, scaffold|html_file}, …] in order (read motion-kit/MOTION.md first; prefer scaffolds).';
      if (list.length > 60) return 'Error: 60 scenes max per video.';
      // Every scene needs either a scaffold spec or a hand-written file.
      const unspecced = list
        .map((s: any, i: number) => (!s?.scaffold?.id && !String(s?.html_file ?? '').trim() ? i + 1 : 0))
        .filter(Boolean);
      if (unspecced.length) return `Error: scene(s) ${unspecced.join(', ')} have neither scaffold nor html_file.`;
      // FAIL EARLY when hand-written scene files were never written (the #1 misuse, seen
      // live: the model lists file paths it never created, then loops the identical call).
      // No manifest, no TTS — one unambiguous instruction instead of a per-scene table.
      const missing = list
        .filter((s: any) => !s?.scaffold?.id)
        .map((s: any) => String(s?.html_file ?? ''))
        .filter((f: string) => !f || !fs.existsSync(path.resolve(ctx.repoDir, f)));
      if (missing.length) {
        return (
          `STOP — you have NOT created the scene files yet. This tool does not write them for you.\n` +
          `Missing: ${missing.join(', ')}\n` +
          `Create EACH file now with write_file (a full motion-kit HTML page per scene — read motion-kit/MOTION.md ` +
          `for the skeleton), verify they exist, and only THEN call render_motion_video again. ` +
          `Calling again without writing the files will fail exactly the same way. (Better: use scaffold scenes — no files needed.)`
        );
      }

      // HOOK GATE (retention doctrine): the first scene earns the rest of the video.
      const firstNarration = String(list[0]?.narration ?? '');
      const hookIssue = hookProblems(firstNarration);
      if (hookIssue) return `Error: ${hookIssue}`;

      // WORD BUDGET vs target_seconds — catch length overshoot BEFORE paying for TTS
      // (live lesson: heavy agents write ~140s of narration against a 60s brief).
      const targetSeconds = Number(args.target_seconds) > 0 ? Math.min(3600, Number(args.target_seconds)) : undefined;
      const totalWords = list.reduce((a: number, s: any) => a + wordsOf(String(s?.narration ?? '')), 0);
      const estS = totalWords / WPS + list.length * 0.95;
      if (targetSeconds && estS > targetSeconds * 1.25) {
        const budget = Math.round(targetSeconds * WPS);
        return (
          `Error: the narration is ~${Math.round(estS)}s of speech against a ${targetSeconds}s target (${totalWords} words; ` +
          `budget ≈ ${budget} words TOTAL across all scenes). Cut the script — one idea per sentence, drop whole beats, ` +
          `do not just trim words — then call again.`
        );
      }

      const aspect = String(args.aspect_ratio ?? '16:9');
      const dim = DIMENSION_PRESETS[aspect] ?? DIMENSION_PRESETS['16:9'];
      const style: MotionStyle = ['nutshell', 'broadcast', 'vox', 'nordic'].includes(String(args.style)) ? (args.style as MotionStyle) : 'clean';
      const id = String(Date.now());
      const accent = /^#[0-9a-fA-F]{6}$/.test(String(args.accent ?? '')) ? String(args.accent) : undefined;
      const accent2 = /^#[0-9a-fA-F]{6}$/.test(String(args.accent_2 ?? '')) ? String(args.accent_2) : undefined;

      // Materialize scaffold scenes (slot validation first — nothing is written on a bad spec).
      const readAsset = workspaceAssetReader(ctx.repoDir);
      const rendered: { idx: number; html: string }[] = [];
      const scaffoldProblems: string[] = [];
      list.forEach((s: any, i: number) => {
        if (!s?.scaffold?.id) return;
        const r = materializeScaffold(s.scaffold, {
          style,
          kitPrefix: '../../',
          sceneIndex: i,
          readAsset,
          accent,
          accent2,
        });
        if (r.problems.length) scaffoldProblems.push(`scene ${i + 1} (${s.scaffold.id}): ${r.problems.join('; ')}`);
        else rendered.push({ idx: i, html: r.html! });
      });
      if (scaffoldProblems.length) {
        return `Error: scaffold slot problems — fix and call again (nothing was rendered):\n${scaffoldProblems.map((p) => `- ${p}`).join('\n')}`;
      }
      fs.mkdirSync(path.join(ctx.repoDir, dirName(id)), { recursive: true });
      const sceneFiles = new Map<number, string>();
      for (const r of rendered) {
        const rel = `${dirName(id)}/scene-${r.idx + 1}.html`;
        fs.writeFileSync(path.join(ctx.repoDir, rel), r.html);
        sceneFiles.set(r.idx, rel);
      }

      const scenes: MotionScene[] = list.map((s: any, i: number) => ({
        id: i + 1,
        title: String(s.title ?? `Scene ${i + 1}`).slice(0, 80),
        narration: String(s.narration ?? ''),
        htmlFile: sceneFiles.get(i) ?? String(s.html_file ?? ''),
        scaffoldId: s?.scaffold?.id ? String(s.scaffold.id) : undefined,
        transition: TRANSITION_KINDS[String(s?.transition ?? '')] ? String(s.transition) : undefined,
        minMs: s.min_ms ? Math.min(30_000, Math.max(0, Number(s.min_ms))) : undefined,
        extraTailMs: i === list.length - 1 ? 800 : undefined, // the ending breathes, then fades
        status: 'pending',
      }));
      // fps derives from a rough total estimate: ~145 words/min narration + holds.
      const estMs = estS * 1000;
      m = {
        id,
        style,
        aspect,
        width: dim.w,
        height: dim.h,
        fps: pickFps(estMs),
        voiceId: typeof args.voice_id === 'string' && args.voice_id.trim() ? args.voice_id.trim() : 'Wise_Woman',
        speed: Math.min(1.2, Math.max(0.8, Number(args.speed) || 1)),
        music: args.music ? String(args.music).slice(0, 300) : undefined,
        targetSeconds,
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

    // Everything heavy runs inside the ONE-render-at-a-time slot.
    return withRenderSlot(async (queuedMs) => {
      if (ctx.signal.aborted) return 'Error: the run was cancelled while this render was queued.';
      const queuedNote = queuedMs > 5000 ? `(waited ${(queuedMs / 1000).toFixed(0)}s in the render queue behind another video)\n` : '';

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
        await assemble(m!, ctx.repoDir, ctx.signal, ctx.addCost);
      } catch (e: any) {
        saveManifest(ctx.repoDir, m!);
        return `Error: assembly failed — ${String(e?.message ?? e)}\n${describe(m!)}`;
      }
      saveManifest(ctx.repoDir, m!);
      // Cross-scene contrast + cut verdict — only on a fresh full render (retakes keep their notes).
      let variety = '';
      if (retake == null) {
        const v = await varietyCheck(m!, ctx.repoDir, ctx.signal);
        if (v)
          variety =
            `\n\nSCENE-CONTRAST REVIEW: ${v}\nVary the named scenes' GROUND (.mg-ground-dark / .mg-ground-accent vs light) ` +
            `and COMPOSITION (see MOTION.md "SCENE CONTRAST"), then retake them.`;
      }
      return queuedNote + describe(m!) + variety;
    });
  },
};
