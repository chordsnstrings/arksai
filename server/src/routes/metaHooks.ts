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
 *   - POST /api/hooks/meta  — inbound comments/messages; routed to the robot by the Page id
 *     (FB) or IG user id; authenticated via X-Hub-Signature-256 (HMAC-SHA256 of the raw body
 *     with the channel's app secret) whenever a secret is stored.
 * Always returns 200 fast and NEVER throws — a webhook error must not trigger a retry storm.
 */

async function robotFor(robotId: string): Promise<any | null> {
  const robot = await getRobot(robotId);
  return robot && robot.status === 'active' ? robot : null;
}

/** Pure: turn one Meta webhook entry into inbound comment messages (unit-tested). */
export function parseMetaEntry(object: string, entry: any, selfIds: Set<string>): ChannelInbound[] {
  const out: ChannelInbound[] = [];
  const push = (kind: 'ig_c' | 'fb_c', id: string, text: string, fromId: string, fromName: string | null, ts: number) => {
    if (!id || selfIds.has(fromId)) return; // never reply to our own comment
    if (!text.trim()) return;
    out.push({ id, from: metaAddr(kind, id), fromName, text, ts });
  };
  // Facebook Page feed changes (comments on a Page post).
  if (object === 'page') {
    for (const ch of entry?.changes || []) {
      const v = ch?.value;
      if (ch?.field !== 'feed' || v?.item !== 'comment' || v?.verb === 'remove') continue;
      push('fb_c', String(v.comment_id || ''), String(v.message || ''), String(v.from?.id || ''), v.from?.name ? String(v.from.name) : null, (Number(v.created_time) || 0) * 1000 || Date.now());
    }
  }
  // Instagram comments.
  if (object === 'instagram') {
    for (const ch of entry?.changes || []) {
      const v = ch?.value;
      if (ch?.field !== 'comments') continue;
      push('ig_c', String(v.id || ''), String(v.text || ''), String(v.from?.id || ''), v.from?.username ? String(v.from.username) : null, Date.now());
    }
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
