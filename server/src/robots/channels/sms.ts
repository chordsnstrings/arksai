import type { ChannelAdapter, ChannelWithSecrets } from './types';

/**
 * SMS adapter — SMSALA first (api.smsala.com, shapes verified against their live docs
 * 2026-07-04), behind a provider seam so Twilio etc. can slot in later (`meta.provider`).
 *
 * Send: POST /api/SendSMS {api_id, api_password, sms_type:'T', encoding, sender_id,
 * phonenumber, textmessage} → {message_id, status:'S'|'F', remarks}. Unicode text auto-
 * selects encoding 'U'. Verify: /api/CheckBalance. Inbound (two-way SMS): SMSALA calls OUR
 * public hook URL (routes/robotHooks.ts) with ChannelNumber/MessageText/IncomingNumber —
 * gated by the per-channel hookKey in the URL (SMSALA signs nothing).
 *
 * GOTCHAS (verified live): the SMSALA account must WHITELIST the caller's IP (the droplet,
 * 159.89.172.210) or every call returns "IP not Whitelisted"; sender_id must be a
 * pre-registered identity. SMS carries no files — deliverables go as a short link.
 */

const BASE = process.env.SMSALA_BASE_URL || 'https://api.smsala.com/api';
const TIMEOUT_MS = 20_000;

let httpFetch: typeof fetch = fetch;
export function __setSmsFetch(f: typeof fetch): void {
  httpFetch = f;
}

function creds(ch: ChannelWithSecrets): { apiId: string; apiPassword: string; senderId: string } {
  const apiId = ch.secrets.apiId || '';
  const apiPassword = ch.secrets.apiPassword || '';
  const senderId = ch.channel.meta.senderId || '';
  if (!apiId || !apiPassword) throw new Error('SMS needs the SMSALA api_id and api_password.');
  if (!senderId) throw new Error('SMS needs a registered sender id.');
  return { apiId, apiPassword, senderId };
}

async function post(path: string, body: any): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await httpFetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`SMSALA ${path}: HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the text needs Unicode SMS encoding (any non-GSM-7-ish char, e.g. Arabic). */
export function needsUnicode(text: string): boolean {
  // Pragmatic superset check: anything outside printable ASCII + the common GSM extras.
  return /[^\x20-\x7E\n\r£¥èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà€]/.test(text);
}

export const smsAdapter: ChannelAdapter = {
  kind: 'sms',

  async verify(ch) {
    try {
      const { apiId, apiPassword } = creds(ch);
      const data = await post('CheckBalance', { api_id: apiId, api_password: apiPassword });
      if (data?.Message && /not whitelisted/i.test(String(data.Message))) {
        return { ok: false, detail: 'SMSALA rejected the call: the server IP must be whitelisted in your SMSALA account (add the ArksAI server IP).' };
      }
      if (data?.BalanceAmount == null) return { ok: false, detail: `Unexpected response: ${JSON.stringify(data).slice(0, 120)}` };
      return { ok: true, detail: `Connected — balance ${data.BalanceAmount} ${data.CurrenceCode || ''}`.trim() };
    } catch (e: any) {
      return { ok: false, detail: e?.message ?? String(e) };
    }
  },

  async send(ch, to, text) {
    const { apiId, apiPassword, senderId } = creds(ch);
    const body = {
      api_id: apiId,
      api_password: apiPassword,
      sms_type: 'T', // transactional — replies/deliveries, never promotional blasts
      encoding: needsUnicode(text) ? 'U' : 'T',
      sender_id: senderId,
      phonenumber: to.replace(/[^\d]/g, ''),
      textmessage: text.slice(0, 1000),
    };
    const data = await post('SendSMS', body);
    if (data?.status !== 'S') {
      throw new Error(`SMSALA send failed: ${data?.remarks || JSON.stringify(data).slice(0, 160)}`);
    }
  },
};
