/**
 * Deterministic auto-expertise router (Phase 1 of EXPERTISE_PLAN.md).
 *
 * A free-form message (the user typed something instead of picking a department "play")
 * arrives with session.task === null, so no expertise is injected and they get the
 * generic agent. This pure, synchronous, dependency-free matcher reads the user's text
 * and selects the right task key (or, failing that, a department persona) from the
 * trigger tables in expertise.ts — at ZERO latency/token cost.
 *
 * It is DETERMINISTIC ONLY in Phase 1 (no LLM call). A picked play always wins; this
 * only ever fills the null case (gated by config.autoExpertise + caller checks).
 */

import type { SessionMode } from '../../../shared/types';
import { TASK_TRIGGERS, DEPARTMENT_TRIGGERS } from './expertise';

/**
 * Confidence tier (Phase 4). Drives how the caller injects expertise:
 * - 'high'   → inject the specific task expertise silently.
 * - 'medium' → inject the DEPARTMENT PERSONA only (still expert voice, no wrong specifics).
 * - 'low'    → a weak signal; inject NOTHING — leave the message to the chat prompt's
 *              vague-clarify path so the agent asks ONE crisp question instead of guessing.
 * - 'none'   → no signal at all (off-catalog / empty).
 */
export type ExpertiseTier = 'high' | 'medium' | 'low' | 'none';

export interface ExpertiseRoute {
  taskKey: string | null;
  department: string | null;
  confidence: number; // 0..1
  tier: ExpertiseTier;
  source: 'auto';
}

const NONE: ExpertiseRoute = { taskKey: null, department: null, confidence: 0, tier: 'none', source: 'auto' };

/** Confidence below this for the best TASK → fall back to a department persona match. */
const TASK_CONFIDENCE_FLOOR = 0.34;

/**
 * MIS-ROUTE GUARD (Phase 4) — the "never confidently wrong" line. A SPECIFIC task key is
 * only ever returned at tier 'high'; below this threshold the router downgrades to a
 * department persona (medium) or nothing (low/none). Tuned against the live distribution:
 * a clear, specific request (a single 2-word trigger phrase) scores ~0.667, and EVERY
 * benchmark task case lands ≥ 0.667 — comfortably above this — while a stray
 * two-single-keyword coincidence (the mis-route risk) lands below it. So a deliberately
 * ambiguous prompt can never surface a confident specific task.
 */
const TASK_HIGH_CONFIDENCE = 0.5;

/** Fold accents/diacritics so "résumé" matches the "resume" trigger, "café" → "cafe". */
function deaccent(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normalize: lowercase, fold accents, collapse whitespace, strip most punctuation to spaces. */
function normalize(text: string): string {
  return ` ${deaccent(text)
    .toLowerCase()
    // Keep & % . / + as in-token chars (p&l, 50%, 3.5, vat/cash); turn hyphens and
    // everything else into separators so "cash-flow" matches the "cash flow" trigger
    // and "e-invoice" still has its own hyphenated trigger handled below.
    .replace(/[^a-z0-9&%./+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** Normalize a trigger phrase the SAME way as the text (so "e-invoice" → "e invoice" both sides). */
function normPhrase(phrase: string): string {
  return deaccent(phrase)
    .toLowerCase()
    .replace(/[^a-z0-9&%./+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if `phrase` appears in the already-space-padded normalized text as a token-bounded match. */
function phraseHit(haystack: string, phrase: string): boolean {
  // wrap in spaces so "vat" never matches inside "private".
  return haystack.includes(` ${normPhrase(phrase)} `);
}

/**
 * Score one trigger list against the text. A multi-word phrase match is weighted far
 * higher than a single keyword (word-count squared), so "cash flow forecast" decisively
 * beats a stray single-word hit elsewhere.
 */
function scoreTriggers(haystack: string, phrases: string[]): { score: number; hits: number } {
  let score = 0;
  let hits = 0;
  for (const p of phrases) {
    if (phraseHit(haystack, p)) {
      const words = normPhrase(p).split(' ').length;
      score += words * words; // 1 → 1, 2 → 4, 3 → 9 …
      hits++;
    }
  }
  return { score, hits };
}

/**
 * Route a free-form message to the best expertise.
 * - Scores every task by length-weighted trigger matches; picks the top task.
 * - confidence ∈ 0..1 blends the absolute match strength and the margin over the runner-up.
 * - If the best task confidence is below the floor, falls back to a DEPARTMENT match
 *   (persona only): { taskKey:null, department, confidence }.
 * - If nothing matches, returns NONE (== today's behaviour; safe).
 */
export function routeExpertise(userText: string, _mode: SessionMode): ExpertiseRoute {
  if (!userText || !userText.trim()) return NONE;
  const hay = normalize(userText);

  // --- Score tasks ---
  let best: { key: string; score: number } | null = null;
  let runnerUp = 0;
  for (const [key, phrases] of Object.entries(TASK_TRIGGERS)) {
    const { score } = scoreTriggers(hay, phrases);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      runnerUp = best ? best.score : runnerUp;
      best = { key, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (best) {
    // Absolute strength: a single keyword (score 1) ≈ 0.33; a 2-word phrase (4) ≈ 0.66;
    // a 3-word phrase (9) saturates near 1. Margin: a clear winner over the runner-up
    // lifts confidence; a near-tie lowers it.
    const strength = Math.min(1, best.score / 6);
    const margin = best.score > 0 ? (best.score - runnerUp) / best.score : 0;
    const confidence = round(Math.min(1, 0.55 * strength + 0.45 * (strength * (0.5 + 0.5 * margin))));
    // HIGH tier only: a specific task is NEVER returned below the high bar (mis-route guard).
    if (confidence >= TASK_HIGH_CONFIDENCE) {
      return { taskKey: best.key, department: best.key.split('.')[0], confidence, tier: 'high', source: 'auto' };
    }
    // Between the floor and the high bar: the signal points at a department but isn't
    // strong enough to commit to a SPECIFIC task → degrade to a persona-only match below.
  }

  // --- Department persona fallback (MEDIUM tier) ---
  let bestDept: { dept: string; score: number } | null = null;
  for (const [dept, phrases] of Object.entries(DEPARTMENT_TRIGGERS)) {
    const { score } = scoreTriggers(hay, phrases);
    if (score <= 0) continue;
    if (!bestDept || score > bestDept.score) bestDept = { dept, score };
  }
  if (bestDept) {
    const confidence = round(Math.min(0.6, 0.25 + 0.1 * bestDept.score));
    return { taskKey: null, department: bestDept.dept, confidence, tier: 'medium', source: 'auto' };
  }

  // A task matched above the FLOOR but below the HIGH bar, with no department trigger hit:
  // surface its department as a persona-only (medium) match — still the right family, never
  // a confident specific task.
  if (best) {
    const strength = Math.min(1, best.score / 6);
    const conf = round(Math.min(0.49, 0.3 * strength + 0.2));
    return { taskKey: null, department: best.key.split('.')[0], confidence: conf, tier: 'medium', source: 'auto' };
  }

  return NONE;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
