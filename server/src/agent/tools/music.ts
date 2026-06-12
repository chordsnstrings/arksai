import { config } from '../../config';
import { generateMusic } from '../../engines/suno';
import type { ToolDef } from './common';

export const generateMusicTool: ToolDef = {
  name: 'generate_music',
  description:
    'Generate music or audio from a text prompt using the Suno engine (songs, jingles, ' +
    'background tracks, instrumentals). Tracks are saved to the workspace and offered to the ' +
    'user as downloads. Generation takes 1-2 minutes.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Description of the music, or the lyrics to sing' },
      instrumental: { type: 'boolean', description: 'true for music with no vocals' },
      style: { type: 'string', description: 'Optional genre/style, e.g. "lofi hip hop", "epic orchestral"' },
      title: { type: 'string', description: 'Optional track title' },
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
