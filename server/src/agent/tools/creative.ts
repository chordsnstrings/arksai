import { config } from '../../config';
import { composeCreative, CREATIVE_SIZES, type Zone } from '../creative';
import { resolveInWorkspace, type ToolDef } from './common';

// Field names a model reaches for to describe the imagery, in priority order.
const PROMPT_ALIASES = [
  'prompt', 'imagery_prompt', 'image_prompt', 'style_prompt', 'design_prompt',
  'visual_prompt', 'creative_prompt', 'background_prompt', 'scene', 'description', 'brief',
];
// Args that are definitely NOT the imagery prompt (so the fallback never grabs them).
const NON_PROMPT = new Set([
  'aspect_ratio', 'aspect', 'accent', 'format', 'logo', 'logo_placeholder', 'text_color',
  'creative_name', 'name', 'headline', 'title', 'heading', 'subhead', 'cta', 'kicker', 'bullets',
]);

/**
 * Resolve the imagery prompt from whatever field the model used. Pure + exported for tests.
 * Models keep inventing field names (imagery_prompt → style_prompt → …) and a strict
 * required-field check then rejects the call in 0.0s — surfacing as "image generation doesn't
 * work". So accept every common alias AND, as a last resort, take the longest string arg that
 * isn't a known non-prompt field. A renamed field can no longer hard-fail the tool.
 */
export function resolveCreativePrompt(args: Record<string, any>): string {
  for (const k of PROMPT_ALIASES) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  let best = '';
  for (const [k, v] of Object.entries(args)) {
    if (NON_PROMPT.has(k)) continue;
    if (typeof v === 'string' && v.trim().length > best.length) best = v.trim();
  }
  return best;
}

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
  // ALWAYS in the toolset (not gated on the key). When the key is missing we return a CLEAR
  // config error below — otherwise the heavily-steered model calls a tool that isn't there,
  // gets an instant "unknown tool" reject, and misreads it as "image generation unavailable"
  // → wrongly builds a CSS/SVG graphic. Presence + a precise error is far better UX.
  available: () => true,
  summarize: (a) => `creative: ${String(a.headline ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    if (!config.minimaxApiKey) {
      return (
        'Image generation is not switched on for this server yet — the MINIMAX_API_KEY is not configured. ' +
        'Do NOT retry, do NOT switch to code, do NOT build a CSS/SVG graphic, and do NOT web-search a photo. ' +
        'Tell the user plainly: "Image generation isn\'t enabled on this workspace yet — the operator needs to ' +
        'add the MiniMax API key (a MiniMax sk-cp Subscription key) to the server." That is the only fix.'
      );
    }
    // Resolve the imagery from whatever field the model used (never hard-fails on a rename).
    let prompt = resolveCreativePrompt(args);
    const headline = String(args.headline ?? args.title ?? args.heading ?? '').trim();
    const subhead = String(args.subhead ?? '').trim();
    // NEVER hard-fail when the model gave copy but forgot the imagery `prompt` — that 0.0s
    // error gets misread by the model as "I don't have image tools" → it wrongly falls back to
    // HTML/CSS. Instead synthesize a tasteful on-brand background from the copy so the tool
    // ALWAYS produces an image; the steering pushes the model to pass the real scene for a
    // better result. Only error if there's genuinely nothing (no imagery AND no copy).
    if (!prompt) {
      const topic = [headline, subhead].filter(Boolean).join(' — ');
      if (topic) {
        prompt = `A premium, modern, photographic on-brand background image for a marketing creative about "${topic}" — clean editorial composition with generous empty negative space for overlaid text, high-end advertising, NO text/words/letters in the image`;
      } else {
        return (
          'generate_creative IS available and working — this call was just missing BOTH the imagery ' +
          'and the copy. Call it AGAIN (do not switch modes or build HTML) with a `prompt` describing ' +
          'the SCENE (subject, setting, style) and the wording in headline/subhead/bullets/cta. ' +
          'Example: {"prompt":"bright photorealistic London travel scene with Big Ben and a red bus, ' +
          'clean empty negative space, premium","headline":"UK Tourist Visa","subhead":"Fast & accurate ' +
          'processing","aspect_ratio":"1:1","logo_placeholder":true}.'
        );
      }
    }
    const aspectIn = String(args.aspect_ratio ?? args.aspect ?? '1:1');
    const aspect = CREATIVE_SIZES[aspectIn] ? aspectIn : '1:1';
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
    if (!r.ok)
      return (
        `generate_creative could not render this time: ${r.error}. This is a transient or service/config ` +
        `issue, NOT a missing tool — do NOT switch to code mode, do NOT build an HTML/CSS/SVG graphic, and do NOT ` +
        `tell the user image generation is unavailable. Try generate_creative AGAIN (adjust the prompt/params if ` +
        `needed). If it STILL fails after a retry, report this exact error to the user so the image service can be checked.`
      );
    return `Created ${r.files.map((f) => f.path).join(', ')} (${r.notes}). Saved in the workspace images/ folder and offered as a download.`;
  },
};
