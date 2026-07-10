import { composeCreative } from '../creative';
import type { CampaignBrief, PoolCreative } from '../../robots/socialCampaigns';

/**
 * Campaign bot — the CREATIVE POOL orchestrator. Turns a brief into ~30 finished image
 * creatives across mobile (4:5, 9:16) + web (1:1, 1.91:1) formats by looping composeCreative,
 * exploiting its `headlineVariants` batch pattern: each generated BACKGROUND carries up to 3
 * composited headline variants as FREE re-renders (one image-gen cost buys three creatives).
 *
 * Planning is pure + unit-tested (`planCreativeBatch`): topics × hook archetypes × format
 * rotation → background specs, each with 3 archetype-diverse headlines. Execution is
 * budget-capped (`maxUsd`) so autopilot can never burn unbounded generation spend — when the
 * cap trips, we return what's done + how many specs were skipped (no silent truncation).
 *
 * VIDEO creatives are NOT generated here: the motion/story video tools need agent-authored
 * scenes and serialize through the global render slot — the setup loop routes video production
 * through an agent task and appends the results to the same pool.
 */

export type HookArchetype = 'question' | 'benefit' | 'proof' | 'offer' | 'urgency';
export const HOOK_ARCHETYPES: HookArchetype[] = ['question', 'benefit', 'proof', 'offer', 'urgency'];

/** Pure: a punchy template headline per archetype (the LLM may refine later; these always work). */
export function hookHeadline(archetype: HookArchetype, product: string, topic: string): string {
  const t = topic.trim() || product.trim();
  switch (archetype) {
    case 'question': return `Still putting up with ${t.toLowerCase()}?`;
    case 'benefit': return `${t} — done for you`;
    case 'proof': return `Why hundreds choose ${product}`;
    case 'offer': return `${product}: your ${t.toLowerCase()}, sorted`;
    case 'urgency': return `Don't wait on ${t.toLowerCase()}`;
  }
}

/** Mobile-first + web format rotation (Meta placements cover both from these four). */
export const BATCH_FORMATS = ['4:5', '9:16', '1:1', '1.91:1'] as const;

export interface BatchSpec {
  /** Text-free imagery prompt for the background. */
  prompt: string;
  aspect: string;
  headlines: string[]; // ≤3 — composited as free variants on one background
  body: string;
  cta?: string;
  topic: string;
}

/** Pure: plan the background specs for ~imageCount finished creatives (3 variants each). */
export function planCreativeBatch(brief: CampaignBrief, imageCount: number): BatchSpec[] {
  const topics = brief.topics.length ? brief.topics : [brief.product];
  const product = brief.product;
  const backgrounds = Math.max(1, Math.ceil(Math.min(50, Math.max(1, imageCount)) / 3));
  const specs: BatchSpec[] = [];
  for (let i = 0; i < backgrounds; i++) {
    const topic = topics[i % topics.length];
    // 3 archetype-diverse headlines per background, rotating the starting archetype.
    const heads = [0, 1, 2].map((k) => hookHeadline(HOOK_ARCHETYPES[(i + k) % HOOK_ARCHETYPES.length], product, topic));
    specs.push({
      prompt:
        `${product} — ${topic}. Professional advertising photography, premium and modern, ` +
        `generous clean negative space for text, no words or lettering anywhere in the image.`,
      aspect: BATCH_FORMATS[i % BATCH_FORMATS.length],
      headlines: heads,
      body: `${product}: ${topic}.`,
      cta: brief.cta,
      topic,
    });
  }
  return specs;
}

/** ≈ cost per background call (1–2 image gens + 3–4 vision calls); variants are free. */
export const EST_COST_PER_BACKGROUND_USD = 0.09;

export function estimateBatchCostUsd(specs: BatchSpec[]): number {
  return Math.round(specs.length * EST_COST_PER_BACKGROUND_USD * 100) / 100;
}

export interface BatchOutcome {
  pool: PoolCreative[];
  spentUsd: number;
  generatedBackgrounds: number;
  skippedSpecs: number;
  errors: string[];
}

/** Execute the plan: loop composeCreative under a hard generation-spend cap. */
export async function generateImagePool(
  brief: CampaignBrief,
  imageCount: number,
  repoDir: string,
  signal: AbortSignal,
  opts: { maxUsd: number; accent?: string; logoAbsPath?: string | null; onProgress?: (done: number, total: number) => void },
): Promise<BatchOutcome> {
  const specs = planCreativeBatch(brief, imageCount);
  const out: BatchOutcome = { pool: [], spentUsd: 0, generatedBackgrounds: 0, skippedSpecs: 0, errors: [] };
  for (let i = 0; i < specs.length; i++) {
    if (signal.aborted) { out.skippedSpecs = specs.length - i; break; }
    // Hard cap: stop BEFORE a call that could exceed the generation budget.
    if (out.spentUsd + EST_COST_PER_BACKGROUND_USD > opts.maxUsd) {
      out.skippedSpecs = specs.length - i;
      out.errors.push(`generation cap $${opts.maxUsd} reached — ${specs.length - i} background(s) skipped`);
      break;
    }
    const spec = specs[i];
    try {
      const r = await composeCreative(
        {
          prompt: spec.prompt,
          aspect: spec.aspect,
          copy: { headline: spec.headlines[0], sub: spec.body, cta: spec.cta, accent: opts.accent || '#1f5f8b' },
          format: 'jpeg',
          textColor: 'auto',
          zone: 'auto',
          logoAbsPath: opts.logoAbsPath ?? null,
          headlineVariants: spec.headlines.slice(1),
        },
        repoDir,
        signal,
      );
      out.spentUsd += r.costUsd;
      if (r.ok && r.files.length) {
        out.generatedBackgrounds++;
        r.files.forEach((f, idx) => {
          out.pool.push({
            ref: f.path,
            type: 'image',
            format: spec.aspect,
            headline: spec.headlines[Math.min(idx, spec.headlines.length - 1)],
            body: spec.body,
          });
        });
      } else if (r.error) {
        out.errors.push(`bg ${i + 1}: ${r.error}`);
      }
    } catch (e: any) {
      out.errors.push(`bg ${i + 1}: ${e?.message ?? e}`);
    }
    opts.onProgress?.(i + 1, specs.length);
  }
  out.spentUsd = Math.round(out.spentUsd * 100) / 100;
  return out;
}
