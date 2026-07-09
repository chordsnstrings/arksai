/**
 * ORGANIC PUBLISHING layer (Track A) — post to a Facebook Page + Instagram. Pure request
 * builders (unit-tested) + thin I/O. Facebook posts in one call; Instagram is the documented
 * 2-step container→publish flow and needs a PUBLIC media URL (we host workspace files via the
 * robot-file mint). Shapes verified against Meta Pages / Instagram Platform docs, 2026-07.
 *
 * Credentials are a Page access token + pageId (+ igUserId for Instagram) — resolved from the
 * org's connected `meta` robot channel by resolveSocialCreds().
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;
const TIMEOUT_MS = 30_000;

/** Instagram hard limit: 25 published items per rolling 24 h (Reels/Stories/carousels count;
 *  a carousel = 1). We enforce it before spending a publish. */
export const IG_DAILY_PUBLISH_LIMIT = 25;

let httpFetch: typeof fetch = fetch;
export function __setPublishFetch(f: typeof fetch): void {
  httpFetch = f;
}

export interface SocialCreds {
  pageToken: string;
  pageId: string;
  igUserId: string;
}

export type IgKind = 'image' | 'video' | 'reels' | 'stories';

// ---- pure request builders ----

/** Facebook Page post. A photo post uses /photos with url; a text/link post uses /feed. */
export function fbPostRequest(pageId: string, p: { message?: string; link?: string; imageUrl?: string; scheduledAtSec?: number }): { url: string; body: Record<string, any> } {
  const body: Record<string, any> = {};
  if (p.message) body.message = p.message;
  if (p.scheduledAtSec) {
    body.published = false;
    body.scheduled_publish_time = p.scheduledAtSec;
  }
  if (p.imageUrl) {
    body.url = p.imageUrl; // /photos takes the image by url, caption via `message`
    return { url: `${pageId}/photos`, body };
  }
  if (p.link) body.link = p.link;
  return { url: `${pageId}/feed`, body };
}

/** Step 1: create an Instagram media container. */
export function igContainerRequest(igUserId: string, p: { mediaUrl: string; caption?: string; kind: IgKind }): { url: string; body: Record<string, any> } {
  const body: Record<string, any> = {};
  if (p.kind === 'video' || p.kind === 'reels') body.video_url = p.mediaUrl;
  else body.image_url = p.mediaUrl;
  if (p.kind === 'reels') body.media_type = 'REELS';
  else if (p.kind === 'stories') body.media_type = 'STORIES';
  if (p.caption && p.kind !== 'stories') body.caption = p.caption;
  return { url: `${igUserId}/media`, body };
}

/** Step 2: publish a created container. */
export function igPublishRequest(igUserId: string, creationId: string): { url: string; body: Record<string, any> } {
  return { url: `${igUserId}/media_publish`, body: { creation_id: creationId } };
}

/** True when another IG publish is allowed given recent publish timestamps (rolling 24 h). */
export function igPublishAllowed(recentPublishMs: number[], now: number): boolean {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return recentPublishMs.filter((t) => t > dayAgo).length < IG_DAILY_PUBLISH_LIMIT;
}

// ---- I/O ----

async function graphPost(url: string, token: string, body: Record<string, any>): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await httpFetch(`${GRAPH}/${url}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Publish (or schedule) a Facebook Page post. Returns the new post id + permalink. */
export async function publishFacebook(
  creds: SocialCreds,
  p: { message?: string; link?: string; imageUrl?: string; scheduledAtSec?: number },
): Promise<{ id: string; permalink: string | null }> {
  const { url, body } = fbPostRequest(creds.pageId, p);
  const r = await graphPost(url, creds.pageToken, body);
  const id = String(r.post_id || r.id || '');
  return { id, permalink: id ? `https://www.facebook.com/${id}` : null };
}

/** Publish an Instagram post (2-step). Caller must have checked igPublishAllowed. */
export async function publishInstagram(
  creds: SocialCreds,
  p: { mediaUrl: string; caption?: string; kind: IgKind },
): Promise<{ id: string; permalink: string | null }> {
  const c = igContainerRequest(creds.igUserId, p);
  const created = await graphPost(c.url, creds.pageToken, c.body);
  const creationId = String(created.id || '');
  if (!creationId) throw new Error('Instagram container creation returned no id.');
  const pub = igPublishRequest(creds.igUserId, creationId);
  const published = await graphPost(pub.url, creds.pageToken, pub.body);
  const id = String(published.id || '');
  let permalink: string | null = null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const res = await httpFetch(`${GRAPH}/${id}?fields=permalink&access_token=${encodeURIComponent(creds.pageToken)}`, { signal: ac.signal });
    clearTimeout(timer);
    const d: any = await res.json().catch(() => ({}));
    permalink = d?.permalink || null;
  } catch {
    /* permalink is best-effort */
  }
  return { id, permalink };
}
