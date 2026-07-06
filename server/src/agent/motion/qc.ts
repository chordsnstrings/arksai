import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../../lib/exec';
import { frameCount, frameName } from './encode';

/**
 * Deterministic motion QC — the checks the 2026-07-05 audit proved the vision spot-frames
 * could never make (a frozen scene passes two spot frames by construction; a 65%-empty
 * frame reads "clean"). Pure command builders + parsers, exec wrappers kept thin.
 *
 * 1. STILLNESS: pixel-diff pairs of already-captured frames 0.5s apart at 40/60/80% of the
 *    scene. ffmpeg blend=difference + signalstats YAVG — 0.00 means bit-identical (both
 *    delivered LDL videos measured 0.00 over 5s spans). A static scene is a HARD failure.
 * 2. FRAME FILL: 3×3 grid of YSTDEV per cell on the mid frame — a cell of one flat color
 *    has ~0 luma deviation. ≥6 flat cells = a mostly-empty frame (advisory defect: some
 *    deliberately sparse beats are legitimate, so this reports rather than fails).
 */

const q = (s: string) => JSON.stringify(s);

/** Mean luma of the difference between two stills — 0 = identical frames. */
export function frameDiffCmd(a: string, b: string): string {
  return (
    `ffmpeg -hide_banner -loglevel info -i ${q(a)} -i ${q(b)} ` +
    `-filter_complex "[0:v][1:v]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" ` +
    `-frames:v 1 -f null -`
  );
}

/** Luma standard deviation of one region of a still (flat color ⇒ ~0). */
export function cellStdevCmd(frame: string, cell: { w: number; h: number; x: number; y: number }): string {
  return (
    `ffmpeg -hide_banner -loglevel info -i ${q(frame)} ` +
    `-vf "crop=${cell.w}:${cell.h}:${cell.x}:${cell.y},signalstats,metadata=print:key=lavfi.signalstats.YSTDEV:file=-" ` +
    `-frames:v 1 -f null -`
  );
}

export function parseSignalstat(output: string, key: 'YAVG' | 'YSTDEV'): number | null {
  const m = output.match(new RegExp(`signalstats\\.${key}=([0-9.]+)`));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** The frame-index pairs (0.5s apart, at 40/60/80%) the stillness audit samples. Pure. */
export function stillnessPairs(durationMs: number, fps: number): Array<[number, number]> {
  const total = frameCount(durationMs, fps);
  const gap = Math.max(1, Math.round(fps * 0.5));
  const pairs: Array<[number, number]> = [];
  for (const frac of [0.4, 0.6, 0.8]) {
    const i = Math.min(total - 1, Math.max(0, Math.floor(total * frac)));
    const j = Math.min(total - 1, i + gap);
    if (j > i && !pairs.some(([a, b]) => a === i && b === j)) pairs.push([i, j]);
  }
  return pairs;
}

export interface StillnessVerdict {
  maxDiff: number;
  sampled: number;
  static: boolean;
  /** Above the hard floor but reads near-static (camera-only drift) — advisory, not fatal. */
  weak: boolean;
}

const STILLNESS_THRESHOLD = 0.18; // YAVG of the diff; alive scenes with a camera move clear this by 5-50×
// The living-frame doctrine (2026-07-05): scaffold scenes with ambient drift/idles measure
// 1.5+ mid-scene; below this the frame reads as a slide with a slow zoom. Advisory only —
// legitimate ultra-restrained scenes (nordic) may sit here by design.
const WEAK_MOTION_THRESHOLD = 0.6;

/** Measure motion across the captured frames of one scene (frames still on disk). */
export async function auditSceneMotion(
  framesDir: string,
  durationMs: number,
  fps: number,
  signal?: AbortSignal,
): Promise<StillnessVerdict | null> {
  const pairs = stillnessPairs(durationMs, fps);
  let maxDiff = 0;
  let sampled = 0;
  for (const [i, j] of pairs) {
    const a = path.join(framesDir, frameName(i));
    const b = path.join(framesDir, frameName(j));
    if (!fs.existsSync(a) || !fs.existsSync(b)) continue;
    try {
      const r = await execBash(frameDiffCmd(a, b), { cwd: framesDir, timeoutMs: 30_000, signal });
      const v = parseSignalstat(r.output || '', 'YAVG');
      if (v == null) continue;
      sampled++;
      maxDiff = Math.max(maxDiff, v);
    } catch {
      /* measurement is best-effort per pair */
    }
  }
  if (!sampled) return null; // could not measure — never fail a scene on missing evidence
  return { maxDiff, sampled, static: maxDiff < STILLNESS_THRESHOLD, weak: maxDiff < WEAK_MOTION_THRESHOLD };
}

export interface FillVerdict {
  flatCells: number; // of 9
  mostlyEmpty: boolean;
}

const FLAT_STDEV = 1.1; // a wash-gradient cell measures above this; a solid color ~0

/** 3×3 ink-coverage audit on one captured frame. */
export async function auditFrameFill(
  frameAbs: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<FillVerdict | null> {
  if (!fs.existsSync(frameAbs)) return null;
  const cw = Math.floor(width / 3);
  const ch = Math.floor(height / 3);
  let flat = 0;
  let measured = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      try {
        const res = await execBash(cellStdevCmd(frameAbs, { w: cw, h: ch, x: c * cw, y: r * ch }), {
          cwd: path.dirname(frameAbs),
          timeoutMs: 20_000,
          signal,
        });
        const v = parseSignalstat(res.output || '', 'YSTDEV');
        if (v == null) continue;
        measured++;
        if (v < FLAT_STDEV) flat++;
      } catch {
        /* best-effort */
      }
    }
  }
  if (measured < 6) return null;
  return { flatCells: flat, mostlyEmpty: flat >= 6 };
}

/** Uniform-pacing detector: true when every scene sits within ±15% of the median. Pure. */
export function isPacingMonotone(durationsMs: number[]): boolean {
  if (durationsMs.length < 4) return false;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return false;
  return durationsMs.every((d) => Math.abs(d - median) / median <= 0.15);
}

/** Hook-killer opening lines — rejected before any TTS is paid for. Pure. */
/**
 * SCRIPT QUALITY GATE (operator 2026-07-06: "ensure the actual script that gets generated
 * is high quality" — research distilled in SCRIPT_CRAFT.md). Deterministic pre-TTS checks
 * over the WHOLE script. `hard` problems block synthesis (they are the regexable AI-script
 * tells: essay scaffolding, CTA endings, hype); `advisory` problems ship but come back to
 * the agent as named defects to fix in the next pass.
 */
export interface ScriptVerdict {
  hard: string[];
  advisory: string[];
}

const ESSAY_SCAFFOLDING =
  /\b(in conclusion|to summariz|in summary|to sum up|firstly|secondly|thirdly|furthermore|moreover|additionally|in today'?s (fast.paced |digital |modern )?world|without further ado|let'?s dive in|delve|it is (important|worth) (to note|noting)|needless to say|so there you have it|at the end of the day|hope you (enjoyed|learned))\b/i;
const CTA_ENDING = /\b(like and subscribe|smash that|follow (for|me for) more|link in (the )?(bio|description)|comment below|hit the bell)\b/i;
const HYPE = /\b(you won'?t believe|mind.?blowing|shocking|insane|jaw.?dropping|blow your mind|game.?changer)\b/i;
const AI_LEXICON = /\b(tapestry|realm|unlock the|unleash|harness the|elevate your|embark on|journey (of|into)|navigate the|robust|seamless|pivotal|foster|garner|underscore|testament to|revolutioniz|deep dive|the world of|boasts)\b/gi;
const INTENSIFIERS = /\b(truly|incredibly|extremely|absolutely|utterly|remarkably|undeniably|very|really)\b/gi;
const HEDGES = /\b(perhaps|possibly|potentially|somewhat|relatively|more or less|in some cases|seems? to|tends? to)\b/gi;
const CONNECTIVES = /\b(but|yet|so|because|instead|except|turns out|which means|that'?s why|here'?s the thing)\b/gi;
// Outro filler + ending-signals (research 2026-07-06: MrBeast doc "never signal the end";
// retention data — dead tails crater completion; see SCRIPT_CRAFT.md THE ENDING).
const OUTRO_SCAFFOLDING =
  /\b(that'?s (it|all) for (today|now|this)|thanks?( you)? for watching|see you (next|in the next)|until next time|before we wrap( up)?|to wrap (this |things |it )?up|signing off|stay tuned|in this video we)\b/i;
// A final line may not trail off on connective tissue — end-focus puts the payoff word last.
const WEAK_LAST_WORD = new Set([
  'a','an','the','and','or','but','so','to','of','in','on','at','by','for','with','from','though','however',
  'it','its','this','that','these','those','them','then','there','etc','also','too','again','more','less',
  'is','are','was','were','be','been','being','stuff','things','thing','something','anything',
]);
const num_re = /\d[\d,.]*%?/g;
const contentTokens = (s: string): Set<string> => {
  const stop = new Set(['with','this','that','from','have','what','when','your','yours','they','their','them','about','into','more','than','will','just','like','over','only','ever','been','were','does','doesn','can','could','would','should','you','the','and','but','not','how','why','who','its','it','are','was','for','all','one','two','out','off','has','had','get','gets','a','an','of','in','on','at','to','is','be','do','we','our','us','if','or','so','no','yes','actually','really','never','every','some','most','then','there','here']);
  const out = new Set<string>();
  for (const m of s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    const w = m.replace(/'s$/, '');
    if (stop.has(w)) continue;
    // light stem so "windows" calls back "window"
    out.add(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  }
  for (const n of s.match(num_re) ?? []) out.add(n.replace(/[,.]$/, ''));
  return out;
};

export function scriptProblems(narrations: string[]): ScriptVerdict {
  const hard: string[] = [];
  const advisory: string[] = [];
  const full = narrations.join(' ').trim();
  if (!full) return { hard, advisory };

  const scaffold = full.match(ESSAY_SCAFFOLDING);
  if (scaffold) hard.push(`essay scaffolding ("${scaffold[0]}") — spoken video is a story, not an essay; cut the connective tissue and let the beats collide (BUT/THEREFORE)`);
  const cta = full.match(CTA_ENDING);
  if (cta) hard.push(`engagement CTA ("${cta[0]}") — never spend narration on meta-asks; end on a punch-out line instead`);
  const hype = full.match(HYPE);
  if (hype) hard.push(`hype promise ("${hype[0]}") — if the fact is good, the fact carries it; state the fact`);

  const intens = full.match(INTENSIFIERS) ?? [];
  if (intens.length >= 2) advisory.push(`${intens.length} empty intensifiers (${[...new Set(intens.map((w) => w.toLowerCase()))].join(', ')}) — delete each or replace the base word with a stronger one`);
  const hedges = full.match(HEDGES) ?? [];
  if (hedges.length >= 2) advisory.push(`${hedges.length} hedges (${[...new Set(hedges.map((w) => w.toLowerCase()))].join(', ')}) — an explainer asserts or omits; keep at most one deliberate hedge on a genuinely contested claim`);
  const lex = full.match(AI_LEXICON) ?? [];
  if (lex.length >= 1) advisory.push(`AI-lexicon tell${lex.length > 1 ? 's' : ''} (${[...new Set(lex.map((w) => w.toLowerCase()))].join(', ')}) — replace with plain concrete words`);

  // But/Therefore: a multi-beat script with no contrastive/causal connective is a list.
  if (narrations.filter((n) => n.trim()).length >= 3) {
    const conn = full.match(CONNECTIVES) ?? [];
    if (conn.length === 0) hard.push('no BUT/THEREFORE connective anywhere — the beats read as a reorderable list, not a story; link every scene to the next with tension (but/except/turns out) or consequence (so/which means/that\'s why)');
  }

  // Sentence-rhythm monotony: 3+ consecutive sentences within ±2 words of each other.
  const sentences = full.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  if (sentences.length >= 4) {
    const lens = sentences.map((s) => s.split(/\s+/).length);
    for (let i = 0; i + 2 < lens.length; i++) {
      if (Math.abs(lens[i] - lens[i + 1]) <= 2 && Math.abs(lens[i + 1] - lens[i + 2]) <= 2) {
        advisory.push(`sentence-rhythm monotony (three consecutive sentences of ~${lens[i + 1]} words) — vary deliberately: two short, one long, one very short`);
        break;
      }
    }
    const tooLong = sentences.find((s) => s.split(/\s+/).length > 24);
    if (tooLong) advisory.push(`a ${tooLong.split(/\s+/).length}-word sentence ("${tooLong.slice(0, 50)}…") — one idea per sentence, hard max ~20 words spoken`);
  }

  // Stakes: no "you/your" anywhere in a multi-beat script = no reason to care.
  if (narrations.length >= 2 && !/\b(you|your)\b/i.test(full)) {
    advisory.push('the script never says "you" — anchor the stakes in the viewer ("your money", "your brain") or carry them through a named character');
  }

  // THE ENDING GATE — a proper ending is a SCRIPT event (a payoff line that closes the
  // hook's loop), not a video segment. The audio tail/fade is engineered downstream;
  // these checks stop the script from ending on its Nth content point.
  const beats = narrations.map((n) => n.trim()).filter(Boolean);
  if (beats.length >= 2) {
    const outro = full.match(OUTRO_SCAFFOLDING);
    if (outro) hard.push(`outro filler / ending-signal ("${outro[0]}") — never announce the ending or thank the viewer; land the payoff line and stop`);

    const lastBeat = beats[beats.length - 1];
    const lastSentences = lastBeat.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    const lastLine = lastSentences[lastSentences.length - 1] ?? '';
    const lastWords = lastLine.split(/\s+/).filter(Boolean);

    // Landing strip: the final sentence IS the outro — short, concrete, payoff word last.
    if (lastWords.length > 12) {
      hard.push(`the final sentence is ${lastWords.length} words ("${lastLine.slice(0, 60)}…") — the last line is the outro: ≤8 words, concrete, ending on the payoff word`);
    } else if (lastWords.length > 8) {
      advisory.push(`the final sentence is ${lastWords.length} words — tighten the landing to ≤8 so it punches`);
    }
    const lastTok = (lastWords[lastWords.length - 1] ?? '').toLowerCase().replace(/[^a-z'-]/g, '');
    if (lastTok && WEAK_LAST_WORD.has(lastTok)) {
      hard.push(`the script's very last word is "${lastTok}" — a trailing thought, not a landing; end-focus: put the payoff noun/number LAST`);
    }

    // Callback: the ending must return to the hook (reuse a key word or number) so the
    // loop the hook opened audibly closes. Kicker craft: "look back upstream".
    if (beats.length >= 3) {
      const hookToks = contentTokens(beats[0]);
      const endToks = contentTokens(lastBeat);
      const shared = [...endToks].some((t) => hookToks.has(t));
      if (hookToks.size > 0 && endToks.size > 0 && !shared) {
        hard.push('the final beat never returns to the hook — reuse the hook\'s key word or number in the closing line ("callback") so the opening question is audibly answered');
      }
    }

    // The closing beat is the SHORTEST beat, and it synthesizes — it never adds content.
    const lastBeatWords = lastBeat.split(/\s+/).filter(Boolean).length;
    if (lastBeatWords > 15) {
      advisory.push(`the final beat is ${lastBeatWords} words — the closing beat is the SHORTEST (a punch-out line); move content up a beat and end on the takeaway`);
    }
    const earlier = beats.slice(0, -1).join(' ');
    const earlierNums = new Set((earlier.match(num_re) ?? []).map((n) => n.replace(/[,.]$/, '')));
    const newNum = (lastBeat.match(num_re) ?? []).map((n) => n.replace(/[,.]$/, '')).find((n) => !earlierNums.has(n));
    if (newNum) {
      advisory.push(`the final beat introduces a new number (${newNum}) — the ending synthesizes, it never adds content; move the stat earlier and end on what it MEANS`);
    }
  }
  return { hard, advisory };
}

export function hookProblems(firstNarration: string): string | null {
  const t = firstNarration.trim();
  if (!t) return null; // silent opening beat is allowed (visual hook)
  const throatClearing =
    /^(hi\b|hello\b|hey\b|welcome\b|good (morning|afternoon|evening)|today,? (we|i|let)|in this video|this video (is|will|covers)|let's talk about|we're going to (talk|look|discuss)|i'm going to (show|tell|walk)|(this is|here's) a video about)/i;
  if (throatClearing.test(t)) {
    return (
      `scene 1 opens with throat-clearing ("${t.slice(0, 60)}…") — 55% of viewers are lost in the first minute. ` +
      `Open with the payoff as a QUESTION, a BOLD CLAIM, a STAKE or a SHOCKING NUMBER (see motion-kit/MOTION.md "THE HOOK" templates), never a greeting or topic statement.`
    );
  }
  const w = t.split(/\s+/).filter(Boolean).length;
  if (w > 30) {
    return `scene 1 narration is ${w} words — a hook beat is ≤5 seconds (~12 words). Cut it to one sharp question/claim and move the rest to scene 2.`;
  }
  return null;
}
