import type { ChannelAdapter, ChannelWithSecrets } from './types';

/**
 * WhatsApp Cloud API (Meta) adapter. Send = POST graph.facebook.com/<ver>/<phone_number_id>/
 * messages; inbound arrives on OUR public webhook (routes/robotHooks.ts) — Meta POSTs
 * entry[].changes[].value.messages[], authenticated via X-Hub-Signature-256 (HMAC-SHA256 of
 * the raw body with the app secret) when one is stored. Documents deliver by PUBLIC LINK
 * (type:'document', document:{link,filename,caption}) — we mint short-lived token URLs.
 *
 * Setup (per robot): a Meta business app with WhatsApp, the phone number id, a permanent
 * access token, a self-chosen verify token (echoed in the webhook handshake), and optionally
 * the app secret for signature checks. Shapes verified against Meta's docs 2026-07.
 */

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v22.0';
const TIMEOUT_MS = 20_000;

let httpFetch: typeof fetch = fetch;
export function __setWhatsappFetch(f: typeof fetch): void {
  httpFetch = f;
}

function creds(ch: ChannelWithSecrets): { token: string; phoneId: string } {
  const token = ch.secrets.accessToken || '';
  const phoneId = ch.channel.meta.phoneNumberId || '';
  if (!token || !phoneId) throw new Error('WhatsApp needs an access token and a phone number id.');
  return { token, phoneId };
}

async function graphPost(token: string, phoneId: string, payload: any): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await httpFetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: ac.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`WhatsApp send: ${data?.error?.message || `HTTP ${res.status}`}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const whatsappAdapter: ChannelAdapter = {
  kind: 'whatsapp',

  async verify(ch) {
    // Read the phone number object — a cheap authenticated call that proves token + id.
    try {
      const { token, phoneId } = creds(ch);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        const res = await httpFetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}?fields=display_phone_number,verified_name`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, detail: data?.error?.message || `HTTP ${res.status}` };
        return { ok: true, detail: `Connected: ${data?.verified_name || ''} ${data?.display_phone_number || phoneId}`.trim() };
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      return { ok: false, detail: e?.message ?? String(e) };
    }
  },

  async send(ch, to, text) {
    const { token, phoneId } = creds(ch);
    // WhatsApp caps text at 4096 chars.
    await graphPost(token, phoneId, { to, type: 'text', text: { body: text.slice(0, 4096) } });
  },

  // Documents go by PUBLIC LINK — the caller passes a minted short-lived URL as `filePath`
  // when it starts with http(s); a raw local path can't be delivered on this channel.
  async sendFile(ch, to, fileUrlOrPath, caption) {
    const { token, phoneId } = creds(ch);
    if (!/^https?:\/\//i.test(fileUrlOrPath)) {
      throw new Error('WhatsApp document delivery needs a public URL (minted file link), not a local path.');
    }
    const filename = decodeURIComponent(fileUrlOrPath.split('/').pop() || 'file').split('?')[0];
    await graphPost(token, phoneId, {
      to,
      type: 'document',
      document: { link: fileUrlOrPath, filename, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
    });
  },
};
