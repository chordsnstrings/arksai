import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { analyzeImage, fileToDataUrl, generateImage, generateVideo, textToSpeech } from '../../engines/minimax';
import { createVideoTask, pollVideoTask, downloadVideo, seedanceOn } from '../../engines/seedance';
import { compileVideoPrompt } from '../videoBrief';
import { resolveInWorkspace, type ToolDef } from './common';

const minimaxOn = () => !!config.minimaxApiKey;

/** Vision: let the text-only agent actually "see" an image. */
export const seeImageTool: ToolDef = {
  name: 'see_image',
  description:
    'Look at an image in the workspace and answer a question about it, using a vision model ' +
    '(MiniMax). Use this whenever you need to actually SEE something — a photo or screenshot the ' +
    'USER uploaded (in uploads/), a UI mockup or rendered page, a diagram/chart, or a generated ' +
    'image. You are text-only on your own, so an image is invisible until you see_image it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path to the image (png/jpg/webp/gif).' },
      question: { type: 'string', description: 'What to determine about the image.' },
    },
    required: ['path', 'question'],
  },
  modes: ['chat', 'plan', 'code'],
  available: minimaxOn,
  summarize: (a) => `see ${String(a.path ?? '')}`,
  async run(args, ctx) {
    let dataUrl: string;
    try {
      dataUrl = fileToDataUrl(resolveInWorkspace(ctx.repoDir, String(args.path ?? '')));
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    const r = await analyzeImage(dataUrl, String(args.question ?? 'Describe this image.'), ctx.signal);
    if (!r.ok) return `Error: vision failed — ${r.error}`;
    ctx.addCost(config.minimaxVisionCost);
    return r.text ?? '(no answer)';
  },
};

/** Image generation. */
export const generateImageTool: ToolDef = {
  name: 'generate_image',
  description:
    'Generate an image from a text prompt — and optionally make it LIKE an uploaded reference ' +
    'image via `reference_image`. To create an image "like this one": if the reference is a ' +
    'PERSON whose look should carry over, pass reference_image (MiniMax carries that ' +
    "person/character's likeness across; only ONE reference is supported); for general " +
    'STYLE/composition/palette/scene of a non-person reference, first see_image the reference, ' +
    'then capture what you saw in the prompt. Uses the MiniMax image engine (costs money). Good ' +
    'for logos, icons, illustrations, hero/banner/section backgrounds, placeholders. ' +
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
    'Saved into the workspace images/ folder; reference them from your code by path.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the image to generate.' },
      aspect_ratio: { type: 'string', description: 'e.g. "1:1", "16:9", "9:16", "4:3" (default 1:1).' },
      n: { type: 'number', description: 'How many images (1-4, default 1).' },
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
          'Optional path to an UPLOADED image to base the new image on (carries a ' +
          "person/character's likeness across). For matching the general STYLE/scene/palette of a " +
          'non-person reference, first see_image it and describe that in `prompt` instead.',
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
    if (!config.minimaxApiKey) {
      return (
        'Image generation is not switched on for this server yet — the MINIMAX_API_KEY is not configured. ' +
        'Do NOT retry, switch to code, build a CSS/SVG graphic, or web-search a photo. Tell the user: ' +
        '"Image generation isn\'t enabled on this workspace yet — the operator needs to add the MiniMax API key."'
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
    if (!r.ok) return `Error: image generation failed — ${r.error}`;
    ctx.addCost(config.minimaxImageCost * r.files.length);
    return `Generated ${r.files.length} image(s): ${r.files.map((f) => f.path).join(', ')}. Saved in the workspace.`;
  },
};

/** Text-to-speech / voice. */
export const textToSpeechTool: ToolDef = {
  name: 'text_to_speech',
  description:
    'Synthesize natural speech from text with the MiniMax T2A engine (costs money). Use for ' +
    'narration, voiceovers, or audio deliverables. Saved as an MP3 in the workspace audio/ ' +
    'folder and offered as a download. Requires MINIMAX_GROUP_ID to be configured.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to speak.' },
      voice_id: { type: 'string', description: 'Optional MiniMax voice id (e.g. "male-qn-qingse", "female-shaonv").' },
      speed: { type: 'number', description: 'Speech speed multiplier (0.5-2, default 1).' },
    },
    required: ['text'],
  },
  modes: ['chat', 'code'],
  available: minimaxOn,
  summarize: (a) => String(a.text ?? '').slice(0, 80),
  async run(args, ctx) {
    const r = await textToSpeech(
      String(args.text ?? ''),
      { voiceId: args.voice_id ? String(args.voice_id) : undefined, speed: Number(args.speed) || undefined },
      ctx.repoDir,
      ctx.signal,
    );
    if (!r.ok) return `Error: speech synthesis failed — ${r.error}`;
    ctx.addCost(config.minimaxTtsCost);
    return `Generated speech: ${r.files.map((f) => f.path).join(', ')}. Saved in the workspace.`;
  },
};

/** Video generation (Hailuo). */
export const generateVideoTool: ToolDef = {
  name: 'generate_video',
  description:
    'Generate a short video WITH SYNCHRONIZED AUDIO (dialogue/SFX/ambience generated together with ' +
    'the picture). Models: "ArksAI Video 1.5" (default — 4–12 s, up to 4K, has a cheap fast DRAFT ' +
    'mode) and "ArksAI Video 2.0" (4–15 s, for reference/edit/extend work — no draft mode). ' +
    'DRAFT-FIRST LADDER (the required flow): generate a DRAFT (default — cheap 480p, ~2 min), show ' +
    'it to the user, and only after they approve call again with final:true for the 1080p render ' +
    '(4K only on explicit ask). Never render a final the user has not seen a draft of.\n' +
    'PROMPT LIKE A DIRECTOR: one continuous shot — subject + action + camera movement (push-in / ' +
    'orbit / handheld / static) + style/light (bright, premium) + what we HEAR. SUBJECT FIDELITY: ' +
    'describe people explicitly to match the audience/market, name places precisely — a vague noun ' +
    'gives the wrong face or building. If dialogue is wanted, pass it in `dialogue` (spoken verbatim).\n' +
    'PARAMS: aspect_ratio 9:16 (phone/social) · 16:9 (wide) · 1:1; duration 4–12 s (default 8); ' +
    'model "auto" (default) | "video-1.5" | "video-2.0". Saved to videos/ and offered as a download.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Director-style description of ONE continuous shot (subject + action + camera + style + sound).' },
      aspect_ratio: { type: 'string', description: '"9:16" (phone/social), "16:9" (wide), "1:1" (default 16:9).' },
      duration: { type: 'number', description: 'Seconds, 4–12 (default 8). Video 2.0 allows up to 15.' },
      final: { type: 'boolean', description: 'false/omitted = cheap 480p DRAFT (the default first step); true = the full-quality final render (only after the user approved a draft).' },
      resolution: { type: 'string', description: 'Final renders only: "720p" | "1080p" (default) | "4k" (explicit ask only).' },
      audio: { type: 'boolean', description: 'Native synchronized audio (default true).' },
      dialogue: { type: 'string', description: 'Optional line to be SPOKEN in the video, verbatim.' },
      model: { type: 'string', description: '"auto" (default), "video-1.5", or "video-2.0".' },
      first_frame_image: { type: 'string', description: 'Optional workspace image path to animate from (image-to-video).' },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  available: () => seedanceOn() || minimaxOn(),
  summarize: (a) => `${a.final ? 'final' : 'draft'}: ${String(a.prompt ?? '').slice(0, 70)}`,
  async run(args, ctx) {
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) return 'Error: describe the shot (subject + action + camera + style + sound).';

    // ---- Seedance path (ArksAI Video 1.5 / 2.0) — preferred when the key is configured ----
    if (seedanceOn()) {
      try {
        const modelArg = String(args.model || 'auto');
        const branded = modelArg === 'video-2.0' ? 'arksai-video-20' : 'arksai-video-15';
        let imageUrl: string | undefined;
        if (args.first_frame_image) {
          imageUrl = fileToDataUrl(resolveInWorkspace(ctx.repoDir, String(args.first_frame_image)));
        }
        const compiled = compileVideoPrompt({ brief: prompt, dialogue: args.dialogue ? String(args.dialogue) : undefined });
        const draft = args.final !== true;
        const { id, built } = await createVideoTask(
          {
            prompt: compiled,
            model: branded,
            aspect: args.aspect_ratio ? String(args.aspect_ratio) : undefined,
            duration: Number(args.duration) || undefined,
            resolution: args.resolution ? String(args.resolution) : undefined,
            draft,
            audio: args.audio !== false,
            imageUrl,
          },
          ctx.signal,
        );
        const done = await pollVideoTask(id, ctx.signal);
        if (!done.ok) return `Error: video generation failed — ${done.error}`;
        const name = `video-${Date.now()}${built.draft ? '-draft' : ''}.mp4`;
        const destAbs = path.join(ctx.repoDir, 'videos', name);
        const bytes = await downloadVideo(done.videoUrl, destAbs, ctx.signal);
        const cost = built.draft ? config.seedanceDraftCost : config.seedanceFinalCostPerSec * built.duration;
        ctx.addCost(cost);
        return built.draft
          ? `Draft video ready: videos/${name} (${built.label}, ${built.duration}s ${built.resolution}, audio ${built.body.generate_audio ? 'on' : 'off'}, ${Math.round(bytes / 1024)} KB). Show it to the user; when they approve, call generate_video again with final:true (same prompt) for the 1080p render. If they want a change, adjust the prompt and make ONE new draft.`
          : `Final video ready: videos/${name} (${built.label}, ${built.duration}s ${built.resolution}, ${Math.round(bytes / 1024)} KB). Offer it as the download.`;
      } catch (e: any) {
        return `Error: video generation failed — ${e?.message ?? e}`;
      }
    }

    // ---- Legacy Hailuo path (no BytePlus key) — behavior unchanged ----
    let firstFrame: string | undefined;
    if (args.first_frame_image) {
      try {
        firstFrame = fileToDataUrl(resolveInWorkspace(ctx.repoDir, String(args.first_frame_image)));
      } catch (e: any) {
        return `Error: ${e?.message ?? e}`;
      }
    }
    const r = await generateVideo(
      prompt,
      {
        firstFrameImage: firstFrame,
        duration: Number(args.duration) || undefined,
        resolution: args.resolution ? String(args.resolution) : undefined,
        aspectRatio: args.aspect_ratio ? String(args.aspect_ratio) : undefined,
      },
      ctx.repoDir,
      ctx.signal,
    );
    if (!r.ok) return `Error: video generation failed — ${r.error}`;
    ctx.addCost(config.minimaxVideoCost);
    return `Generated video: ${r.files.map((f) => f.path).join(', ')}. Saved in the workspace.`;
  },
};
