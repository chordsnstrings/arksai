import { generateTextM3 } from '../engines/minimax';
import { config } from '../config';

/**
 * Scene planner for multi-scene story videos (STORY_PLAN Phase 1).
 *
 * One casual paragraph ("a man walks the desert → zoom to the phone showing the pick-up button
 * → a helicopter drops a car → a suited driver opens the door") becomes a typed StoryPlan:
 * per scene a compiled prompt, a duration ("exactly as long as necessary", 4 s floor), and a
 * continuity MECHANISM — the routing decisions proven by the 2026-07-03 probes
 * (SCENES_RESEARCH §8):
 *   t2v             fresh shot                      → Seedance 1.5 (drafts, filter-immune)
 *   i2v-composited  opens on a Chromium-rastered
 *                   pixel-exact frame (app UI…)     → 1.5 i2v
 *   frame-chain     hard cut, same world — opens on
 *                   the previous scene's LAST frame → 1.5 i2v (the workhorse cut)
 *   extend          the same take CONTINUES         → 2.0-fast r2v reference_video (web URL)
 * plus optional reference images on any scene for cast/product identity.
 *
 * Fail-OPEN like every compiler here: if the LLM pass fails, a deterministic splitter still
 * returns a valid plan. Everything the LLM returns passes through normalizeStoryPlan (pure,
 * tested) which enforces the caps — the model proposes, the guards dispose.
 */

export type SceneMechanism = 't2v' | 'i2v-composited' | 'frame-chain' | 'extend';

export interface ScenePlan {
  id: number; // 1-based, stable across retakes
  what: string; // user-visible one-liner (the scene strip label)
  prompt: string; // the director-grade prompt for THIS scene (styleLine appended by the executor)
  durationS: number;
  mechanism: SceneMechanism;
  /** i2v-composited only: self-contained HTML for the exact first frame (rastered in Chromium). */
  compositeHtml?: string;
  /** Workspace image paths asserted as reference_image (cast/product identity — runs on 2.0). */
  castRefs?: string[];
  /** Per-scene diegetic audio direction (one shared music bed is a Phase-4 concern). */
  audioDirection: string;
}

export interface StoryPlan {
  scenes: ScenePlan[];
  /** ONE style+light+grade sentence injected into EVERY scene prompt so the look never drifts. */
  styleLine: string;
  aspect: '16:9' | '9:16' | '1:1';
  estUsd: number;
  estMinutes: number;
  /** Human notes accumulated by the guards (truncations, downgrades) — surfaced to the user. */
  notes: string[];
}

export const STORY_CAPS = {
  maxScenes: 8,
  maxTotalS: 60,
  minSceneS: 4,
  // 1.5 mechanisms cap at 12 s; extend runs on 2.0 (15 s). Enforced per mechanism.
  maxSceneS15: 12,
  maxSceneS20: 15,
  maxConsecutiveExtends: 2,
} as const;

const DEFAULT_STYLE_LINE =
  'Style: premium cinematic, photoreal, natural film-tone colour grade, consistent warm key light across every scene.';

/* ── pure guards ─────────────────────────────────────────────────────────── */

const MECHS: SceneMechanism[] = ['t2v', 'i2v-composited', 'frame-chain', 'extend'];

/** Clamp/repair a raw plan into a legal one. PURE — the heart of the planner's safety. */
export function normalizeStoryPlan(raw: any, opts?: { aspect?: string }): StoryPlan {
  const notes: string[] = [];
  const aspect = (['16:9', '9:16', '1:1'] as const).includes(raw?.aspect) ? raw.aspect : ((opts?.aspect as any) || '16:9');
  let scenes: any[] = Array.isArray(raw?.scenes) ? raw.scenes.filter((s: any) => s && (s.prompt || s.what)) : [];
  if (scenes.length > STORY_CAPS.maxScenes) {
    notes.push(`trimmed to the first ${STORY_CAPS.maxScenes} scenes (the v1 ceiling)`);
    scenes = scenes.slice(0, STORY_CAPS.maxScenes);
  }
  let consecutiveExtends = 0;
  const out: ScenePlan[] = scenes.map((s, i) => {
    let mechanism: SceneMechanism = MECHS.includes(s.mechanism) ? s.mechanism : 't2v';
    // Scene 1 has nothing to chain from or extend.
    if (i === 0 && (mechanism === 'frame-chain' || mechanism === 'extend')) mechanism = s.compositeHtml ? 'i2v-composited' : 't2v';
    // Drift guard: at most N consecutive extends, then force a cut.
    if (mechanism === 'extend') {
      consecutiveExtends += 1;
      if (consecutiveExtends > STORY_CAPS.maxConsecutiveExtends) {
        mechanism = 'frame-chain';
        consecutiveExtends = 0;
        notes.push(`scene ${i + 1}: switched from extend to a cut (extension drift guard)`);
      }
    } else {
      consecutiveExtends = 0;
    }
    const maxS = mechanism === 'extend' ? STORY_CAPS.maxSceneS20 : STORY_CAPS.maxSceneS15;
    const durationS = Math.min(maxS, Math.max(STORY_CAPS.minSceneS, Math.round(Number(s.durationS) || 6)));
    const compositeHtml = mechanism === 'i2v-composited' && typeof s.compositeHtml === 'string' && s.compositeHtml.trim()
      ? String(s.compositeHtml)
      : undefined;
    if (mechanism === 'i2v-composited' && !compositeHtml) {
      mechanism = 't2v';
      notes.push(`scene ${i + 1}: no exact frame was provided — rendered as a normal shot`);
    }
    return {
      id: i + 1,
      what: String(s.what || s.prompt || `Scene ${i + 1}`).slice(0, 120),
      prompt: String(s.prompt || s.what || '').trim(),
      durationS,
      mechanism,
      compositeHtml,
      castRefs: Array.isArray(s.castRefs) ? s.castRefs.map(String).filter(Boolean).slice(0, 4) : undefined,
      audioDirection: String(s.audioDirection || 'natural ambience matching the scene').slice(0, 200),
    };
  });
  // Total-length cap: shrink proportionally toward the floor, then truncate if still over.
  let total = out.reduce((n, s) => n + s.durationS, 0);
  if (total > STORY_CAPS.maxTotalS) {
    const scale = STORY_CAPS.maxTotalS / total;
    for (const s of out) s.durationS = Math.max(STORY_CAPS.minSceneS, Math.floor(s.durationS * scale));
    total = out.reduce((n, s) => n + s.durationS, 0);
    while (total > STORY_CAPS.maxTotalS && out.length > 1) {
      const dropped = out.pop()!;
      total -= dropped.durationS;
      notes.push(`dropped scene ${dropped.id} ("${dropped.what}") to stay within the ${STORY_CAPS.maxTotalS}s ceiling`);
    }
    if (!notes.some((n) => n.includes('ceiling'))) notes.push(`scene lengths tightened to fit the ${STORY_CAPS.maxTotalS}s ceiling`);
  }
  const styleLine = String(raw?.styleLine || '').trim() || DEFAULT_STYLE_LINE;
  const { estUsd, estMinutes } = estimateStory(out);
  return { scenes: out, styleLine, aspect, estUsd, estMinutes, notes };
}

/**
 * Cost/time estimate from the PROBED usage numbers (SCENES_RESEARCH §8.8):
 * 1.5 draft ≈ 6 k tokens/s; 2.0-fast r2v ≈ 10 k/s + ~90 k for the input clip tokenization.
 * Rates env-tunable; finals ≈ 4× draft tokens (higher resolution) — the estimate covers the
 * DRAFT pass, with finals quoted separately as ~4×.
 */
export function estimateStory(scenes: Pick<ScenePlan, 'durationS' | 'mechanism'>[]): { estUsd: number; estMinutes: number } {
  const rate = config.seedanceCostPerKTok;
  let kTok = 0;
  let seconds = 0;
  for (const s of scenes) {
    if (s.mechanism === 'extend') {
      kTok += s.durationS * 10 + 90;
      seconds += 130; // probed: ~117 s + polling
    } else {
      kTok += s.durationS * 6;
      seconds += 60; // probed drafts: 23–52 s + polling
    }
  }
  seconds += 20; // stitch + frame extraction
  return { estUsd: Math.round(kTok * rate * 100) / 100, estMinutes: Math.max(1, Math.round(seconds / 60)) };
}

/** Deterministic fail-open splitter: beats become scenes, all cuts, sane defaults. PURE. */
export function heuristicPlan(brief: string, opts?: { aspect?: string }): StoryPlan {
  const text = brief.trim().replace(/\s+/g, ' ');
  // Split on strong sequence markers first, then sentences.
  let parts = text
    .split(/(?:\s*(?:→|;|\bthen\b|\bright after\b|\bafter that\b|\bnext\b|\bfinally\b)\s*)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 8);
  if (parts.length < 2) parts = text.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter((p) => p.length > 8);
  parts = parts.slice(0, 4);
  if (parts.length === 0) parts = [text];
  return normalizeStoryPlan(
    {
      scenes: parts.map((p, i) => ({
        what: p.slice(0, 80),
        prompt: p,
        durationS: 6,
        mechanism: i === 0 ? 't2v' : 'frame-chain',
        audioDirection: 'natural ambience matching the scene',
      })),
      styleLine: DEFAULT_STYLE_LINE,
    },
    opts,
  );
}

/* ── the LLM pass ────────────────────────────────────────────────────────── */

const PLANNER_SYSTEM =
  'You are a commercial film director planning an AI-generated multi-scene video. You output ONLY ' +
  'strict JSON (no prose, no markdown fences). You break a story into the FEWEST scenes that tell ' +
  'it well, each exactly as long as it needs (4s minimum), and pick each scene\'s continuity ' +
  'mechanism deliberately.';

function plannerPrompt(brief: string, o: { aspect: string; castNote: string; durationHint?: number }): string {
  return `STORY (the user's own words): "${brief.slice(0, 1200)}"

Return JSON exactly in this shape:
{"styleLine":"<ONE sentence: style + lighting + grade, applied to every scene so the look never drifts>",
 "scenes":[{"what":"<short label>","prompt":"<director-grade prompt for this scene: subject + action + ONE camera move + what we see; do NOT repeat style/light (styleLine covers it)>","durationS":<4-12, 4-15 for extend>,"mechanism":"t2v|i2v-composited|frame-chain|extend","compositeHtml":"<ONLY for i2v-composited>","audioDirection":"<diegetic sound for this scene>"}]}

MECHANISM RULES (follow exactly):
- scene 1: "t2v" (or "i2v-composited" if it must open on pixel-exact content).
- the same take visibly CONTINUES (no cut): "extend" — max 2 in a row.
- a hard cut within the same world/moment: "frame-chain" (the default for scene 2+).
- anything that must show EXACT text or UI (an app screen, a sign, a menu, a scoreboard):
  "i2v-composited" + provide compositeHtml — a single self-contained <div> layout (inline CSS,
  no external resources) that renders that exact content; the video model animates FROM it.
  compositeHtml craft rules (it gets FILMED, so design for the camera): the user's exact text
  VERBATIM; large high-contrast type (any button/headline ≥40px, labels ≥24px, never below
  20px); a simple bold layout filling the frame (one screen/sign, generous padding); dark-UI or
  strong-contrast colours — thin grey small-print smears on video.
- ${o.castNote}
Constraints: ${o.aspect} aspect; ≤${STORY_CAPS.maxScenes} scenes; total ≤${STORY_CAPS.maxTotalS}s${o.durationHint ? `; aim for ~${o.durationHint}s total` : ''}; every scene prompt mentions continuity anchors ("the same man", "the same kitchen") by DESCRIPTION, never "as before".`;
}

/** Extract the first JSON object from an LLM reply (tolerates fences/preamble). PURE. */
export function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  // Walk to the matching close brace (strings respected) — cheaper than trying JSON.parse windows.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface PlanStoryOpts {
  aspect?: string;
  durationHint?: number;
  /** Workspace image paths of cast/product stills the user provided. */
  castImages?: string[];
  signal?: AbortSignal;
  /** Test seam: replaces the LLM call. */
  llm?: (prompt: string, system: string) => Promise<string | null>;
}

/** Plan the story. NEVER throws — worst case the deterministic splitter answers. */
export async function planStory(brief: string, opts: PlanStoryOpts = {}): Promise<StoryPlan> {
  const aspect = opts.aspect || '16:9';
  const castNote = opts.castImages?.length
    ? `the user provided ${opts.castImages.length} cast/product still(s) — scenes featuring that character/product should set "castRefs": ${JSON.stringify(opts.castImages)}.`
    : 'no cast stills were provided — do not emit castRefs.';
  try {
    const call =
      opts.llm ??
      (async (p: string, sys: string) => {
        if (!config.minimaxApiKey) return null;
        const r = await generateTextM3(p, opts.signal ?? new AbortController().signal, { maxTokens: 2200, system: sys });
        return r.ok ? r.text : null;
      });
    const text = await call(plannerPrompt(brief, { aspect, castNote, durationHint: opts.durationHint }), PLANNER_SYSTEM);
    if (text) {
      const raw = extractJson(text);
      if (raw?.scenes?.length) {
        const plan = normalizeStoryPlan(raw, { aspect });
        if (plan.scenes.length && plan.scenes.every((s) => s.prompt.length > 10)) return plan;
      }
    }
  } catch {
    /* fall through to the heuristic */
  }
  const fallback = heuristicPlan(brief, { aspect });
  fallback.notes.push('planned with the quick splitter (the full planner was unavailable)');
  return fallback;
}

/** The user-facing scene table (chat + progress surfaces). */
export function planSummary(plan: StoryPlan): string {
  const rows = plan.scenes.map(
    (s) => `${s.id}. [${s.durationS}s · ${s.mechanism === 'i2v-composited' ? 'exact-frame' : s.mechanism}] ${s.what}`,
  );
  const total = plan.scenes.reduce((n, s) => n + s.durationS, 0);
  return [
    `Story plan — ${plan.scenes.length} scenes, ~${total}s total (draft ≈ $${plan.estUsd.toFixed(2)}, ~${plan.estMinutes} min):`,
    ...rows,
    ...(plan.notes.length ? [`Notes: ${plan.notes.join('; ')}`] : []),
  ].join('\n');
}
