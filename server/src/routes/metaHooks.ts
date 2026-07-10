import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getRobot } from '../robots/store';
import { channelSecrets, listEnabledChannelsByKind } from '../robots/channels/store';
import { handleChannelInbound } from '../robots/channels/inbound';
import { metaAddr } from '../robots/channels/meta';
import type { ChannelInbound } from '../robots/channels/types';

/**
 * PUBLIC Meta webhook for the social "Engage" track (Facebook Page + Instagram comments/DMs).
 * Auth-allowlisted (the caller is Facebook, not a logged-in user):
 *   - GET  /api/hooks/meta  — verify handshake: echo hub.challenge when hub.verify_token
 *     matches ANY enabled meta channel's stored verifyToken.
 *   - POST /api/hooks/meta  — inbound COMMENTS (entry.changes) AND DIRECT MESSAGES
 *     (entry.messaging — Messenger for a Page, Instagram Direct); routed to the robot by the
 *     Page id (FB) or IG user id; authenticated via X-Hub-Signature-256 (HMAC-SHA256 of the
 *     raw body with the channel's app secret) whenever a secret is stored. Both flow through
 *     the same reply engine; a DM reply is addressed to the sender, a comment reply to the comment.
 * Always returns 200 fast and NEVER throws — a webhook error must not trigger a retry storm.
 */

async function robotFor(robotId: string): Promise<any | null> {
  const robot = await getRobot(robotId);
  return robot && robot.status === 'active' ? robot : null;
}

/** Pure: turn one Meta webhook entry into inbound messages — comments (entry.changes) AND
 *  direct messages (entry.messaging) for both Facebook and Instagram (unit-tested).
 *  `target` is what a reply is addressed to (the comment id, or the DM sender's id); `dedup`
 *  is the idempotency key (comment id, or message mid). */
export function parseMetaEntry(object: string, entry: any, selfIds: Set<string>): ChannelInbound[] {
  const out: ChannelInbound[] = [];
  const add = (
    kind: 'ig_c' | 'fb_c' | 'ig_dm' | 'fb_dm', target: string, dedup: string, text: string,
    fromId: string, fromName: string | null, ts: number, attribution?: { adId?: string; postId?: string },
  ) => {
    if (!target || !dedup || selfIds.has(fromId)) return; // never reply to ourselves
    if (!text.trim()) return;
    out.push({ id: dedup, from: metaAddr(kind, target), fromName, text, ts, adId: attribution?.adId, postId: attribution?.postId });
  };

  // Comments (a reply is addressed to the comment itself → target === dedup === comment id).
  // The post id carries AD ATTRIBUTION: comments on a promoted post map back to the campaign.
  if (object === 'page') {
    for (const ch of entry?.changes || []) {
      const v = ch?.value;
      if (ch?.field !== 'feed' || v?.item !== 'comment' || v?.verb === 'remove') continue;
      const id = String(v.comment_id || '');
      add('fb_c', id, id, String(v.message || ''), String(v.from?.id || ''), v.from?.name ? String(v.from.name) : null,
        (Number(v.created_time) || 0) * 1000 || Date.now(), { postId: v.post_id ? String(v.post_id) : undefined });
    }
  }
  if (object === 'instagram') {
    for (const ch of entry?.changes || []) {
      const v = ch?.value;
      if (ch?.field !== 'comments') continue;
      const id = String(v.id || '');
      add('ig_c', id, id, String(v.text || ''), String(v.from?.id || ''), v.from?.username ? String(v.from.username) : null,
        Date.now(), { postId: v.media?.id ? String(v.media.id) : undefined });
    }
  }

  // Direct messages (Messenger for a Page, Instagram Direct) — arrive in entry.messaging.
  // A reply is addressed to the SENDER (target = sender id); dedup on the message mid.
  // A click-to-message ad delivers a `referral` object ({source:'ADS', ad_id, ads_context_data})
  // on the opening message (or a standalone messaging_referrals event) — that's the ad→DM link.
  const dmKind = object === 'instagram' ? 'ig_dm' : 'fb_dm';
  for (const m of entry?.messaging || []) {
    const senderId = String(m?.sender?.id || '');
    const ref = m?.message?.referral ?? m?.referral ?? m?.postback?.referral;
    const attribution = ref && (String(ref.source || '').toUpperCase() === 'ADS' || ref.ad_id)
      ? { adId: ref.ad_id ? String(ref.ad_id) : undefined, postId: ref.ads_context_data?.post_id ? String(ref.ads_context_data.post_id) : undefined }
      : undefined;
    const msg = m?.message;
    if (!msg || msg.is_echo) continue; // delivery/read receipts + our own outgoing echoes
    add(dmKind, senderId, String(msg.mid || `${dmKind}-${senderId}-${m.timestamp || ''}`), String(msg.text || ''), senderId, null, Number(m.timestamp) || Date.now(), attribution);
  }
  return out;
}

/** Pure: Meta lead field_data → a flat record ({name → joined values}). */
export function leadFieldsToRecord(fieldData: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of Array.isArray(fieldData) ? fieldData : []) {
    const name = String(f?.name || '').trim();
    if (!name) continue;
    out[name] = (Array.isArray(f?.values) ? f.values : []).map(String).join(', ');
  }
  return out;
}

function verifySignature(raw: string | undefined, header: string, appSecret: string): boolean {
  if (!appSecret) return true; // no secret stored → accept (hook-URL privacy, like the WhatsApp hook)
  if (!raw || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  const got = header.slice('sha256='.length);
  if (!/^[0-9a-f]+$/i.test(got) || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(got, 'hex'));
}

export function registerMetaHookRoutes(app: FastifyInstance) {
  app.get('/api/hooks/meta', async (req, reply) => {
    const qs = req.query as Record<string, string>;
    if (qs['hub.mode'] !== 'subscribe' || !qs['hub.verify_token']) return reply.code(403).send('forbidden');
    const channels = await listEnabledChannelsByKind('meta').catch(() => []);
    const ok = channels.some((c) => c.meta.verifyToken && c.meta.verifyToken === qs['hub.verify_token']);
    return ok ? reply.type('text/plain').send(qs['hub.challenge'] || '') : reply.code(403).send('forbidden');
  });

  app.post('/api/hooks/meta', async (req, reply) => {
    reply.send({ ok: true });
    try {
      const body: any = req.body || {};
      const object = String(body.object || '');
      if ((object !== 'page' && object !== 'instagram') || !Array.isArray(body.entry)) return;
      const channels = await listEnabledChannelsByKind('meta').catch(() => []);
      for (const entry of body.entry) {
        const entryId = String(entry?.id || '');
        // Route by Page id (FB) or IG user id (IG).
        const chan = channels.find((c) =>
          object === 'page' ? c.meta.pageId === entryId : c.meta.igUserId === entryId,
        );
        if (!chan) continue;
        const secrets = await channelSecrets(chan.robotId, 'meta');
        if (!verifySignature((req as any).rawBody, String(req.headers['x-hub-signature-256'] || ''), secrets.appSecret || '')) {
          console.warn('[hooks/meta] BAD signature — dropped');
          continue;
        }
        const robot = await robotFor(chan.robotId);
        if (!robot) continue;

        // Lead Ads (leadgen webhook): fetch the submitted fields with the Page token, store
        // idempotently, attribute to the managed campaign, and ping the owner's commanders.
        for (const ch of entry?.changes || []) {
          if (ch?.field !== 'leadgen' || !ch?.value?.leadgen_id) continue;
          const v = ch.value;
          try {
            const { graphGet } = await import('../connectors/metaCampaigns');
            const { recordLead, campaignForAdOrPost } = await import('../robots/socialCampaigns');
            const detail = await graphGet(`${String(v.leadgen_id)}?fields=field_data`, secrets.pageAccessToken || '').catch(() => null);
            const fields = leadFieldsToRecord(detail?.field_data ?? []);
            const hit = v.ad_id ? await campaignForAdOrPost({ adId: String(v.ad_id) }).catch(() => null) : null;
            const fresh = await recordLead({
              orgId: robot.orgId, campaignId: hit?.campaign.id ?? null, leadgenId: String(v.leadgen_id),
              formId: v.form_id ? String(v.form_id) : null, adId: v.ad_id ? String(v.ad_id) : null, fields,
            });
            if (fresh) {
              const { listCommanders } = await import('../robots/tasks');
              const { sendOnChannel } = await import('../robots/outbound');
              const summary = Object.entries(fields).map(([k, val]) => `${k}: ${val}`).join(' · ') || 'details on file';
              const text = `🟢 New lead${hit ? ` from "${hit.campaign.name}"` : ''} — ${summary}`;
              for (const c of (await listCommanders(robot.id).catch(() => [])).filter((c: any) => c.notify)) {
                await sendOnChannel(robot, c.channel, c.address, text).catch(() => {});
              }
            }
          } catch (e: any) {
            console.error('[hooks/meta] leadgen failed:', e?.message ?? e);
          }
        }

        const selfIds = new Set([chan.meta.pageId, chan.meta.igUserId].filter(Boolean));
        for (const inbound of parseMetaEntry(object, entry, selfIds)) {
          await handleChannelInbound(robot, { channel: chan, secrets }, inbound);
        }
      }
    } catch (e: any) {
      console.error('[hooks/meta]', e?.message ?? e);
    }
  });
}
