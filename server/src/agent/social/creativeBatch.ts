import { composeCreative } from '../creative';
import type { CampaignBrief, PoolCreative } from '../../robots/socialCampaigns';
import { gateCopyBatch, type CopyFacts } from './copyCheck';
import { verticalById, type AdFrame, type VisualStyle } from './verticals';

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

/** Pure: a punchy template headline per archetype (the LLM may refine later; these always work).
 *  TRUTHFUL SCARCITY: the 'urgency' archetype speaks urgency ONLY when the brief carries a
 *  grounded fact (a real end date / a real limited count) — otherwise it degrades to a plain
 *  benefit line. Invented urgency never ships (copyCheck enforces the same rule downstream). */
export function hookHeadline(
  archetype: HookArchetype,
  product: string,
  topic: string,
  facts?: Pick<CopyFacts, 'offerEndsAt' | 'limitedCount' | 'limitedUnit'>,
): string {
  const t = topic.trim() || product.trim();
  switch (archetype) {
    case 'question': return `Still putting up with ${t.toLowerCase()}?`;
    case 'benefit': return `${t} — done for you`;
    case 'proof': return `Why hundreds choose ${product}`;
    case 'offer': return `${product}: your ${t.toLowerCase()}, sorted`;
    case 'urgency': {
      if (facts?.limitedCount && facts.limitedCount > 0) {
        return `Only ${facts.limitedCount} ${facts.limitedUnit || 'spots'} left — ${t.toLowerCase()}`;
      }
      if (facts?.offerEndsAt && facts.offerEndsAt > 0) {
        const day = new Date(facts.offerEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `Offer ends ${day} — ${t.toLowerCase()}`;
      }
      return `${t}, handled this week`; // no grounded fact → zero urgency language
    }
  }
}

/** The brief's grounded facts + vertical flags, in the copy gate's shape. */
export function copyFactsOf(brief: CampaignBrief): CopyFacts {
  return {
    offerEndsAt: brief.offerEndsAt ?? null,
    limitedCount: brief.limitedCount ?? null,
    limitedUnit: brief.limitedUnit ?? null,
    healthRules: !!verticalById(brief.vertical).compliance.healthRules,
  };
}

// ── The vertical-tuned copy engine (CAMPAIGN_CRAFT §4 encoded) ─────────────────────────────

/** Archetype weights per visual style, from the 550k-ad winner data: offer/price-led hooks
 *  surface winners most (9.3% vs 6.2% story vs 5.5% question) — weighted UP for playful
 *  verticals (ecomm/F&B, spontaneous intent); credibility verticals (dental/legal/finance)
 *  lead with proof; demonstration verticals lead with the concrete benefit. Urgency only
 *  earns weight when the brief carries a grounded fact. Expert override: robot config
 *  `hookWeights` replaces the table wholesale. */
export const HOOK_WEIGHTS: Record<VisualStyle, Record<HookArchetype, number>> = {
  playful: { offer: 3, benefit: 2, urgency: 2, question: 1, proof: 1 },
  credibility: { proof: 3, benefit: 2, offer: 2, question: 1, urgency: 1 },
  demo: { benefit: 3, offer: 2, proof: 2, question: 1, urgency: 1 },
};

/** Deterministic weighted archetype cycle (largest-weight-first interleave, no RNG). */
export function archetypeCycle(
  style: VisualStyle,
  opts: { grounded?: boolean; override?: Partial<Record<HookArchetype, number>> } = {},
): HookArchetype[] {
  const base = { ...HOOK_WEIGHTS[style], ...(opts.override ?? {}) };
  if (!opts.grounded) base.urgency = 0; // no grounded fact → urgency earns no slots at all
  const cycle: HookArchetype[] = [];
  const remaining = { ...base };
  while (Object.values(remaining).some((w) => w > 0)) {
    for (const a of HOOK_ARCHETYPES) {
      if ((remaining[a] ?? 0) > 0) { cycle.push(a); remaining[a] = (remaining[a] ?? 0) - 1; }
    }
  }
  return cycle.length ? cycle : ['benefit', 'offer', 'proof'];
}

/** Structural body shapes — the pool tests structurally DIFFERENT messages, not five
 *  rewordings of one (PAS/JTBD/etc. are diversity scaffolds, never jargon shown to users). */
export type CopyShape = 'offer_first' | 'pas' | 'jtbd' | 'proof';
export const COPY_SHAPES: CopyShape[] = ['offer_first', 'pas', 'jtbd', 'proof'];

export function bodyShape(shape: CopyShape, product: string, topic: string, frame: AdFrame, cta?: string): string {
  const t = topic.trim() || product.trim();
  const act = cta?.trim() || 'Get in touch today.';
  switch (shape) {
    case 'offer_first': return `${t} — by ${product}. ${act}`;
    case 'pas':
      return frame === 'loss'
        ? `${t} is too important to leave to chance. ${product} handles it properly. ${act}`
        : `${t} shouldn't be this hard. ${product} makes it simple. ${act}`;
    case 'jtbd': return `When you need ${t.toLowerCase()}, ${product} gets it done. ${act}`;
    case 'proof': return `People keep coming back to ${product} for ${t.toLowerCase()}. ${act}`;
  }
}

/** Imagery prompt per visual style + THE GAZE RULE (eye-tracking + a Facebook field study:
 *  an averted gaze toward the product lifts attention AND message memory vs direct-to-camera).
 *  Every 3rd background goes casual phone-shot style when the UGC mix is on (low-production
 *  text-forward assets out-test polished ones at scale). */
export function imageryPrompt(style: VisualStyle, product: string, topic: string, opts: { casual?: boolean } = {}): string {
  const base = `${product} — ${topic}.`;
  const look = opts.casual
    ? 'Casual smartphone photo style, natural light, authentic and unposed, slightly imperfect framing'
    : style === 'playful'
      ? 'Vibrant lifestyle advertising photography, playful energy, culturally fluent, warm colour'
      : style === 'credibility'
        ? 'Clean professional environment, calm and credible, editorial-quality light'
        : 'The product or service shown IN USE, process visible, real-world setting, demonstrative';
  return (
    `${base} ${look}, generous clean negative space for text, no words or lettering anywhere in the image. ` +
    `If a person appears, their gaze is toward the product or scene — never directly at the camera.`
  );
}

/** Plain-language angle label per archetype (the review panel never says "archetype"). */
export const ANGLE_LABEL: Record<HookArchetype, string> = {
  offer: 'Offer-first', proof: 'Proof', question: 'Question', benefit: 'Benefit', urgency: 'Deadline',
};

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

export interface PlanOptions {
  /** Robot-level Ad voice ('auto' resolves from the vertical's visual style). */
  voice?: VisualStyle | 'auto';
  /** Mix in casual phone-shot-style backgrounds (default ON — they out-test polished). */
  casualMix?: boolean;
  /** Expert overrides (robot config keys — no UI): hook weights + emotional frame. */
  hookWeights?: Partial<Record<HookArchetype, number>>;
  frame?: AdFrame;
}

export interface CopySample { headline: string; body: string; angle: string }

/** Pure: plan the background specs for ~imageCount finished creatives (3 variants each),
 *  tuned by the brief's vertical: weighted hook archetypes, structural copy shapes, styled
 *  imagery prompts + the gaze rule, optional casual (UGC-style) mix. Every headline+body
 *  passes the deterministic copy gate BEFORE it can be composited — hard failures are
 *  rewritten to a safe benefit line and counted (`qc` on the outcome). */
export function planCreativeBatch(
  brief: CampaignBrief,
  imageCount: number,
  opts: PlanOptions = {},
): { specs: BatchSpec[]; qc: { checksRun: number; draftsRejected: number }; samples: CopySample[] } {
  const topics = brief.topics.length ? brief.topics : [brief.product];
  const product = brief.product;
  const facts = copyFactsOf(brief);
  const profile = verticalById(brief.vertical);
  const style: VisualStyle = opts.voice && opts.voice !== 'auto' ? opts.voice : profile.visualStyle;
  const frame: AdFrame = opts.frame ?? profile.frame;
  const casualMix = opts.casualMix !== false;
  const grounded = !!((facts.offerEndsAt && facts.offerEndsAt > 0) || (facts.limitedCount && facts.limitedCount > 0));
  const cycle = archetypeCycle(style, { grounded, override: opts.hookWeights });
  const backgrounds = Math.max(1, Math.ceil(Math.min(50, Math.max(1, imageCount)) / 3));
  const specs: BatchSpec[] = [];
  const samples: CopySample[] = [];
  const sampleAngles = new Set<string>();
  let checksRun = 0;
  let draftsRejected = 0;
  for (let i = 0; i < backgrounds; i++) {
    const topic = topics[i % topics.length];
    // 3 archetype-diverse headlines per background from the vertical-weighted cycle.
    const picks: HookArchetype[] = [];
    for (let k = 0; picks.length < 3 && k < cycle.length * 2; k++) {
      const a = cycle[(i + k) % cycle.length];
      if (!picks.includes(a)) picks.push(a);
    }
    while (picks.length < 3) picks.push('benefit');
    const rawHeads = picks.map((a) => ({ archetype: a, headline: hookHeadline(a, product, topic, facts) }));
    const body = bodyShape(COPY_SHAPES[i % COPY_SHAPES.length], product, topic, frame, brief.cta);
    const gated = gateCopyBatch(
      rawHeads.map((h) => ({ headline: h.headline, body, archetype: h.archetype })),
      facts,
      (item) => ({ ...item, headline: hookHeadline('benefit', product, topic), archetype: 'benefit' as HookArchetype }),
    );
    checksRun += gated.checksRun;
    draftsRejected += gated.draftsRejected;
    const seen = new Set<string>();
    const kept = gated.items.filter((g) => !seen.has(g.headline) && seen.add(g.headline));
    if (!kept.length) kept.push({ headline: hookHeadline('benefit', product, topic), body, archetype: 'benefit' });
    // Review-panel samples: first occurrence of up to 3 DISTINCT angles across the pool.
    for (const g of kept) {
      const angle = ANGLE_LABEL[(g as any).archetype as HookArchetype] ?? 'Benefit';
      if (samples.length < 3 && !sampleAngles.has(angle)) {
        sampleAngles.add(angle);
        samples.push({ headline: g.headline, body, angle });
      }
    }
    specs.push({
      prompt: imageryPrompt(style, product, topic, { casual: casualMix && i % 3 === 2 }),
      aspect: BATCH_FORMATS[i % BATCH_FORMATS.length],
      headlines: kept.slice(0, 3).map((g) => g.headline),
      body,
      cta: brief.cta,
      topic,
    });
  }
  return { specs, qc: { checksRun, draftsRejected }, samples };
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
  /** Copy-gate trust counters — surfaced as the review panel's honesty line. */
  qc: { checksRun: number; draftsRejected: number };
  /** Up to 3 distinct-angle copy samples for the review panel. */
  samples: CopySample[];
}

/** Execute the plan: loop composeCreative under a hard generation-spend cap. */
export async function generateImagePool(
  brief: CampaignBrief,
  imageCount: number,
  repoDir: string,
  signal: AbortSignal,
  opts: { maxUsd: number; accent?: string; logoAbsPath?: string | null; onProgress?: (done: number, total: number) => void; plan?: PlanOptions },
): Promise<BatchOutcome> {
  const { specs, qc, samples } = planCreativeBatch(brief, imageCount, opts.plan ?? {});
  const out: BatchOutcome = { pool: [], spentUsd: 0, generatedBackgrounds: 0, skippedSpecs: 0, errors: [], qc, samples };
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
