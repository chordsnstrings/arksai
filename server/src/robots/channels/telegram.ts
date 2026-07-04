import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getChannelState, setChannelState } from './store';
import type { ChannelAdapter, ChannelInbound, ChannelWithSecrets } from './types';
import { MAX_ATTACHMENT_BYTES, classifyMime, mediaTmpDir, type InboundAttachment } from '../media';

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
      if (!m) continue;
      if (m.from?.is_bot) continue; // never converse with other bots (loop guard)
      const text = typeof m.text === 'string' ? m.text.trim() : typeof m.caption === 'string' ? m.caption.trim() : '';
      // Media: photo (largest size), document, voice/audio — downloaded to temp for the
      // describe pipeline. A message with neither text nor supported media is skipped.
      const attachments = await downloadTelegramMedia(token, m).catch((e) => {
        console.error('[telegram media]', e?.message ?? e);
        return [] as InboundAttachment[];
      });
      if (!text && !attachments.length) continue;
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || null;
      inbound.push({
        id: `tg-${m.chat?.id}-${m.message_id}`,
        from: String(m.chat?.id ?? ''),
        fromName: name,
        text,
        ts: (Number(m.date) || 0) * 1000 || Date.now(),
        attachments: attachments.length ? attachments : undefined,
      });
    }
    return inbound.filter((m) => m.from);
  },
};

/** Pull the media out of one Telegram message (photo/document/voice) into temp files. */
async function downloadTelegramMedia(token: string, m: any): Promise<InboundAttachment[]> {
  const wants: { fileId: string; name: string; mime: string; size: number }[] = [];
  if (Array.isArray(m.photo) && m.photo.length) {
    const best = m.photo[m.photo.length - 1]; // sizes are ordered small→large
    wants.push({ fileId: best.file_id, name: 'photo.jpg', mime: 'image/jpeg', size: Number(best.file_size) || 0 });
  }
  if (m.document?.file_id) {
    wants.push({
      fileId: m.document.file_id,
      name: String(m.document.file_name || 'document'),
      mime: String(m.document.mime_type || 'application/octet-stream'),
      size: Number(m.document.file_size) || 0,
    });
  }
  if (m.voice?.file_id) {
    wants.push({ fileId: m.voice.file_id, name: 'voice.ogg', mime: 'audio/ogg', size: Number(m.voice.file_size) || 0 });
  }
  const out: InboundAttachment[] = [];
  for (const w of wants.slice(0, 3)) {
    if (w.size > MAX_ATTACHMENT_BYTES) continue; // describe pipeline reports oversize honestly
    const info = await call(token, 'getFile', { file_id: w.fileId });
    const filePath = info?.file_path;
    if (!filePath) continue;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await httpFetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: ac.signal });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_ATTACHMENT_BYTES) continue;
      const dest = path.join(mediaTmpDir(), `${randomUUID()}-${w.name.replace(/[^\w.\-]+/g, '_')}`);
      fs.writeFileSync(dest, buf);
      out.push({ kind: classifyMime(w.mime, w.name), name: w.name, path: dest, mime: w.mime });
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}
