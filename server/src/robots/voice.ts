import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { byteplusConfigured, byteplusKey } from '../agent/byteplusRuntime';

/**
 * Voice-note TRANSCRIPTION for the robot channels — the missing half of "voice commands".
 *
 * Engine: BytePlus ModelArk multimodal chat — `seed-2-0-mini` accepts an `input_audio`
 * content part on our EXISTING ARK key (probe-validated 2026-07-04: a real clip returned
 * 200 and the model demonstrably heard it). No new service, no new credentials.
 *
 * Pipeline: ogg/opus (Telegram/WhatsApp voice) → ffmpeg → 16k mono mp3 → base64 →
 * chat completion with a strict verbatim-transcription instruction. Bounded (≤5MB audio,
 * 60s timeout), honest failures ({ok:false} — the caller keeps the "can't listen" note),
 * language preserved (Arabic stays Arabic).
 */

const ASR_MODEL = process.env.ROBOT_ASR_MODEL || 'seed-2-0-mini-260428';
const ASR_TIMEOUT_MS = Number(process.env.ROBOT_ASR_TIMEOUT_MS || '60000') || 60_000;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
const NO_SPEECH = '[no speech]';

export interface TranscribeResult {
  ok: boolean;
  /** Verbatim transcript (empty when the clip had no discernible speech). */
  text?: string;
  /** True when the clip was heard but contained no speech (music/noise/silence). */
  noSpeech?: boolean;
  error?: string;
}

let httpFetch: typeof fetch = fetch;
export function __setVoiceFetch(f: typeof fetch): void {
  httpFetch = f;
}

export function voiceAvailable(): boolean {
  // The ark key may live in env OR the encrypted app_settings (Admin → Keys) — the runtime
  // cache covers both. Reading config.byteplusApiKey directly here missed the DB-backed key
  // the droplet actually uses (caught live: /api/voice/capabilities said asr:false).
  return byteplusConfigured();
}

/** Convert any audio container ffmpeg understands into a small 16k mono mp3. */
async function toMp3(absPath: string): Promise<string> {
  const out = path.join(os.tmpdir(), `asr-${randomUUID()}.mp3`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-i', absPath, '-ar', '16000', '-ac', '1', '-b:a', '48k', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`ffmpeg unavailable: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-200)}`))));
  });
  return out;
}

const ARK_CHAT_URL = () => `${(process.env.BYTEPLUS_VIDEO_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '')}/chat/completions`;

/** Transcribe one voice note. Never throws. */
export async function transcribeAudio(absPath: string, signal: AbortSignal): Promise<TranscribeResult> {
  if (!voiceAvailable()) return { ok: false, error: 'no transcription engine configured' };
  let mp3: string | null = null;
  try {
    const st = fs.statSync(absPath);
    if (!st.size) return { ok: false, error: 'empty audio file' };
    if (st.size > MAX_VOICE_BYTES) return { ok: false, error: 'voice note too large to transcribe' };
    // Already-mp3 files skip conversion; everything else (ogg/opus/m4a/wav) goes through ffmpeg.
    const isMp3 = /\.mp3$/i.test(absPath);
    const audioPath = isMp3 ? absPath : (mp3 = await toMp3(absPath));
    const b64 = fs.readFileSync(audioPath).toString('base64');

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), ASR_TIMEOUT_MS);
    try {
      const res = await httpFetch(ARK_CHAT_URL(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${byteplusKey()}`, 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          model: ASR_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'input_audio', input_audio: { data: b64, format: 'mp3' } },
                {
                  type: 'text',
                  text:
                    'Transcribe this voice message VERBATIM, in its original language (keep Arabic as Arabic, ' +
                    `etc.). Output ONLY the spoken words — no commentary, no translation. If there is no speech, reply exactly: ${NO_SPEECH}`,
                },
              ],
            },
          ],
          max_tokens: 1200,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message || `ASR HTTP ${res.status}` };
      const text = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!text) return { ok: false, error: 'empty transcription response' };
      if (text.includes(NO_SPEECH)) return { ok: true, text: '', noSpeech: true };
      return { ok: true, text };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    if (mp3) fs.rmSync(mp3, { force: true });
  }
}
