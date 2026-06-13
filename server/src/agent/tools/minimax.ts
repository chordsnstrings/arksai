import { config } from '../../config';
import { analyzeImage, fileToDataUrl, generateImage, generateVideo, textToSpeech } from '../../engines/minimax';
import { resolveInWorkspace, type ToolDef } from './common';

const minimaxOn = () => !!config.minimaxApiKey;

/** Vision: let the text-only agent actually "see" an image. */
export const seeImageTool: ToolDef = {
  name: 'see_image',
  description:
    'Look at an image in the workspace and answer a question about it, using a vision model ' +
    '(MiniMax). Use this whenever you need to actually SEE something — inspect a screenshot, ' +
    'judge a UI mockup or rendered page, read a diagram/chart, or check a generated image. ' +
    'You are text-only on your own; this is your eyes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path to the image (png/jpg/webp/gif).' },
      question: { type: 'string', description: 'What to determine about the image.' },
    },
    required: ['path', 'question'],
  },
  modes: ['chat', 'code'],
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
    'Generate an image from a text prompt with the MiniMax image engine (costs money). Use for ' +
    'logos, icons, illustrations, hero/banner images, placeholders. Saved into the workspace ' +
    'images/ folder and offered to the user as downloads — reference them from your code by path.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the image to generate.' },
      aspect_ratio: { type: 'string', description: 'e.g. "1:1", "16:9", "9:16", "4:3" (default 1:1).' },
      n: { type: 'number', description: 'How many images (1-4, default 1).' },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  available: minimaxOn,
  summarize: (a) => String(a.prompt ?? '').slice(0, 80),
  async run(args, ctx) {
    const r = await generateImage(
      String(args.prompt ?? ''),
      { aspectRatio: args.aspect_ratio ? String(args.aspect_ratio) : undefined, n: Number(args.n) || 1 },
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
    'Generate a short video from a text prompt with the MiniMax Hailuo engine (slow, ~minutes, ' +
    'costs money). Optionally animate from a starting image. Saved as an MP4 in the workspace ' +
    'video/ folder and offered as a download. Confirm with the user before generating (it is the ' +
    'most expensive operation).',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Description of the video to generate.' },
      first_frame_image: { type: 'string', description: 'Optional workspace image path to animate from.' },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  available: minimaxOn,
  summarize: (a) => String(a.prompt ?? '').slice(0, 80),
  async run(args, ctx) {
    let firstFrame: string | undefined;
    if (args.first_frame_image) {
      try {
        firstFrame = fileToDataUrl(resolveInWorkspace(ctx.repoDir, String(args.first_frame_image)));
      } catch (e: any) {
        return `Error: ${e?.message ?? e}`;
      }
    }
    const r = await generateVideo(String(args.prompt ?? ''), { firstFrameImage: firstFrame }, ctx.repoDir, ctx.signal);
    if (!r.ok) return `Error: video generation failed — ${r.error}`;
    ctx.addCost(config.minimaxVideoCost);
    return `Generated video: ${r.files.map((f) => f.path).join(', ')}. Saved in the workspace.`;
  },
};
