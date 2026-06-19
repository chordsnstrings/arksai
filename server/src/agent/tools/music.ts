import { config } from '../../config';
import { generateMusic, extendMusic, generateLyrics, coverAudio } from '../../engines/suno';
import type { ToolDef } from './common';

// Current sunoapi.org model ids (newest→legacy). The DEFAULT is config-driven
// (config.sunoModel) so the operator can set SUNO_MODEL to the best confirmed id
// on the Droplet without a code change; the enum just lets the agent pick.
const MODEL_ENUM = ['V5', 'V4_5PLUS', 'V4_5', 'V4', 'V3_5'];

export const generateMusicTool: ToolDef = {
  name: 'generate_music',
  description:
    'Generate music/audio with the Suno engine (≈2-3 min, returns ~2 tracks, costs money per ' +
    'track). Two modes:\n' +
    '• AUTO mode — pass only `prompt` as a short DESCRIPTION (≤500 chars, e.g. "upbeat indie ' +
    'pop about summer road trips, acoustic guitar, male vocals, warm production"); Suno writes ' +
    'the style and lyrics. Good for quick results.\n' +
    '• CUSTOM mode — set BOTH `style` AND `title` to enable it. Then `prompt` must be the LYRICS ' +
    '(≤5000 chars), structured with section tags on their own lines: [Intro] [Verse] [Pre-Chorus] ' +
    '[Chorus] [Bridge] [Outro] [Hook]. Put vocal delivery cues in (parens) before a line ' +
    '("(whispered)", "(belted)"). Put the strongest line FIRST in each section. Keep production ' +
    'notes OUT of the lyrics — they belong in `style`. Set instrumental:true for no vocals (then ' +
    'prompt can be empty).\n' +
    'STYLE field (custom mode, ≤1000 chars): comma-separated COMPONENTS, not a sentence — ' +
    'genre+subgenre, tempo/feel, core instruments, vocal intent, mix direction, one emotional ' +
    'axis. e.g. "dream pop, 90 bpm reflective, shimmering guitars, lush reverb synths, breathy ' +
    'female vocals, nostalgic, intimate bedroom-pop mix". TITLE ≤80 chars.\n' +
    'Optional controls: vocalGender ("m"/"f"), styleWeight/weirdnessConstraint (0–1), ' +
    'negativeTags (styles to AVOID, e.g. "heavy metal, aggressive"). Default model is the best ' +
    'current one; returns downloadable MP3s.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'AUTO mode: a short description of the song (≤500 chars). CUSTOM mode (when style+title ' +
          'set): the actual LYRICS (≤5000) with [Verse]/[Chorus] section tags on their own lines.',
      },
      instrumental: { type: 'boolean', description: 'true for music with no vocals' },
      style: {
        type: 'string',
        description:
          'Comma-separated style COMPONENTS (genre, tempo, instruments, vocal type, mix, mood). ' +
          'Enables custom mode (with title). ≤1000 chars. e.g. "epic orchestral, cinematic, ' +
          'choir, 120 bpm, soaring strings".',
      },
      title: { type: 'string', description: 'Track title (≤80 chars; also required to enable custom mode)' },
      model: { type: 'string', enum: MODEL_ENUM, description: 'Suno model id; omit for the best current default' },
      vocalGender: { type: 'string', enum: ['m', 'f'], description: 'Preferred vocal gender' },
      styleWeight: { type: 'number', description: 'How strongly to follow the style, 0–1' },
      weirdnessConstraint: { type: 'number', description: 'Creativity/experimentation, 0–1' },
      negativeTags: { type: 'string', description: 'Styles to EXCLUDE, comma-separated (e.g. "heavy metal, aggressive")' },
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
        model: args.model ? String(args.model) : undefined,
        vocalGender: args.vocalGender === 'm' || args.vocalGender === 'f' ? args.vocalGender : undefined,
        styleWeight: typeof args.styleWeight === 'number' ? args.styleWeight : undefined,
        weirdnessConstraint: typeof args.weirdnessConstraint === 'number' ? args.weirdnessConstraint : undefined,
        negativeTags: args.negativeTags ? String(args.negativeTags) : undefined,
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

export const extendMusicTool: ToolDef = {
  name: 'extend_music',
  description:
    'Extend/continue an existing Suno track to make it longer, using the source track\'s ' +
    '`audioId` (from a prior generate_music result). By default it inherits the original style; ' +
    'pass style/title/prompt to steer the continuation, and continueAt (seconds) to set where the ' +
    'extension begins. Costs money per track.',
  parameters: {
    type: 'object',
    properties: {
      audioId: { type: 'string', description: 'The audioId of the source track to extend' },
      continueAt: { type: 'number', description: 'Seconds into the source to continue from (e.g. 120)' },
      prompt: { type: 'string', description: 'Optional new lyrics for the continuation' },
      style: { type: 'string', description: 'Optional style to steer the continuation' },
      title: { type: 'string', description: 'Optional title for the extended track' },
      model: { type: 'string', enum: MODEL_ENUM, description: 'Suno model id; omit for the default' },
    },
    required: ['audioId'],
  },
  modes: ['chat', 'code'],
  available: () => !!config.sunoApiKey,
  summarize: (args) => `extend ${String(args.audioId ?? '').slice(0, 24)}`,
  async run(args, ctx) {
    const r = await extendMusic(
      {
        audioId: String(args.audioId ?? ''),
        continueAt: typeof args.continueAt === 'number' ? args.continueAt : undefined,
        prompt: args.prompt ? String(args.prompt) : undefined,
        style: args.style ? String(args.style) : undefined,
        title: args.title ? String(args.title) : undefined,
        model: args.model ? String(args.model) : undefined,
      },
      ctx.repoDir,
      ctx.signal,
    );
    if (!r.ok) return `Error: extend failed — ${r.error}`;
    ctx.addCost(config.sunoCostPerTrack * r.files.length);
    return `Extended into ${r.files.length} track(s): ${r.files.map((f) => f.path).join(', ')}.`;
  },
};

export const generateLyricsTool: ToolDef = {
  name: 'generate_lyrics',
  description:
    'Generate structured song LYRICS only (no audio), as a step before a custom generate_music ' +
    'call or when the user just wants words. Returns lyric variants with [Verse]/[Chorus] section ' +
    'tags. Fast and cheap (no audio render).',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What the lyrics should be about (theme, mood, story).' },
    },
    required: ['prompt'],
  },
  modes: ['chat', 'code'],
  available: () => !!config.sunoApiKey,
  summarize: (args) => String(args.prompt ?? '').slice(0, 80),
  async run(args, ctx) {
    const r = await generateLyrics(String(args.prompt ?? ''), ctx.signal);
    if (!r.ok) return `Error: lyrics generation failed — ${r.error}`;
    return r.lyrics
      .map((l, i) => `## Variant ${i + 1}${l.title ? ` — ${l.title}` : ''}\n${l.text}`)
      .join('\n\n');
  },
};

export const coverAudioTool: ToolDef = {
  name: 'cover_audio',
  description:
    'Create an AI COVER of an existing audio track — re-perform it in a new style. Provide a ' +
    'publicly-reachable `uploadUrl` to the source audio (≤ ~8 min). Set style+title for a custom ' +
    'cover (and prompt for new lyrics), or just a style description. Costs money per track.',
  parameters: {
    type: 'object',
    properties: {
      uploadUrl: { type: 'string', description: 'Public URL of the source audio to cover' },
      style: { type: 'string', description: 'Target style for the cover (comma-separated components)' },
      title: { type: 'string', description: 'Title for the cover' },
      prompt: { type: 'string', description: 'Optional new lyrics' },
      instrumental: { type: 'boolean', description: 'true to produce an instrumental cover' },
      model: { type: 'string', enum: MODEL_ENUM, description: 'Suno model id; omit for the default' },
    },
    required: ['uploadUrl'],
  },
  modes: ['chat', 'code'],
  available: () => !!config.sunoApiKey,
  summarize: (args) => `cover ${String(args.title ?? args.uploadUrl ?? '').slice(0, 40)}`,
  async run(args, ctx) {
    const r = await coverAudio(
      {
        uploadUrl: String(args.uploadUrl ?? ''),
        style: args.style ? String(args.style) : undefined,
        title: args.title ? String(args.title) : undefined,
        prompt: args.prompt ? String(args.prompt) : undefined,
        instrumental: !!args.instrumental,
        model: args.model ? String(args.model) : undefined,
      },
      ctx.repoDir,
      ctx.signal,
    );
    if (!r.ok) return `Error: cover failed — ${r.error}`;
    ctx.addCost(config.sunoCostPerTrack * r.files.length);
    return `Created ${r.files.length} cover track(s): ${r.files.map((f) => f.path).join(', ')}.`;
  },
};
