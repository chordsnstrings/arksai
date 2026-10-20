import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { analyzeImage, fileToDataUrl, generateImage, modelarkReady, visionUrlsForFile } from '../../engines/modelark';
import { textToSpeech, ttsAvailable } from '../../engines/speech';
import {
  createVideoTask,
  pollVideoTask,
  downloadVideo,
  seedanceOn,
  isRealPersonRejection,
  realPersonFallbackSpec,
  videoCostEstimate,
  VIDEO_MODELS,
} from '../../engines/seedance';
import { compileVideoPrompt, fitDialogue, DIALOGUE_MAX_CHARS } from '../videoBrief';
import { isolateProduct, composeProductFrame, productAdBrief, BACKDROP_CSS, composeProductLineup } from '../productShot';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * Media capability tools (ModelArk): see_image (Seed 2.1 Turbo vision — config.arkVisionModel),
 * generate_image (Seedream 5.0 Pro — config.arkImageModel), generate_video (Seedance — ArksAI Video
 * 2.5 → 2.0 fallback, 1.5 for real-person first frames) and text_to_speech (gated on
 * engines/speech.ts — ModelArk has no speech model, so it stays hidden until a provider exists).
 */

/** Vision: let the text-only agent actually "see" an image. */
export const seeImageTool: ToolDef = {
  name: 'see_image',
  description:
    'Look at an image in the workspace and answer a question about it, using a vision model. Use ' +
    'this whenever you need to actually SEE something — a photo or screenshot the USER uploaded ' +
    '(in uploads/), a UI mockup or rendered page, a diagram/chart, or a generated image. Tall ' +
    'images (full-page screenshots) are read in full-resolution slices, so small text stays ' +
    'legible. You are text-only on your own, so an image is invisible until you see_image it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path to the image (png/jpg/webp/gif).' },
      question: { type: 'string', description: 'What to determine about the image.' },
    },
    required: ['path', 'question'],
  },
  modes: ['chat', 'plan', 'code'],
  available: modelarkReady,
  summarize: (a) => `see ${String(a.path ?? '')}`,
  async run(args, ctx) {
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx.repoDir, String(args.path ?? ''));
      if (!fs.existsSync(abs)) return `Error: "${args.path}" wasn't found in the workspace.`;
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    // A tall image (full-page screenshot) is tiled so every part is legible; the tiles go into
    // ONE vision message, framed as consecutive slices of a single image.
    const urls = await visionUrlsForFile(abs);
    const question = String(args.question ?? 'Describe this image.');
    const prompt =
      urls.length > 1
        ? `These ${urls.length} images are consecutive top-to-bottom slices of ONE tall image, in order — treat them as a single image.\n\n${question}`
        : question;
    const r = await analyzeImage(urls, prompt, ctx.signal);
    if (!r.ok) return `Error: vision failed — ${r.error}`;
    ctx.addCost(r.costUsd ?? config.arkVisionCost);
    return r.text ?? '(no answer)';
  },
};

/** Image generation (Seedream). */
export const generateImageTool: ToolDef = {
  name: 'generate_image',
  description:
    'Generate an image from a text prompt — and optionally base it on an uploaded reference image ' +
    'via `reference_image` (image-to-image: keeps the reference\'s product, object, character, ' +
    'composition or style). Reference images work for PRODUCTS, illustrated characters/mascots, ' +
    'scenes and styles — NOT for reproducing a real person\'s face: the image service may decline a ' +
    'photo of a real person as a reference, so for people DESCRIBE the look in the prompt instead ' +
    '(appearance, age range, styling) and never promise the user an exact likeness. For the general ' +
    'STYLE/palette of a reference you can also see_image it first and capture what you saw in the ' +
    'prompt. Uses the image engine (costs money). Good for logos, icons, illustrations, ' +
    'hero/banner/section backgrounds, product shots, placeholders. ' +
    'IMAGES ARE TEXT-FREE BY DEFAULT — for a WEBSITE hero/section background this is what you want: ' +
    'the page supplies the headline/copy in HTML, so the image must NOT contain words (baked-in text ' +
    'collides with the overlaid HTML — a real bug). Leave generous empty negative space + plan a ' +
    'dark scrim/gradient so overlaid text stays legible. Only set text_free:false for the rare case ' +
    'you explicitly want lettering rendered into the image. (For a finished social post/ad WITH ' +
    'composited copy, use generate_creative instead — never as a website background.) ' +
    'SUBJECT FIDELITY: the model drifts on vague nouns — describe people explicitly to match the ' +
    'audience/market (appearance, age range, setting), name landmarks/places precisely with one ' +
    'distinguishing detail, and specify the product exactly. One vague noun = the wrong face or ' +
    'building in the output. ' +
    'Saved into the workspace images/ folder (usually .jpg — use the exact path the tool returns); ' +
    'reference them from your code by path.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the image to generate.' },
      aspect_ratio: {
        type: 'string',
        description: 'e.g. "1:1" (default), "4:5", "9:16", "16:9", "3:2", "4:3", "21:9", "1.91:1" — any "W:H" works.',
      },
      n: { type: 'number', description: 'How many independent variants (1-4, default 1).' },
      text_free: {
        type: 'boolean',
        description:
          'Default TRUE — suppress ALL text/words/lettering in the image (correct for website ' +
          'hero/section backgrounds and most illustrations). Set false only if you truly want text ' +
          'baked into the image.',
      },
      reference_image: {
        type: 'string',
        description:
          'Optional path to an UPLOADED image to base the new image on (its product/object/character/' +
          'composition/style carries over). Not for a real person\'s face — describe people in `prompt` instead.',
      },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  // Always present (see generate_creative): a missing key returns a clear config error rather
  // than the tool vanishing from the toolset and the model misreading the gap as "no image tool".
  available: () => true,
  summarize: (a) => String(a.prompt ?? '').slice(0, 80),
  async run(args, ctx) {
    if (!modelarkReady()) {
      return (
        'Image generation is not switched on for this server yet — the AI provider key is not configured. ' +
        'Do NOT retry, switch to code, build a CSS/SVG graphic, or web-search a photo. Tell the user: ' +
        '"Image generation isn\'t enabled on this workspace yet — an admin needs to add the AI provider key under Admin → Keys."'
      );
    }
    // Optional reference image: resolve the workspace path and confirm it exists
    // before handing it to the engine, so a bad path is an actionable error here.
    let subjectReference: string | undefined;
    if (args.reference_image) {
      try {
        const abs = resolveInWorkspace(ctx.repoDir, String(args.reference_image));
        if (!fs.existsSync(abs)) {
          return `Error: the reference image "${args.reference_image}" wasn't found in the workspace. Upload it first, then pass its path.`;
        }
        subjectReference = abs;
      } catch (e: any) {
        return `Error: ${e?.message ?? e}`;
      }
    }
    // Text-free by DEFAULT: append a hard no-text constraint unless the caller explicitly
    // opts in to baked-in text. This stops generated website backgrounds from rendering
    // words that then collide with the page's own overlaid HTML headline.
    const NO_TEXT =
      'absolutely no text, no words, no letters, no typography, no captions, no labels, no watermark';
    const basePrompt = String(args.prompt ?? '');
    const prompt = args.text_free === false ? basePrompt : `${basePrompt}. ${NO_TEXT}.`;
    const r = await generateImage(
      prompt,
      {
        aspectRatio: args.aspect_ratio ? String(args.aspect_ratio) : undefined,
        n: Number(args.n) || 1,
        subjectReference,
      },
      ctx.repoDir,
      ctx.signal,
    );
    ctx.addCost(r.costUsd ?? config.arkImageCost * r.files.length);
    if (!r.ok) {
      // r.error is already the readable imageErrorMessage() text (real-person reference / policy).
      const err = r.error || 'image generation failed';
      const hint = /real person/i.test(err)
        ? ' Do NOT retry with this reference photo — regenerate WITHOUT reference_image, describing the person\'s look in the prompt, and tell the user plainly why.'
        : /content-policy/i.test(err)
          ? ' Rephrase the prompt once (no real names, brands or sensitive content) before telling the user.'
          : '';
      return `Error: image generation failed — ${err}.${hint}`;
    }
    return `Generated ${r.files.length} image(s): ${r.files.map((f) => f.path).join(', ')}. Saved in the workspace.`;
  },
};

/** Text-to-speech / voice — hidden until engines/speech.ts has a provider (ModelArk has none). */
export const textToSpeechTool: ToolDef = {
  name: 'text_to_speech',
  description:
    'Synthesize natural speech from text (costs money). Use for narration, voiceovers, or audio ' +
    'deliverables. Saved as an MP3 in the workspace audio/ folder and offered as a download.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to speak.' },
      voice_id: { type: 'string', description: 'Optional voice id.' },
      speed: { type: 'number', description: 'Speech speed multiplier (0.5-2, default 1).' },
    },
    required: ['text'],
  },
  modes: ['chat', 'code'],
  available: ttsAvailable,
  summarize: (a) => String(a.text ?? '').slice(0, 80),
  async run(args, ctx) {
    const r = await textToSpeech(
      String(args.text ?? ''),
      { voiceId: args.voice_id ? String(args.voice_id) : undefined, speed: Number(args.speed) || undefined },
      ctx.repoDir,
      ctx.signal,
    );
    if (r.costUsd) ctx.addCost(r.costUsd);
    if (!r.ok) return `Error: speech synthesis failed — ${r.error}`;
    return `Generated speech: ${r.files.map((f) => f.path).join(', ')}. Saved in the workspace.`;
  },
};

/**
 * Branded video model for the tool's `model` arg. PURE. Matches on the VERSION DIGITS in any
 * spelling the model emits ("1.5", "v1.5", "seedance-1.5", "video-15", "2.0", "2", "video-20",
 * "2.5"…; separators and prefixes ignored, dates like 260128 never read as a version), then on
 * cost words ("fast" / "cheapest" / "cheap" / "budget" → the cheapest model, Video 1.5). Only an
 * empty / "auto" / 2.5 spelling — or an arg with no version or cost intent at all — gets the
 * default, ArksAI Video 2.5 (which falls back to 2.0 while it isn't activated).
 */
export function videoModelFor(arg: unknown): string {
  const a = String(arg ?? '').toLowerCase().trim();
  const v = /(?<![0-9.])([12])(?:[.\-_ ]?([05]))?(?![0-9])/.exec(a);
  if (v) {
    if (v[1] === '1') return 'arksai-video-15'; // 1 / 1.5 — the only 1.x model
    return v[2] === '5' ? 'arksai-video-25' : 'arksai-video-20'; // 2.5 vs 2 / 2.0
  }
  if (/\b(fast(est)?|cheap(est)?|budget|lowest[- ]cost|quick(est)?)\b/.test(a)) return 'arksai-video-15';
  return 'arksai-video-25';
}

/** The tool's `model` arg that pins a branded model (the draft→final hand-off must name the model
 *  that ACTUALLY rendered the draft — 'auto' re-resolves and could pick a different one). PURE. */
export function videoModelArg(branded: string): string {
  if (branded === 'arksai-video-15') return 'video-1.5';
  if (branded === 'arksai-video-25') return 'video-2.5';
  return 'video-2.0'; // arksai-video-20 and its internal -fast tier
}

/**
 * The Seedance prompt for one generate_video call (PURE). The dialogue is fitted to one clip FIRST,
 * so exactly the fitted text is voiced, by exactly ONE audio direction: in product-ad mode it rides
 * the ad brief as the voiceover tagline (compileVideoPrompt then sees the brief's own Audio line and
 * adds none); otherwise compileVideoPrompt quotes it.
 */
export function videoPromptFor(o: {
  prompt: string;
  dialogue?: unknown;
  durationSec?: number;
  ad?: Omit<Parameters<typeof productAdBrief>[0], 'tagline'>;
}): { compiled: string; spoken: { text: string; trimmed: boolean } | null } {
  const spoken = o.dialogue ? fitDialogue(String(o.dialogue)) : null;
  const said = spoken?.text || undefined;
  const brief = o.ad ? productAdBrief({ ...o.ad, tagline: said }) : o.prompt;
  return { compiled: compileVideoPrompt({ brief, dialogue: o.ad ? undefined : said, durationSec: o.durationSec }), spoken };
}

/** Video generation (Seedance). */
export const generateVideoTool: ToolDef = {
  name: 'generate_video',
  description:
    'Generate a short video WITH SYNCHRONIZED AUDIO (dialogue/SFX/ambience generated together with ' +
    'the picture). Models: "ArksAI Video 2.5" (DEFAULT — the newest, best motion and image quality), ' +
    '"ArksAI Video 2.0" (4–15 s, the verified choice for reference/edit/extend work) and ' +
    '"ArksAI Video 1.5" (4–12 s, the cheapest; has a native fast DRAFT mode; the model that animates a ' +
    'real person\'s photo). The duration is clamped to the chosen model\'s range. ' +
    'DRAFT-FIRST LADDER (the required flow): generate a DRAFT (default — a cheap 480p preview), show ' +
    'it to the user, and only after they approve repeat the ORIGINAL call with final:true and the model/image overrides the ' +
    'draft result names — it spells that out as a ready FINALIZE CALL (aspect ratio, duration, dialogue, audio, frames, ' +
    'references, product-ad args); make it verbatim for the 1080p render (4K only on explicit ask). Never drop an argument ' +
    'between draft and final, and never render a final the user has not seen a draft of.\n' +
    'PROMPT LIKE A DIRECTOR: one continuous shot — subject + action + camera movement (push-in / ' +
    'orbit / handheld / static) + style/light (bright, premium) + what we HEAR. SUBJECT FIDELITY: ' +
    'describe people explicitly to match the audience/market, name places precisely — a vague noun ' +
    'gives the wrong face or building. If dialogue is wanted, pass it in `dialogue` (spoken verbatim).\n' +
    'REAL PEOPLE (verified provider policy): a photo of a REAL person is supported by ANIMATING ' +
    'THEIR ACTUAL PHOTO — pass it as `first_frame_image` (the clip starts on the photo, exact likeness ' +
    'preserved); with `dialogue` they speak it lip-synced. Do NOT pass real-person photos as ' +
    '`reference_images` — the provider declines identity-reference for real people (the tool auto-routes ' +
    'to the photo-animation path on Video 1.5 if that happens). NEVER suggest obscuring/cropping a face or otherwise ' +
    'evading the check — if the provider declines an image outright, say so plainly and offer the ' +
    'photo-animation or described-look paths. ILLUSTRATED characters/mascots/products CAN use ' +
    '`reference_images` for identity/style consistency (Video 2.0 is strongest). A start→end ' +
    'transition uses `first_frame_image` + `last_frame_image`.\n' +
    'PARAMS: aspect_ratio 9:16 (phone/social) · 16:9 (wide) · 1:1; duration in seconds (default 8); ' +
    'model "auto" (= video-2.5, default) | "video-2.5" | "video-2.0" | "video-1.5" (a 4K final on video-2.5 renders on Video 2.0). ' +
    `Dialogue: at most ~${DIALOGUE_MAX_CHARS} characters per clip (longer is trimmed at a sentence boundary) — for longer narration use generate_video_story. Saved to videos/ and offered as a download.`,
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Director-style description of ONE continuous shot (subject + action + camera + style + sound).' },
      aspect_ratio: { type: 'string', description: '"9:16" (phone/social), "16:9" (wide), "1:1" (default 16:9).' },
      duration: { type: 'number', description: 'Seconds (default 8). Video 1.5: 4–12; Video 2.0 / 2.5: 4–15; clamped to the model\'s range.' },
      final: { type: 'boolean', description: 'false/omitted = cheap 480p DRAFT (the default first step); true = the full-quality final render (only after the user approved a draft).' },
      resolution: { type: 'string', description: 'Final renders only: "720p" | "1080p" (default) | "4k" (explicit ask only — on video-2.5 it renders on Video 2.0).' },
      audio: { type: 'boolean', description: 'Native synchronized audio (default true).' },
      dialogue: { type: 'string', description: `Optional line to be SPOKEN in the video, verbatim (≤ ~${DIALOGUE_MAX_CHARS} characters).` },
      model: { type: 'string', description: '"auto" (default = video-2.5), "video-2.5", "video-2.0", or "video-1.5".' },
      first_frame_image: { type: 'string', description: 'Optional workspace image path — the clip STARTS on this exact frame (image-to-video).' },
      last_frame_image: { type: 'string', description: 'Optional workspace image path — the clip ENDS on this exact frame; with first_frame_image it animates start→end.' },
      reference_images: { type: 'array', items: { type: 'string' }, description: 'Optional workspace image paths — subject/product/style references the video keeps consistent (best on Video 2.0). Up to 4.' },
      product_photo: { type: 'string', description: 'PRODUCT-AD MODE: workspace path to the product photo. The product is IDENTIFIED and lifted off its background (whatever was behind it), staged on the chosen backdrop with shadow/reflection, and the video OPENS on that clean frame.' },
      product_photos: { type: 'array', items: { type: 'string' }, description: 'PRODUCT-AD MODE, RANGE/LINE-UP: 2–4 workspace photo paths for a product FAMILY. Each product is isolated and they are staged shoulder-to-shoulder on one backdrop (first photo = the hero variant, center). Defaults the ad style to family-lineup.' },
      product_name: { type: 'string', description: 'Product-ad mode: the product name (used in the director brief).' },
      product_category: { type: 'string', description: 'Product-ad mode: skincare | food | fashion | jewellery | electronics | fragrance | furniture | fitness | automotive | fmcg — picks the expert ad language (skincare shows application on skin, food the pour/steam, jewellery the macro sparkle…).' },
      ad_template: { type: 'string', description: "Product-ad mode: the category's ad style key (e.g. skincare: texture-ritual | ingredient-story | splash-fresh | luxe-noir), or a UNIVERSAL style any product can use: unboxing | ugc-real | zero-gravity | asmr-macro | before-after | festive-gift | miniature-world | retro-film. Omit for the category default." },
      backdrop: { type: 'string', description: 'Product-ad mode: staging backdrop id (studio-white, studio-grey, dark-luxury, colour-pop, gradient, marble, silk-fabric, water-splash, ice-frost, smoke-mist, stone-slate, warm-wood, botanical, desert-sand, floating, industrial, neon-night, festive, lifestyle, tech). Default studio-white.' },
      focus_product: { type: 'boolean', description: 'Product-ad mode: remove the photo background and focus on the product (default true). false keeps the original photo as-is.' },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  available: seedanceOn,
  summarize: (a) => `${a.final ? 'final' : 'draft'}: ${String(a.prompt ?? '').slice(0, 70)}`,
  async run(args, ctx) {
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) return 'Error: describe the shot (subject + action + camera + style + sound).';
    try {
      const branded = videoModelFor(args.model);
      // PRODUCT-AD MODE: identify + isolate the product from ANY photo, stage it on the
      // chosen backdrop (shadow + reflection), and open the video on that clean frame.
      // Degrades honestly: if isolation can't run, the original photo stages as-is.
      let productNote = '';
      let adBrief: Parameters<typeof videoPromptFor>[0]['ad'];
      const productPhotos: string[] = Array.isArray(args.product_photos) && args.product_photos.length
        ? args.product_photos.slice(0, 4).map((p: unknown) => String(p))
        : args.product_photo
          ? [String(args.product_photo)]
          : [];
      if (productPhotos.length) {
        const vidDir = path.join(ctx.repoDir, 'videos');
        fs.mkdirSync(vidDir, { recursive: true });
        // Isolate each photo (focus_product default on); degrade per-photo, honestly.
        const staged: { productImagePath: string; isolated: boolean }[] = [];
        for (const [i, rel] of productPhotos.entries()) {
          const photoAbs = resolveInWorkspace(ctx.repoDir, rel);
          if (!fs.existsSync(photoAbs)) return `Error: product photo not found: ${rel}`;
          let stagedFrom = photoAbs;
          let isolated = false;
          if (args.focus_product !== false) {
            const cut = path.join(vidDir, `product-cut-${Date.now()}-${i}.png`);
            const iso = await isolateProduct(photoAbs, cut, ctx.signal);
            if (iso.ok) { stagedFrom = cut; isolated = true; }
            else productNote += `\nNote: background removal was skipped for ${path.basename(rel)} (${iso.reason}) — that photo was staged as-is.`;
          }
          staged.push({ productImagePath: stagedFrom, isolated });
        }
        const backdropId = BACKDROP_CSS[String(args.backdrop || '')] ? String(args.backdrop) : 'studio-white';
        const stagedOut = path.join(vidDir, `product-frame-${Date.now()}.jpg`);
        const aspect = ['16:9', '9:16', '1:1'].includes(String(args.aspect_ratio)) ? (String(args.aspect_ratio) as '16:9' | '9:16' | '1:1') : '16:9';
        const lineup = staged.length > 1;
        if (lineup) await composeProductLineup({ items: staged, backdropId, outPath: stagedOut, aspect });
        else await composeProductFrame({ productImagePath: staged[0].productImagePath, backdropId, outPath: stagedOut, aspect, isolated: staged[0].isolated });
        args.first_frame_image = path.relative(ctx.repoDir, stagedOut);
        const range = VIDEO_MODELS[branded];
        adBrief = {
          productName: String(args.product_name || prompt.slice(0, 80)),
          productDesc: args.product_name ? prompt : undefined,
          categoryId: args.product_category ? String(args.product_category) : undefined,
          // A range with no explicit style gets the line-up treatment by default.
          templateKey: args.ad_template ? String(args.ad_template) : lineup ? 'family-lineup' : undefined,
          backdropPhrase: `staged on a ${backdropId.replace(/-/g, ' ')} set${lineup ? ` — a line-up of ${staged.length} products, hero variant center` : ''}`,
          // Time the shot plan to the clip that renders (the engine's default + clamp), so a draft
          // and its finalize call (which carries the built duration) compile the same plan.
          durationS: Math.min(range.max, Math.max(range.min, Math.round(Number(args.duration) || 8))),
        };
      }
      // Keep each image's WORKSPACE PATH beside its data URL: a real-person reroute must hand the
      // agent back the exact path it animated, so the final repeats the call that succeeded.
      const firstFramePath = args.first_frame_image ? String(args.first_frame_image) : undefined;
      const lastFramePath = args.last_frame_image ? String(args.last_frame_image) : undefined;
      const referencePaths: string[] = Array.isArray(args.reference_images) ? args.reference_images.slice(0, 4).map((p: unknown) => String(p)) : [];
      const imageUrl = firstFramePath ? fileToDataUrl(resolveInWorkspace(ctx.repoDir, firstFramePath)) : undefined;
      const lastFrameUrl = lastFramePath ? fileToDataUrl(resolveInWorkspace(ctx.repoDir, lastFramePath)) : undefined;
      const referenceUrls: string[] = referencePaths.map((p) => fileToDataUrl(resolveInWorkspace(ctx.repoDir, p)));
      // Compile against the duration the clip actually RENDERS at (the engine default + clamp), so a
      // draft that omitted duration and its finalize call (which carries the built duration) send
      // the identical prompt — the user pays for exactly the shot they approved.
      const durRange = VIDEO_MODELS[branded];
      const renderDurS = durRange ? Math.min(durRange.max, Math.max(durRange.min, Math.round(Number(args.duration) || 8))) : Number(args.duration) || undefined;
      const { compiled, spoken } = videoPromptFor({ prompt, dialogue: args.dialogue, durationSec: renderDurS, ad: adBrief });
      // DRAFT = a cheap 480p preview on EVERY model: 1.5 uses its native draft mode; models
      // without one (2.0/2.5) render at 480p, so the ladder never pays 1080p for a preview.
      const isDraft = args.final !== true;
      const spec = {
        prompt: compiled,
        model: branded,
        aspect: args.aspect_ratio ? String(args.aspect_ratio) : undefined,
        duration: Number(args.duration) || undefined,
        resolution: isDraft ? '480p' : args.resolution ? String(args.resolution) : undefined,
        draft: isDraft,
        audio: args.audio !== false,
        imageUrl,
        lastFrameUrl,
        referenceUrls,
      };
      let realPerson: ReturnType<typeof realPersonFallbackSpec> = null;
      let created: Awaited<ReturnType<typeof createVideoTask>>;
      try {
        created = await createVideoTask(spec, ctx.signal);
      } catch (e: any) {
        // Provider policy: 2.x declines real-person photos on every image role, but 1.5
        // officially supports a real person as the FIRST FRAME (animate their actual photo —
        // which also preserves likeness best). Route to that supported path automatically —
        // but only when the declined photo can actually become the first frame.
        if (!isRealPersonRejection(e?.message ?? '')) throw e;
        realPerson = realPersonFallbackSpec(spec);
        if (!realPerson) {
          return (
            `Error: video generation failed — ${e?.message ?? e}. The provider declined an image because it shows a real ` +
            'person, and a start frame (first_frame_image) is also set, so the person photo cannot be animated as the opening ' +
            'frame without dropping it. Do NOT retry with the same images. Tell the user plainly that real-person photos are ' +
            'declined as references (provider policy), and offer: (a) animate the person\'s ACTUAL photo as first_frame_image ' +
            '(no other start frame), or (b) describe the person\'s look in the prompt instead. Never suggest obscuring or cropping the face.'
          );
        }
        created = await createVideoTask(realPerson.spec, ctx.signal);
      }
      const { id, built } = created;
      const done = await pollVideoTask(id, ctx.signal);
      if (!done.ok) return `Error: video generation failed — ${done.error}`;
      const name = `video-${Date.now()}${isDraft ? '-draft' : ''}.mp4`;
      const destAbs = path.join(ctx.repoDir, 'videos', name);
      const bytes = await downloadVideo(done.videoUrl, destAbs, ctx.signal);
      ctx.addCost(videoCostEstimate(built.model, built.resolution, built.duration));
      const ROLE = { first_frame: 'start frame', reference_image: 'first reference image', last_frame: 'end frame' } as const;
      // The workspace path the reroute animated (realPersonFallbackSpec picks the start frame, else
      // the first non-empty reference, else the end frame).
      const animatedPath = !realPerson
        ? undefined
        : realPerson.animated === 'first_frame'
          ? firstFramePath
          : realPerson.animated === 'reference_image'
            ? referencePaths[referenceUrls.findIndex(Boolean)]
            : lastFramePath;
      const dialogueNote = spoken?.trimmed
        ? ` NOTE: the dialogue was longer than one clip can speak (~${DIALOGUE_MAX_CHARS} characters), so it was trimmed to "${spoken.text}". Tell the user; for longer narration, split it across a multi-scene story (generate_video_story).`
        : '';
      const realPersonNote = !realPerson
        ? ''
        : realPerson.isPersonImage
          ? ' NOTE: the photo contains a real person, so it was rendered by animating their ACTUAL photo (Video 1.5, first frame = the photo itself — exact likeness preserved); identity-reference mode declines real people (provider policy). Tell the user this plainly if relevant.'
          : ` NOTE: the provider declined a real-person photo (identity-reference mode declines real people — provider policy), so this was rendered on Video 1.5 by animating your ${ROLE[realPerson.animated]} as the opening frame; the other ${realPerson.dropped} image(s) could not be used, so the person may NOT appear with their real likeness. Tell the user this plainly and offer to animate the person's own photo as first_frame_image instead.`;
      // Pin the model that ACTUALLY rendered the draft (2.5 may have fallen back to 2.0, a
      // real-person photo reroutes to 1.5) — 'auto' re-resolves and could render the final elsewhere.
      // A real-person draft only rendered as 1.5 + the photo as first frame: repeating the original
      // reference_images / last_frame_image on 1.5 is declined, so name the exact call that works.
      const modelArg = videoModelArg(built.model);
      const finalizeCall = animatedPath
        ? `call generate_video again with final:true, the same prompt, model:"${modelArg}" and first_frame_image:"${animatedPath}" (the photo this draft animated) — and NO reference_images or last_frame_image (the provider declines the real-person photo in those roles)`
        : `call generate_video again with final:true, the same prompt and model:"${modelArg}" (the model that rendered this draft)`;
      // The tool is stateless: whatever the finalize call omits is silently lost from the PAID
      // final. So spell out the whole call that reproduces this draft — the original arguments
      // (ratio, the built duration, the fitted dialogue, audio, every image) with the overrides.
      const finalArgs: Record<string, unknown> = {
        prompt,
        final: true,
        model: modelArg,
        aspect_ratio: args.aspect_ratio ? String(args.aspect_ratio) : '16:9',
        duration: built.duration,
      };
      if (args.resolution) finalArgs.resolution = String(args.resolution);
      if (spoken?.text) finalArgs.dialogue = spoken.text;
      if (args.audio === false) finalArgs.audio = false;
      // Product-ad mode re-stages its own opening frame from the photo(s), so it never repeats it.
      const firstFrameArg = animatedPath ?? (productPhotos.length ? undefined : firstFramePath);
      if (firstFrameArg) finalArgs.first_frame_image = firstFrameArg;
      if (!animatedPath && lastFramePath) finalArgs.last_frame_image = lastFramePath;
      if (!animatedPath && referencePaths.length) finalArgs.reference_images = referencePaths;
      if (productPhotos.length) {
        if (Array.isArray(args.product_photos) && args.product_photos.length) finalArgs.product_photos = productPhotos;
        else finalArgs.product_photo = productPhotos[0];
        for (const k of ['product_name', 'product_category', 'ad_template', 'backdrop']) if (args[k]) finalArgs[k] = String(args[k]);
        if (args.focus_product === false) finalArgs.focus_product = false;
      }
      return isDraft
        ? `Draft video ready: videos/${name} (${built.label}, ${built.duration}s ${built.resolution}, audio ${built.body.generate_audio ? 'on' : 'off'}, ${Math.round(bytes / 1024)} KB).${realPersonNote}${dialogueNote}${productNote} Show it to the user; when they approve, ${finalizeCall}, keeping every other argument of this draft — the FINALIZE CALL below, verbatim — for the ${finalArgs.resolution ?? '1080p'} render. If they want a change, adjust the prompt and make ONE new draft.\nFINALIZE CALL (only after the user approves): generate_video ${JSON.stringify(finalArgs)}`
        : `Final video ready: videos/${name} (${built.label}, ${built.duration}s ${built.resolution}, ${Math.round(bytes / 1024)} KB).${realPersonNote}${dialogueNote}${productNote} Offer it as the download.`;
    } catch (e: any) {
      return `Error: video generation failed — ${e?.message ?? e}`;
    }
  },
};
