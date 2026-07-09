import type { ChannelAdapter, ChannelVerifyResult, ChannelWithSecrets } from './types';

/**
 * META channel adapter (Facebook Page + Instagram) — the "Engage" track. A Page/IG is just
 * another robot channel: inbound comments/DMs arrive on OUR webhook (routes/metaHooks.ts) and
 * flow through the SAME reply engine as email/Telegram/WhatsApp; this adapter posts the reply
 * back to the right surface.
 *
 * The reply TARGET is encoded in the channel-native `to` address so the generic ChannelAdapter
 * interface (send(ch, to, text)) stays intact and the draft's locked-recipient guarantee holds:
 *   ig_c:<comment-id>   → reply under an Instagram comment
 *   fb_c:<comment-id>   → reply under a Facebook Page comment
 *   ig_dm:<igsid>       → Instagram Direct message
 *   fb_dm:<psid>        → Facebook Messenger message
 *
 * Secrets (per robot, encrypted): pageAccessToken, appSecret (webhook HMAC).
 * meta (non-secret): pageId, igUserId, pageName.
 * Shapes verified against Meta Graph/Instagram Platform docs, 2026-07.
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;
const TIMEOUT_MS = 20_000;

let httpFetch: typeof fetch = fetch;
export function __setMetaChannelFetch(f: typeof fetch): void {
  httpFetch = f;
}

export type MetaTargetKind = 'ig_c' | 'fb_c' | 'ig_dm' | 'fb_dm';
export interface MetaTarget {
  kind: MetaTargetKind;
  id: string;
}

/** Build the channel-native `to` address for a reply target. */
export function metaAddr(kind: MetaTargetKind, id: string): string {
  return `${kind}:${id}`;
}

/** Parse a `to` address back into a target (null when malformed). */
export function parseMetaAddr(addr: string): MetaTarget | null {
  const m = /^(ig_c|fb_c|ig_dm|fb_dm):(.+)$/.exec(String(addr || ''));
  return m ? { kind: m[1] as MetaTargetKind, id: m[2] } : null;
}

function pageToken(ch: ChannelWithSecrets): string {
  const t = ch.secrets.pageAccessToken || '';
  if (!t) throw new Error('Meta channel needs a Page access token.');
  return t;
}

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
    if (!res.ok || data?.error) throw new Error(`Meta send: ${data?.error?.message || `HTTP ${res.status}`}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Post the reply payload for a given target kind. Pure builder for the URL+body (unit-tested). */
export function replyRequest(target: MetaTarget, igUserId: string, pageId: string, text: string): { url: string; body: Record<string, any> } {
  switch (target.kind) {
    case 'ig_c':
      return { url: `${target.id}/replies`, body: { message: text } };
    case 'fb_c':
      return { url: `${target.id}/comments`, body: { message: text } };
    case 'ig_dm':
      // Instagram messaging goes through the linked IG user id.
      return { url: `${igUserId}/messages`, body: { recipient: { id: target.id }, message: { text } } };
    case 'fb_dm':
      return { url: `${pageId}/messages`, body: { recipient: { id: target.id }, message: { text }, messaging_type: 'RESPONSE' } };
  }
}

/** Hide/unhide a comment (spam moderation). */
export async function setCommentHidden(ch: ChannelWithSecrets, commentId: string, hidden: boolean): Promise<void> {
  await graphPost(`${commentId}`, pageToken(ch), { hide: hidden });
}

export const metaAdapter: ChannelAdapter = {
  kind: 'meta',

  async verify(ch: ChannelWithSecrets): Promise<ChannelVerifyResult> {
    const token = ch.secrets.pageAccessToken || '';
    const pageId = ch.channel.meta.pageId || '';
    if (!token || !pageId) return { ok: false, detail: 'Add a Page id and Page access token.' };
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      const res = await httpFetch(`${GRAPH}/${pageId}?fields=name&access_token=${encodeURIComponent(token)}`, { signal: ac.signal });
      clearTimeout(timer);
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) return { ok: false, detail: data?.error?.message || `HTTP ${res.status}` };
      return { ok: true, detail: `Connected to Page "${data.name || pageId}".` };
    } catch (e: any) {
      return { ok: false, detail: e?.message ?? String(e) };
    }
  },

  async send(ch: ChannelWithSecrets, to: string, text: string): Promise<void> {
    const target = parseMetaAddr(to);
    if (!target) throw new Error(`Meta channel: unrecognized reply target "${to}".`);
    const { url, body } = replyRequest(target, ch.channel.meta.igUserId || '', ch.channel.meta.pageId || '', text);
    await graphPost(url, pageToken(ch), body);
  },
};
