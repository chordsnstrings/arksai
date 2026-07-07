import path from 'node:path';
import { seedanceOn } from '../../engines/seedance';
import { planSummary } from '../videoStory';
import {
  planAndInitStory,
  executeStory,
  loadManifest,
  latestStoryId,
  dependentScenes,
  storyDirName,
  type StoryManifest,
} from '../videoStoryExec';
import type { ToolDef } from './common';

/**
 * generate_video_story — the multi-scene story pipeline (STORY_PLAN Phase 2): plan the scene
 * flow, generate each scene with the right continuity mechanism, stitch ONE video, and let the
 * user retake single scenes or promote the whole story to a final — all draft-first.
 */

function describeResult(m: StoryManifest): string {
  const rows = m.scenes.map((s) => {
    const mark = s.status === 'ok' ? '✓' : '✗';
    const dur = s.durationS ? `${Math.round(s.durationS)}s` : '';
    return `  ${mark} scene ${s.id} [${s.mechanismUsed}${dur ? ' · ' + dur : ''}] ${s.what}${s.note ? ` — ${s.note}` : ''}`;
  });
  const failed = m.scenes.filter((s) => s.status === 'failed');
  const lines = [
    m.stitched
      ? `${m.pass === 'final' ? 'FINAL' : 'Draft'} story ready: ${m.stitched} (${m.scenes.filter((s) => s.status === 'ok').length}/${m.plan.scenes.length} scenes, ~$${m.costUsd.toFixed(2)} this pass, story id ${m.id}).`
      : `No scenes could be generated (story id ${m.id}).`,
    ...rows,
  ];
  if (failed.length) lines.push(`Tell the user plainly which scenes failed and why — never gloss over it.`);
  if (m.pass === 'draft' && m.stitched) {
    lines.push(
      `Show the stitched draft to the user with the scene list. Next actions: a single-scene retake → call generate_video_story with {story_id:"${m.id}", retake_scene:<n>, retake_note:"<what to change>"}; approve → call with {story_id:"${m.id}", final:true} for the 1080p re-render (≈4× the draft cost).`,
    );
  }
  return lines.join('\n');
}

export const generateVideoStoryTool: ToolDef = {
  name: 'generate_video_story',
  description:
    'Create a MULTI-SCENE story video from one description: the story is planned into scenes ' +
    '(each exactly as long as it needs, 4s minimum), every scene is generated with the right ' +
    'continuity mechanism (fresh shot, pixel-exact composited opening frame for any EXACT ' +
    'text/UI the story requires, hard cut that opens on the previous scene\'s last frame, or a ' +
    'seamless same-take continuation), and the scenes are stitched into ONE video. Draft-first: ' +
    'the first call renders cheap 480p drafts and returns the stitched draft + a scene list; ' +
    'retake ONE scene with retake_scene/retake_note (re-pays only what changed); final:true ' +
    're-renders the approved story at 1080p. Use this for ANY ask that describes a SEQUENCE ' +
    '("then", "after that", multiple shots/moments) — a single continuous shot belongs to ' +
    'generate_video instead.',
  parameters: {
    type: 'object',
    properties: {
      story: { type: 'string', description: 'The story in the user\'s own words — what happens, in order. Required on the first call.' },
      aspect_ratio: { type: 'string', description: '"16:9" (default), "9:16", or "1:1" — one aspect for the whole story.' },
      audio: { type: 'boolean', description: 'Native audio (default true).' },
      dialogue: { type: 'string', description: 'Optional voiceover line spoken over the story.' },
      duration_hint: { type: 'number', description: 'Optional target total seconds (the planner decides per scene; hard ceiling 60).' },
      cast_images: { type: 'array', items: { type: 'string' }, description: 'Workspace paths of character/product stills to keep consistent across scenes.' },
      transition: { type: 'string', description: '"cut" (default, lossless), "dissolve" (crossfades), or "fade-black" (dip to black between scenes).' },
      music: { type: 'string', description: 'Optional music-bed style ("warm cinematic strings, building") — ONE continuous instrumental score generated and mixed under the whole story (ducks under the voiceover).' },
      captions: { type: 'boolean', description: 'Burn the voiceover line as a caption strip (needs dialogue; only on explicit ask).' },
      opening_frame: { type: 'string', description: 'Optional workspace image path — scene 1 OPENS on this exact frame (e.g. a staged product frame: "make this product ad a story").' },
      style_anchor: { type: 'string', description: 'Optional workspace image path used as a UNIVERSAL STYLE KEY: every plain scene gets it as a style-only reference (match palette/grade/lighting, never its content) so the look cannot drift shot to shot. Generate or pick ONE frame that nails the intended look first, then pass it here. Scenes with cast refs / opening frame / chained frames keep their own stronger anchor.' },
      resolution: { type: 'string', description: 'Final render resolution: "1080p" (default) or "4k" (only when the user explicitly asks).' },
      story_id: { type: 'string', description: 'An existing story (from a prior call) for final/retake. Omit to use the most recent story.' },
      final: { type: 'boolean', description: 'Re-render the existing story at 1080p (after the user approves the draft).' },
      retake_scene: { type: 'number', description: 'Regenerate ONE scene by id (dependent scenes re-chain automatically) and re-stitch.' },
      retake_note: { type: 'string', description: 'What to change in the retaken scene.' },
    },
    required: [],
  },
  modes: ['chat', 'code'],
  available: seedanceOn,
  summarize: (a) =>
    a.retake_scene
      ? `retake scene ${a.retake_scene}`
      : a.final
        ? 'render the final story'
        : `story: ${String(a.story ?? '').slice(0, 60)}`,
  async run(args, ctx) {
    try {
      const isFollowUp = !!args.final || !!args.retake_scene || !!args.story_id;
      let m: StoryManifest | null = null;

      if (isFollowUp) {
        const id = String(args.story_id || latestStoryId(ctx.repoDir) || '');
        m = id ? loadManifest(ctx.repoDir, id) : null;
        if (!m) return 'Error: no existing story found — call generate_video_story with the story description first.';
      } else {
        if (!String(args.story || '').trim()) return 'Error: describe the story (what happens, in order).';
        m = await planAndInitStory(String(args.story), {
          repoDir: ctx.repoDir,
          aspect: ['16:9', '9:16', '1:1'].includes(String(args.aspect_ratio)) ? String(args.aspect_ratio) : undefined,
          audio: args.audio !== false,
          dialogue: args.dialogue ? String(args.dialogue) : undefined,
          transition: args.transition === 'dissolve' ? 'dissolve' : args.transition === 'fade-black' ? 'fade-black' : 'cut',
          durationHint: Number(args.duration_hint) || undefined,
          castImages: Array.isArray(args.cast_images) ? args.cast_images.map(String).slice(0, 4) : undefined,
          music: args.music ? String(args.music) : undefined,
          captions: args.captions === true,
          openingFrame: args.opening_frame ? String(args.opening_frame) : undefined,
          styleAnchor: args.style_anchor ? String(args.style_anchor) : undefined,
          resolution: args.resolution === '4k' ? '4k' : undefined,
          signal: ctx.signal,
        });
      }

      let onlyScenes: number[] | undefined;
      let retakeNote: string | undefined;
      if (args.retake_scene) {
        const target = Number(args.retake_scene);
        if (!m.plan.scenes.some((s) => s.id === target)) {
          return `Error: scene ${target} does not exist (scenes 1–${m.plan.scenes.length}).`;
        }
        onlyScenes = dependentScenes(m.plan, target);
        retakeNote = args.retake_note ? String(args.retake_note) : undefined;
      }

      const result = await executeStory(m, {
        repoDir: ctx.repoDir,
        signal: ctx.signal,
        addCost: ctx.addCost,
        final: !!args.final,
        onlyScenes,
        retakeNote,
      });
      const summary = isFollowUp ? '' : `${planSummary(result.plan)}\n\n`;
      return `${summary}${describeResult(result)}\nScene files live in ${storyDirName(result.id)}${path.sep === '/' ? '/' : ''}.`;
    } catch (e: any) {
      return `Error: story generation failed — ${e?.message ?? e}`;
    }
  },
};
