import fs from 'node:fs';
import type { ToolDef, ToolCtx } from './common';
import { resolveInWorkspace } from './common';
import {
  createSocialPost, executeSocialPost, listSocialPosts, resolveSocialCreds,
  type SocialPlatform,
} from '../../robots/social';

/**
 * Track A tools — organic Facebook/Instagram publishing. `publish_post` posts now or schedules
 * (the scheduler's `social` job publishes when due); `plan_content_calendar` turns a brief into
 * a dated set of post specs to review; `list_posts` shows recent posts + permalinks.
 *
 * These are capabilities — the AUTONOMY SLIDER governs WHEN a Social robot calls them: at a low
 * setting it proposes the calendar and waits for your approval; higher, it schedules/publishes
 * on its own. Media (an image/video the agent made with generate_creative/generate_image/
 * render_motion_video) is a workspace path; Instagram requires one.
 */

function needCreds(err: string): string {
  return `Error: ${err} Connect a Facebook Page + Instagram under the Social robot's Settings → Connections.`;
}

const platforms = (p: string): SocialPlatform[] =>
  p === 'both' ? ['facebook', 'instagram'] : p === 'instagram' ? ['instagram'] : ['facebook'];

/** Parse an ISO datetime that MUST carry a UTC offset (so "when" is unambiguous). */
function parseWhen(s: string): number | null {
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s.trim())) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export const publishPostTool: ToolDef = {
  name: 'publish_post',
  description:
    'Publish (or schedule) an organic post to a Facebook Page and/or Instagram. platform: ' +
    'facebook | instagram | both. caption is the post text. media is a workspace image/video ' +
    'path (REQUIRED for Instagram; optional photo for Facebook). kind: image | video | reels | ' +
    'stories (Instagram). schedule_at is an ISO datetime WITH a UTC offset (e.g. ' +
    '2026-07-10T09:00:00+04:00) to schedule instead of posting now. Respects Instagram\'s ' +
    '25-posts/24h limit. Returns the live permalink(s).',
  parameters: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: ['facebook', 'instagram', 'both'] },
      caption: { type: 'string' },
      media: { type: 'string', description: 'Workspace path to an image/video (required for Instagram)' },
      kind: { type: 'string', enum: ['image', 'video', 'reels', 'stories'], description: 'Instagram media kind (default image)' },
      schedule_at: { type: 'string', description: 'ISO datetime with a UTC offset to schedule; omit to post now' },
    },
    required: ['platform'],
  },
  modes: ['chat', 'code'],
  summarize: (a) => `publish to ${String(a.platform ?? 'social')}`,
  async run(args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: social posting is organization-scoped; this session has no organization.';
    const targets = platforms(String(args.platform ?? 'facebook'));
    const caption = args.caption ? String(args.caption) : null;
    const kind = String(args.kind ?? 'image');
    let mediaPath: string | null = null;
    if (args.media) {
      const abs = resolveInWorkspace(ctx.repoDir, String(args.media));
      if (!fs.existsSync(abs)) return `Error: media file "${args.media}" not found in the workspace.`;
      mediaPath = abs;
    }
    if (targets.includes('instagram') && !mediaPath) return 'Error: Instagram posts require an image or video (set "media").';
    if (!caption && !mediaPath) return 'Error: a post needs a caption or media.';

    let scheduledAt: number | null = null;
    if (args.schedule_at) {
      scheduledAt = parseWhen(String(args.schedule_at));
      if (!scheduledAt) return 'Error: schedule_at must be an ISO datetime WITH a UTC offset, e.g. 2026-07-10T09:00:00+04:00.';
      if (scheduledAt < Date.now() - 60_000) return 'Error: schedule_at is in the past.';
    }

    const creds = scheduledAt ? null : await resolveSocialCreds(orgId);
    if (!scheduledAt && !creds) return needCreds('Facebook/Instagram is not connected.');

    const lines: string[] = [];
    for (const platform of targets) {
      const post = await createSocialPost({
        orgId, platform, kind: platform === 'instagram' ? kind : 'post', caption, mediaPath,
        status: scheduledAt ? 'scheduled' : 'draft', scheduledAt,
      });
      if (scheduledAt) {
        lines.push(`📅 ${platform}: scheduled for ${new Date(scheduledAt).toISOString()}.`);
      } else {
        const out = await executeSocialPost(post, creds!);
        lines.push(out.status === 'published'
          ? `✅ ${platform}: published${out.permalink ? ` — ${out.permalink}` : ''}.`
          : `⚠ ${platform}: ${out.error || 'failed'}.`);
      }
    }
    return lines.join('\n');
  },
};

export const planCalendarTool: ToolDef = {
  name: 'plan_content_calendar',
  description:
    'Turn a brief into a proposed content calendar (a dated set of post specs) to review BEFORE ' +
    'anything is created. Returns a JSON plan: for each item a platform, a suggested date/time, a ' +
    'hook, the caption, and a one-line creative brief (what image/video to make). Writes nothing — ' +
    'you then generate each creative and call publish_post with schedule_at to commit the ones you want.',
  parameters: {
    type: 'object',
    properties: {
      brief: { type: 'string', description: 'What the campaign is about, audience, tone, key messages' },
      count: { type: 'number', description: 'How many posts to plan (default 5)' },
      platforms: { type: 'string', enum: ['facebook', 'instagram', 'both'], description: 'default both' },
    },
    required: ['brief'],
  },
  modes: ['chat', 'code'],
  summarize: () => 'plan a content calendar',
  async run(args: any): Promise<string> {
    // Deterministic scaffold the model fills in — keeps the plan structured and reviewable.
    const n = Math.max(1, Math.min(30, Number(args.count) || 5));
    const plats = String(args.platforms ?? 'both');
    return (
      `Draft a content calendar of ${n} posts for ${plats} from this brief and return it as a JSON ` +
      `array. Each item: {"day": <1-${n}>, "platform": "facebook"|"instagram", "time": "HH:MM", ` +
      `"hook": "...", "caption": "...", "creative_brief": "what image/video to make (text-free)", ` +
      `"hashtags": ["..."]}. Vary the angle per post (education / proof / offer / behind-the-scenes / ` +
      `question). Brief: ${String(args.brief).slice(0, 1200)}\n\n` +
      `Present the calendar to the owner for approval. Once approved, generate each creative and call ` +
      `publish_post with schedule_at (ISO + UTC offset) to schedule the approved posts.`
    );
  },
};

export const listPostsTool: ToolDef = {
  name: 'list_posts',
  description: 'List this organization\'s recent social posts (scheduled + published) with their status and permalinks.',
  parameters: {
    type: 'object',
    properties: { status: { type: 'string', enum: ['scheduled', 'published', 'failed', 'draft'] }, limit: { type: 'number' } },
  },
  modes: ['chat', 'code', 'report'],
  summarize: () => 'list social posts',
  async run(args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: organization-scoped.';
    const posts = await listSocialPosts(orgId, { status: args.status, limit: Number(args.limit) || 30 });
    if (!posts.length) return 'No social posts yet.';
    return posts
      .map((p) => `${p.status.toUpperCase()} · ${p.platform} · ${p.scheduledAt ? new Date(p.scheduledAt).toISOString().slice(0, 16) : new Date(p.createdAt).toISOString().slice(0, 16)}${p.permalink ? ` · ${p.permalink}` : ''}${p.error ? ` · ${p.error}` : ''} — ${(p.caption || '').slice(0, 60)}`)
      .join('\n');
  },
};
