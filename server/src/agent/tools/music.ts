import { config } from '../../config';
import { generateMusic } from '../../engines/suno';
import type { ToolDef } from './common';

export const generateMusicTool: ToolDef = {
  name: 'generate_music',
  description:
    'Generate music/audio with the Suno engine (≈1-2 min, costs money per track). Two modes:\n' +
    '• AUTO mode — pass only `prompt` as a short description ("upbeat indie pop about summer ' +
    'road trips"); Suno writes the style and lyrics. Good for quick results.\n' +
    '• CUSTOM mode — set `style` and/or `title` to enable it. Then `prompt` must be the LYRICS ' +
    '(not a description), structured with section tags on their own lines: [Intro] [Verse] ' +
    '[Pre-Chorus] [Chorus] [Bridge] [Outro] [Hook]. Set instrumental:true for no vocals (then ' +
    'prompt can be empty/brief).\n' +
    'STYLE field (custom mode): comma-separated descriptors, NOT a sentence — genre, mood, ' +
    'instruments, tempo, and vocal type, e.g. "dream pop, melancholic, reverb guitar, 90 bpm, ' +
    'breathy female vocals". Keep it under ~200 chars.\n' +
    'Pick model V4 for best quality (default), V3_5 for longer songs. Returns downloadable MP3s.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'AUTO mode: a short description of the song. CUSTOM mode (when style/title set): the ' +
          'actual LYRICS with [Verse]/[Chorus] section tags on their own lines.',
      },
      instrumental: { type: 'boolean', description: 'true for music with no vocals' },
      style: {
        type: 'string',
        description:
          'Comma-separated style tags (genre, mood, instruments, tempo, vocal type). Enables ' +
          'custom mode. e.g. "epic orchestral, cinematic, choir, 120 bpm". Under ~200 chars.',
      },
      title: { type: 'string', description: 'Track title (also enables custom mode)' },
      model: { type: 'string', enum: ['V4', 'V3_5'], description: 'Suno model; V4 = best quality (default)' },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  available: () => !!config.sunoApiKey,
  summarize: (args) => String(args.prompt ?? '').slice(0, 80),
  async run(args, ctx) {
    const r = await generateMusic(
      {
        prompt: String(args.prompt ?? ''),
        instrumental: !!args.instrumental,
        style: args.style ? String(args.style) : undefined,
        title: args.title ? String(args.title) : undefined,
        model: args.model === 'V3_5' ? 'V3_5' : 'V4',
      },
      ctx.repoDir,
      ctx.signal,
    );
    if (!r.ok) return `Error: music generation failed — ${r.error}`;
    ctx.addCost(config.sunoCostPerTrack * r.files.length);
    return `Generated ${r.files.length} track(s): ${r.files
      .map((f) => f.path)
      .join(', ')}. Saved in the workspace and offered to the user as downloads.`;
  },
};
