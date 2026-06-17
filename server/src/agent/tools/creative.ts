import { config } from '../../config';
import { composeCreative, CREATIVE_SIZES, type Zone } from '../creative';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * Marketing creative generator. Produces a finished, ready-to-post IMAGE (PNG/JPEG) with
 * AI-generated on-brand imagery AND pixel-crisp typography — the workaround for image
 * models being unable to render text: the model makes a text-free background with reserved
 * negative space, M3 vision finds the clean zone, and the headline/subhead/CTA (+ optional
 * uploaded logo) are composited as real type. Gated on the MiniMax key.
 */
export const generateCreativeTool: ToolDef = {
  name: 'generate_creative',
  description:
    'Create a finished marketing creative as a single ready-to-use IMAGE (PNG or JPEG): an AI-generated, ' +
    'on-brand background with crisp, perfectly-legible headline/subhead/button text laid on top (and the ' +
    "user's logo if they uploaded one). Use this for ads, social posts, hero/banner images, and OG images — " +
    'NOT generate_image, because image models cannot render text reliably; this composites real type so it is always sharp. ' +
    'SPLIT THE BRIEF — this is the #1 thing to get right: `prompt` is ONLY the imagery (scene, subject, style, mood, palette, NO text/words/letters in it); put ALL the wording in the SEPARATE fields `headline` / `subhead` / `bullets` / `cta` / `kicker`. ' +
    'Example call: {"prompt":"bright photorealistic London travel scene — a happy couple, Big Ben, the London Eye, a red double-decker bus, clean empty negative space, premium","headline":"UK Tourist Visa","subhead":"Fast & accurate processing","bullets":["Quick turnaround","Correct documentation","Embassy-ready files"],"accent":"#C8102E","aspect_ratio":"1:1","logo_placeholder":true}. ' +
    'It picks the best text placement automatically, saves to images/, and offers a download; make one per channel size (1:1 / 4:5 / 9:16 / 16:9 / 1.91:1). ' +
    'BRAND FIRST: if the user has not given a logo, ASK them to upload one and pass its path — or set logo_placeholder. ' +
    'SOCIAL conversion: a benefit/outcome headline (value in the first few words), a short check-marked benefit list, proof/specifics only where true, and a single clear CTA.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The IMAGERY ONLY — scene, subject, style, mood, brand palette. NEVER put any text/words/letters here (they go in headline/subhead/bullets/cta).' },
      headline: { type: 'string', description: 'The main headline text (use \\n for a line break). Strongly recommended — this is the composited text.' },
      subhead: { type: 'string', description: 'Optional supporting line.' },
      bullets: { type: 'array', items: { type: 'string' }, description: 'Optional feature/benefit list — each rendered with a check mark (e.g. ["Quick turnaround","Embassy-ready files"]).' },
      cta: { type: 'string', description: 'Optional call-to-action button label, e.g. "Shop now →".' },
      kicker: { type: 'string', description: 'Optional small eyebrow/label above the headline, e.g. "NEW · SUMMER".' },
      aspect_ratio: { type: 'string', enum: Object.keys(CREATIVE_SIZES), description: '1:1 (square), 4:5 (portrait feed), 9:16 (story/reel), 16:9 (wide/hero), 1.91:1 (link/OG). Default 1:1.' },
      accent: { type: 'string', description: 'Brand accent colour as a hex (e.g. "#c0502f") for the CTA/eyebrow/checks. Defaults to the project/brand accent.' },
      logo: { type: 'string', description: "Workspace path to a logo the user uploaded (e.g. \"uploads/logo.png\") to place in the top-left corner. Optional." },
      logo_placeholder: { type: 'boolean', description: 'If true and no logo is given, draw a tasteful "LOGO" placeholder in the top-left corner so there is a clear spot for the brand. Default false.' },
      text_color: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'Force the text colour, or "auto" (default) to let vision choose for contrast.' },
      format: { type: 'string', enum: ['png', 'jpeg'], description: 'Output image format (default png).' },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  available: () => !!config.minimaxApiKey,
  summarize: (a) => `creative: ${String(a.headline ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    // Accept the field names a model naturally reaches for (it often sends `imagery_prompt`),
    // and DON'T hard-fail on a missing headline — produce the image regardless.
    const prompt = String(args.prompt ?? args.imagery_prompt ?? args.image_prompt ?? args.scene ?? '').trim();
    const headline = String(args.headline ?? args.title ?? args.heading ?? '').trim();
    if (!prompt) {
      return (
        'Error: generate_creative needs an imagery `prompt` (the scene/style ONLY — never any text/words in it), ' +
        'and the copy in SEPARATE fields. Example call: {"prompt":"bright photorealistic London travel scene with Big Ben, ' +
        'the London Eye and a red double-decker bus, clean empty negative space, premium","headline":"UK Tourist Visa",' +
        '"subhead":"Fast & accurate processing","bullets":["Quick turnaround","Correct documentation","Embassy-ready files"],' +
        '"accent":"#C8102E","aspect_ratio":"1:1","logo_placeholder":true}. Retry with the copy split out like that.'
      );
    }
    const aspect = CREATIVE_SIZES[String(args.aspect_ratio)] ? String(args.aspect_ratio) : '1:1';
    const accent = /^#[0-9a-fA-F]{3,8}$/.test(String(args.accent ?? '')) ? String(args.accent) : '#1f5f8b';
    const format = args.format === 'jpeg' ? 'jpeg' : 'png';
    const textColor = ['light', 'dark'].includes(String(args.text_color)) ? (String(args.text_color) as 'light' | 'dark') : 'auto';
    const zone: Zone | 'auto' = 'auto';

    let logoAbsPath: string | null = null;
    if (args.logo) {
      try {
        logoAbsPath = resolveInWorkspace(ctx.repoDir, String(args.logo));
      } catch {
        return `Error: the logo path ${args.logo} is outside the workspace.`;
      }
    }

    const bullets = Array.isArray(args.bullets) ? args.bullets.map((b: any) => String(b)).filter(Boolean).slice(0, 6) : undefined;
    const r = await composeCreative(
      {
        prompt,
        aspect,
        format,
        textColor,
        zone,
        logoAbsPath,
        logoPlaceholder: !!args.logo_placeholder,
        copy: { accent, kicker: args.kicker ? String(args.kicker) : undefined, headline, sub: args.subhead ? String(args.subhead) : undefined, bullets, cta: args.cta ? String(args.cta) : undefined },
      },
      ctx.repoDir,
      ctx.signal,
    );
    if (r.costUsd) ctx.addCost(r.costUsd);
    if (!r.ok) return `Error: creative generation failed — ${r.error}`;
    return `Created ${r.files.map((f) => f.path).join(', ')} (${r.notes}). Saved in the workspace images/ folder and offered as a download.`;
  },
};
