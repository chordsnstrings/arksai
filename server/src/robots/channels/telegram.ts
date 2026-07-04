import fs from 'node:fs';
import path from 'node:path';
import { getChannelState, setChannelState } from './store';
import type { ChannelAdapter, ChannelInbound, ChannelWithSecrets } from './types';

/**
 * Telegram Bot API adapter — the webhook-free channel. The robot's own bot (token from
 * @BotFather) is long-polled from OUR side via getUpdates on the poller tick, so no public
 * endpoint, no signature dance. Files deliver natively via sendDocument.
 *
 * Verified shapes (Bot API, stable): getMe → {ok,result:{username}}; getUpdates?offset= →
 * {ok,result:[{update_id, message:{message_id, from:{id,first_name,last_name,username},
 * chat:{id,type}, date, text}}]}; sendMessage {chat_id,text}; sendDocument multipart.
 * NOTE: api.telegram.org is unreachable from the DEV sandbox (proxy 403) — tests inject
 * fetch; the droplet has open egress.
 */

const TIMEOUT_MS = 20_000;
const MAX_TEXT = 4096;

// Injectable fetch so unit tests run without egress.
let httpFetch: typeof fetch = fetch;
export function __setTelegramFetch(f: typeof fetch): void {
  httpFetch = f;
}

function api(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(token: string, method: string, body?: any): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await httpFetch(api(token, method), {
      method: 'POST',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!data?.ok) {
      throw new Error(`Telegram ${method}: ${data?.description || `HTTP ${res.status}`}`);
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

function tokenOf(ch: ChannelWithSecrets): string {
  const t = ch.secrets.botToken || '';
  if (!t) throw new Error('No Telegram bot token is stored for this robot.');
  return t;
}

export const telegramAdapter: ChannelAdapter = {
  kind: 'telegram',

  async verify(ch) {
    try {
      const me = await call(tokenOf(ch), 'getMe');
      return { ok: true, detail: `Connected as @${me?.username || 'bot'}` };
    } catch (e: any) {
      return { ok: false, detail: e?.message ?? String(e) };
    }
  },

  async send(ch, to, text) {
    const token = tokenOf(ch);
    // Telegram caps a message at 4096 chars — split on paragraph boundaries.
    let rest = text;
    while (rest.length) {
      let part = rest.slice(0, MAX_TEXT);
      if (rest.length > MAX_TEXT) {
        const cut = part.lastIndexOf('\n');
        if (cut > MAX_TEXT / 2) part = part.slice(0, cut);
      }
      rest = rest.slice(part.length).replace(/^\n+/, '');
      await call(token, 'sendMessage', { chat_id: to, text: part });
    }
  },

  async sendFile(ch, to, filePath, caption) {
    const token = tokenOf(ch);
    const form = new FormData();
    form.set('chat_id', to);
    if (caption) form.set('caption', caption.slice(0, 1024));
    const buf = fs.readFileSync(filePath);
    form.set('document', new Blob([new Uint8Array(buf)]), path.basename(filePath));
    await call(token, 'sendDocument', form);
  },

  async fetchInbound(ch) {
    const token = tokenOf(ch);
    const robotId = ch.channel.robotId;
    const state = await getChannelState(robotId, 'telegram');
    const offset = Number(state.offset || 0);
    const updates: any[] = await call(token, 'getUpdates', {
      offset: offset || undefined,
      timeout: 0,
      allowed_updates: ['message'],
    });
    if (!Array.isArray(updates) || !updates.length) return [];
    // Advance the cursor past everything we saw (even non-text) so nothing replays forever.
    const maxId = Math.max(...updates.map((u) => Number(u.update_id) || 0));
    await setChannelState(robotId, 'telegram', { ...state, offset: maxId + 1 });
    const inbound: ChannelInbound[] = [];
    for (const u of updates) {
      const m = u?.message;
      if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
      if (m.from?.is_bot) continue; // never converse with other bots (loop guard)
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || null;
      inbound.push({
        id: `tg-${m.chat?.id}-${m.message_id}`,
        from: String(m.chat?.id ?? ''),
        fromName: name,
        text: m.text.trim(),
        ts: (Number(m.date) || 0) * 1000 || Date.now(),
      });
    }
    return inbound.filter((m) => m.from);
  },
};
