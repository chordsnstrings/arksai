import { config } from '../../config';
import { composeLogo, type LogoInput } from '../logo';
import type { ToolDef } from './common';

/**
 * generate_logo — a real logo + brand-identity generator. Produces a distinctive vector mark
 * (M3 at its ceiling: real font glyphs + overlapping primitives, NEVER morphing), then a full
 * designer submission: a brand directive + palette, light & dark variants, app/website
 * placements, and a zipped multi-format kit (SVG + PNG + JPEG at several sizes, light & dark).
 * See LOGO_PLAN.md. Gated (with a clear message) on the MiniMax key.
 */
export const generateLogoTool: ToolDef = {
  name: 'generate_logo',
  description:
    'Design a complete, professional LOGO and brand identity, delivered as a real designer submission. ' +
    'It writes a brand directive (concept rationale + colour palette + typography), generates a distinctive ' +
    'vector mark (clean — real fonts for any letters, overlapping geometric shapes for any symbol, never warped), ' +
    'auto-picks its own strongest of several drafts, polishes it, and produces LIGHT & DARK variants, an app-icon ' +
    'and website placement, and a ZIPPED kit with SVG + PNG + JPEG at multiple sizes on light & dark backgrounds. ' +
    'Use this whenever the user wants a logo / brand mark / visual identity (NOT generate_creative, which is for ad/social posts). ' +
    'INTAKE FIRST: before calling, ask the user (one short round) for the brand name + what it does, 1-3 concept ' +
    'directions to explore (or let it propose), a colour preference (or "you choose"), and the vibe. ' +
    'Then call it; it returns a downloadable kit + a brand sheet that opens in the canvas.',
  parameters: {
    type: 'object',
    properties: {
      brand_name: { type: 'string', description: 'The brand/company/product name as it should appear.' },
      brand_description: { type: 'string', description: 'What the brand is/does, its industry and personality (one or two sentences). Grounds the concept.' },
      directions: { type: 'array', items: { type: 'string' }, description: 'Optional 1-3 concept directions to explore, e.g. ["a compass", "a wave", "monogram A"]. Omit to let the designer propose the strongest idea.' },
      palette: { type: 'string', description: 'Optional colour preference — names ("navy and gold") or hexes ("#0A2540, #C9A24B"). Omit to let it choose a fitting palette.' },
      vibe: { type: 'string', description: 'Optional desired personality, e.g. "premium, editorial, trustworthy" or "playful, friendly".' },
      route: { type: 'string', enum: ['auto', 'concept', 'lettermark'], description: 'auto (default) lets it choose; concept = a pictorial shape mark; lettermark = a type-led mark.' },
      candidates: { type: 'number', description: 'How many drafts to generate before picking the best (default 3, max 5). More = better pick but slower.' },
    },
    required: ['brand_name', 'brand_description'],
  },
  modes: ['chat', 'code'],
  // Always present + a clear config error when unkeyed (same pattern as generate_creative) so
  // the heavily-steered model never misreads an "unknown tool" as "logos unavailable".
  available: () => true,
  summarize: (a) => `logo: ${String(a.brand_name ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    if (!config.minimaxApiKey) {
      return (
        'Logo generation needs the image/LLM engine, which is not switched on for this server yet — the ' +
        'MINIMAX_API_KEY is not configured. Do NOT retry, do NOT switch to code, and do NOT hand-build an SVG. ' +
        'Tell the user: "Logo generation isn\'t enabled on this workspace yet — the operator needs to add the ' +
        'MiniMax API key (a MiniMax sk-cp Subscription key) to the server."'
      );
    }
    const brandName = String(args.brand_name ?? args.brand ?? args.name ?? '').trim();
    const brandDescription = String(args.brand_description ?? args.description ?? args.about ?? '').trim();
    if (!brandName) {
      return 'generate_logo needs a brand_name. Ask the user for the brand name (and what it does), then call generate_logo again.';
    }
    const input: LogoInput = {
      brandName,
      brandDescription: brandDescription || `${brandName}`,
      directions: Array.isArray(args.directions) ? args.directions.map((d: any) => String(d)).filter(Boolean).slice(0, 4) : undefined,
      paletteHint: args.palette ? String(args.palette) : undefined,
      vibe: args.vibe ? String(args.vibe) : undefined,
      route: ['auto', 'concept', 'lettermark'].includes(String(args.route)) ? (String(args.route) as any) : 'auto',
      candidates: Number.isFinite(Number(args.candidates)) ? Number(args.candidates) : undefined,
    };

    const r = await composeLogo(input, ctx.repoDir, ctx.signal);
    if (r.costUsd) ctx.addCost(r.costUsd);
    if (!r.ok) {
      return (
        `generate_logo could not finish this time: ${r.error}. This is a transient/service issue, NOT a missing ` +
        `tool — do NOT switch to code mode or hand-build an SVG. Try generate_logo AGAIN; if it still fails, report ` +
        `this exact error to the user.`
      );
    }
    const d = r.directive!;
    const palette = d.palette.map((p) => `${p.name} ${p.hex}`).join(', ');
    const files = [r.zipPath, r.brandSheetPath, r.heroPath].filter(Boolean).join(', ');
    return (
      `Designed the "${d.brandName}" identity. Concept: ${d.concept} ` +
      `Palette: ${palette}. Typeface: ${d.typography.display}. (${r.notes}) ` +
      `Delivered: ${files} — the ZIP holds SVG + PNG + JPEG at multiple sizes on light & dark backgrounds, ` +
      `app-icon, favicon, website placement, and a brand-directive. The brand sheet opens in the canvas. ` +
      `Tell the user it's ready, summarize the concept + palette in one line, and offer to tweak colours/typeface or explore another direction.`
    );
  },
};
