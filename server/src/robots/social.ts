import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { q, qOne } from '../db';
import { config } from '../config';
import { findChannelForOrg } from './channels/store';
import { mintRobotFileToken } from '../routes/robotFiles';
import {
  publishFacebook, publishInstagram, igPublishAllowed, type SocialCreds, type IgKind,
} from '../connectors/metaPublish';

/**
 * Track A runtime — organic Facebook/Instagram posts. The publish_post tool records a row and
 * (when due / auto) executes it; the scheduler's `social` job publishes due scheduled posts.
 * Instagram media must be a PUBLIC url, so a workspace image is hosted via the robot-file mint.
 */

export type SocialPlatform = 'facebook' | 'instagram';
export type SocialStatus = 'scheduled' | 'published' | 'failed' | 'draft';

export interface SocialPost {
  id: string;
  orgId: string;
  robotId: string | null;
  platform: SocialPlatform;
  kind: string;
  caption: string | null;
  mediaPath: string | null;
  objectId: string | null;
  permalink: string | null;
  status: SocialStatus;
  scheduledAt: number | null;
  publishedAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

function rowToPost(r: any): SocialPost {
  return {
    id: r.id, orgId: r.org_id, robotId: r.robot_id ?? null, platform: r.platform, kind: r.kind,
    caption: r.caption ?? null, mediaPath: r.media_path ?? null, objectId: r.object_id ?? null,
    permalink: r.permalink ?? null, status: r.status, scheduledAt: r.scheduled_at ?? null,
    publishedAt: r.published_at ?? null, error: r.error ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface NewSocialPost {
  orgId: string;
  robotId?: string | null;
  platform: SocialPlatform;
  kind: string;
  caption?: string | null;
  mediaPath?: string | null;
  status: SocialStatus;
  scheduledAt?: number | null;
}

export async function createSocialPost(p: NewSocialPost): Promise<SocialPost> {
  const now = Date.now();
  const id = randomUUID();
  await q(
    `INSERT INTO social_posts(id, org_id, robot_id, platform, kind, caption, media_path, status, scheduled_at, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, p.orgId, p.robotId ?? null, p.platform, p.kind, p.caption ?? null, p.mediaPath ?? null, p.status, p.scheduledAt ?? null, now, now],
  );
  return (await getSocialPost(id))!;
}

export async function getSocialPost(id: string): Promise<SocialPost | null> {
  const r = await qOne('SELECT * FROM social_posts WHERE id = $1', [id]);
  return r ? rowToPost(r) : null;
}

export async function listSocialPosts(orgId: string, opts: { status?: SocialStatus; limit?: number } = {}): Promise<SocialPost[]> {
  const rows = opts.status
    ? await q('SELECT * FROM social_posts WHERE org_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3', [orgId, opts.status, opts.limit ?? 50])
    : await q('SELECT * FROM social_posts WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2', [orgId, opts.limit ?? 50]);
  return rows.map(rowToPost);
}

async function markPublished(id: string, objectId: string, permalink: string | null): Promise<void> {
  await q('UPDATE social_posts SET status=$1, object_id=$2, permalink=$3, published_at=$4, error=NULL, updated_at=$5 WHERE id=$6',
    ['published', objectId, permalink, Date.now(), Date.now(), id]);
}
async function markFailed(id: string, error: string): Promise<void> {
  await q('UPDATE social_posts SET status=$1, error=$2, updated_at=$3 WHERE id=$4', ['failed', error.slice(0, 500), Date.now(), id]);
}

/** Instagram publish timestamps in the last 24 h (backs the 25/day rolling cap). */
export async function recentIgPublishTimes(orgId: string): Promise<number[]> {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const rows = await q<{ published_at: number }>(
    "SELECT published_at FROM social_posts WHERE org_id = $1 AND platform = 'instagram' AND published_at IS NOT NULL AND published_at > $2",
    [orgId, dayAgo],
  );
  return rows.map((r) => r.published_at);
}

/** Resolve the org's Facebook Page + Instagram credentials from its connected meta channel. */
export async function resolveSocialCreds(orgId: string): Promise<SocialCreds | null> {
  const ch = await findChannelForOrg(orgId, 'meta');
  if (!ch) return null;
  const pageToken = ch.secrets.pageAccessToken || '';
  const pageId = ch.channel.meta.pageId || '';
  const igUserId = ch.channel.meta.igUserId || '';
  if (!pageToken || !pageId) return null;
  return { pageToken, pageId, igUserId };
}

/** Host a workspace media file at a public URL (Instagram requires one). */
function publicMediaUrl(mediaPath: string): string {
  if (/^https?:\/\//.test(mediaPath)) return mediaPath;
  return `${config.publicBaseUrl.replace(/\/$/, '')}/api/robot-file/${mintRobotFileToken(mediaPath)}`;
}

/** Execute ONE post now (used by the tool on immediate publish + the scheduler when due). */
export async function executeSocialPost(post: SocialPost, creds: SocialCreds): Promise<SocialPost> {
  try {
    if (post.platform === 'instagram') {
      if (!creds.igUserId) throw new Error('No Instagram account is linked to this Page.');
      if (!post.mediaPath) throw new Error('Instagram posts require an image or video.');
      if (!igPublishAllowed(await recentIgPublishTimes(post.orgId), Date.now())) {
        throw new Error('Instagram 25-posts/24h limit reached — try later.');
      }
      const mediaUrl = /^https?:\/\//.test(post.mediaPath) ? post.mediaPath : publicMediaUrl(post.mediaPath);
      const kind = (post.kind as IgKind) || 'image';
      const r = await publishInstagram(creds, { mediaUrl, caption: post.caption ?? undefined, kind });
      await markPublished(post.id, r.id, r.permalink);
    } else {
      const imageUrl = post.mediaPath ? publicMediaUrl(post.mediaPath) : undefined;
      const r = await publishFacebook(creds, { message: post.caption ?? undefined, imageUrl });
      await markPublished(post.id, r.id, r.permalink);
    }
  } catch (e: any) {
    await markFailed(post.id, e?.message ?? String(e));
  }
  return (await getSocialPost(post.id))!;
}

/** Scheduler entry point: publish every due scheduled post across orgs (never throws). */
export async function publishDueSocialPosts(now = Date.now()): Promise<number> {
  let published = 0;
  const due = (await q('SELECT * FROM social_posts WHERE status = $1 AND scheduled_at IS NOT NULL AND scheduled_at <= $2 ORDER BY scheduled_at LIMIT 25', ['scheduled', now])).map(rowToPost);
  const credsByOrg = new Map<string, SocialCreds | null>();
  for (const post of due) {
    try {
      if (post.mediaPath && !/^https?:\/\//.test(post.mediaPath) && !fs.existsSync(post.mediaPath)) {
        await markFailed(post.id, 'media file no longer exists');
        continue;
      }
      if (!credsByOrg.has(post.orgId)) credsByOrg.set(post.orgId, await resolveSocialCreds(post.orgId));
      const creds = credsByOrg.get(post.orgId) || null;
      if (!creds) {
        await markFailed(post.id, 'Facebook/Instagram not connected for this org');
        continue;
      }
      const out = await executeSocialPost(post, creds);
      if (out.status === 'published') published++;
    } catch (e: any) {
      await markFailed(post.id, e?.message ?? String(e)).catch(() => {});
    }
  }
  return published;
}
