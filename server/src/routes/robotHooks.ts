import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getRobot } from '../robots/store';
import { channelSecrets, listEnabledChannelsByKind } from '../robots/channels/store';
import { handleChannelInbound } from '../robots/channels/inbound';
import type { ChannelInbound } from '../robots/channels/types';

/**
 * PUBLIC webhook endpoints for the push-based robot channels (auth-allowlisted in auth.ts —
 * the caller is Meta / SMSALA, not a logged-in user):
 *
 *  - GET  /api/hooks/whatsapp      — Meta's verify handshake: echo hub.challenge when the
 *    hub.verify_token matches ANY enabled WhatsApp channel's stored verifyToken.
 *  - POST /api/hooks/whatsapp      — inbound messages; routed to the robot by
 *    metadata.phone_number_id; authenticated via X-Hub-Signature-256 (HMAC-SHA256 of the raw
 *    body with the channel's app secret) whenever an app secret is stored.
 *  - GET/POST /api/hooks/sms/:hookKey — SMSALA two-way inbound (ChannelNumber / MessageText /
 *    IncomingNumber, GET query or POST body). SMSALA signs nothing, so the per-channel random
 *    hookKey in the URL is the gate; ChannelNumber must also match when configured.
 *
 * Every handler returns 200 fast and NEVER throws — a webhook error must not make the
 * provider retry-storm us. Real processing failures are logged + surfaced as escalations.
 */

async function robotFor(channel: { robotId: string }): Promise<any | null> {
  const robot = await getRobot(channel.robotId);
  return robot && robot.status === 'active' ? robot : null;
}

export function registerRobotHookRoutes(app: FastifyInstance) {
  // ---- WhatsApp Cloud (Meta) ----
  app.get('/api/hooks/whatsapp', async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const mode = qs['hub.mode'];
    const token = qs['hub.verify_token'] || '';
    const challenge = qs['hub.challenge'] || '';
    if (mode !== 'subscribe' || !token) return reply.code(403).send('forbidden');
    const channels = await listEnabledChannelsByKind('whatsapp').catch(() => []);
    const match = channels.find((c) => c.meta.verifyToken && c.meta.verifyToken === token);
    if (!match) return reply.code(403).send('forbidden');
    return reply.type('text/plain').send(challenge);
  });

  app.post('/api/hooks/whatsapp', async (req, reply) => {
    // Always 200 quickly; process best-effort.
    reply.send({ ok: true });
    try {
      const body: any = req.body || {};
      if (body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return;
      for (const entry of body.entry) {
        for (const change of entry?.changes || []) {
          const value = change?.value;
          if (change?.field !== 'messages' || !value) continue;
          const phoneId = String(value?.metadata?.phone_number_id || '');
          const messages = Array.isArray(value.messages) ? value.messages : [];
          if (!phoneId || !messages.length) continue; // status updates etc.
          const channels = await listEnabledChannelsByKind('whatsapp').catch(() => []);
          const chan = channels.find((c) => c.meta.phoneNumberId === phoneId);
          if (!chan) continue;
          const secrets = await channelSecrets(chan.robotId, 'whatsapp');
          // Signature check when an app secret is stored (recommended). A stored secret with
          // a BAD/missing signature → drop (spoofed); no secret → accept (hook URL privacy).
          if (secrets.appSecret) {
            const sig = String(req.headers['x-hub-signature-256'] || '');
            const raw = (req as any).rawBody as string | undefined;
            if (!sig.startsWith('sha256=') || !raw) {
              console.warn('[hooks/whatsapp] missing signature/raw body — dropped');
              continue;
            }
            const expected = createHmac('sha256', secrets.appSecret).update(raw).digest('hex');
            const got = sig.slice('sha256='.length);
            const a = Buffer.from(expected, 'hex');
            const b = /^[0-9a-f]+$/i.test(got) && got.length === expected.length ? Buffer.from(got, 'hex') : null;
            if (!b || !timingSafeEqual(a, b)) {
              console.warn('[hooks/whatsapp] BAD signature — dropped');
              continue;
            }
          }
          const robot = await robotFor(chan);
          if (!robot) continue;
          const names = new Map<string, string>();
          for (const c of value.contacts || []) {
            if (c?.wa_id) names.set(String(c.wa_id), String(c?.profile?.name || ''));
          }
          for (const m of messages) {
            if (m?.type !== 'text' || !m?.text?.body) continue;
            const inbound: ChannelInbound = {
              id: String(m.id || `wa-${m.from}-${m.timestamp}`),
              from: String(m.from || ''),
              fromName: names.get(String(m.from)) || null,
              text: String(m.text.body),
              ts: (Number(m.timestamp) || 0) * 1000 || Date.now(),
            };
            if (!inbound.from || !inbound.text.trim()) continue;
            await handleChannelInbound(robot, { channel: chan, secrets }, inbound);
          }
        }
      }
    } catch (e: any) {
      console.error('[hooks/whatsapp]', e?.message ?? e);
    }
  });

  // ---- SMS (SMSALA two-way) ----
  const smsHandler = async (req: any, reply: any) => {
    reply.send('OK');
    try {
      const hookKey = String(req.params?.hookKey || '');
      if (!hookKey) return;
      const p = { ...(req.query as any), ...((typeof req.body === 'object' && req.body) || {}) };
      const text = String(p.MessageText ?? p.messagetext ?? '').trim();
      const from = String(p.IncomingNumber ?? p.incomingnumber ?? '').trim();
      const channelNumber = String(p.ChannelNumber ?? p.channelnumber ?? '').trim();
      if (!text || !from) return;
      const channels = await listEnabledChannelsByKind('sms').catch(() => []);
      const chan = channels.find((c) => c.meta.hookKey === hookKey);
      if (!chan) {
        console.warn('[hooks/sms] unknown hook key — dropped');
        return;
      }
      // When the channel has a configured two-way number, require it to match.
      if (chan.meta.channelNumber && channelNumber && chan.meta.channelNumber !== channelNumber) {
        console.warn('[hooks/sms] channel number mismatch — dropped');
        return;
      }
      const robot = await robotFor(chan);
      if (!robot) return;
      const secrets = await channelSecrets(chan.robotId, 'sms');
      const inbound: ChannelInbound = {
        // SMSALA sends no message id — dedupe on number+text+minute bucket so a provider
        // retry doesn't double-draft but two genuinely repeated texts still both land.
        id: `sms-${from}-${Math.floor(Date.now() / 60_000)}-${text.slice(0, 40)}`,
        from,
        fromName: null,
        text,
        ts: Date.now(),
      };
      await handleChannelInbound(robot, { channel: chan, secrets }, inbound);
    } catch (e: any) {
      console.error('[hooks/sms]', e?.message ?? e);
    }
  };
  app.get('/api/hooks/sms/:hookKey', smsHandler);
  app.post('/api/hooks/sms/:hookKey', smsHandler);
}
