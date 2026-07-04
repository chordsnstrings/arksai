import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';
import { transcribeAudio, voiceAvailable } from '../robots/voice';
import { synthesizeSpeechBuffer, ttsAvailable } from '../engines/minimax';
import { speakableText } from '../robots/outbound';

/**
 * Voice for the WEB CHAT (conversation mode): the mic button records in the browser,
 * `/transcribe` turns it into text (same ASR path the robots use — ffmpeg handles the
 * browser's webm/opus), and `/speak` synthesizes a reply so the client can play it.
 * Both are session-gated (normal auth) and honestly 503 when their engine isn't configured.
 */

const SPEAK_CAP = 1200;

export function registerVoiceChatRoutes(app: FastifyInstance) {
  // What the client can offer: mic (ASR) and/or spoken replies (TTS).
  app.get('/api/voice/capabilities', async () => ({ asr: voiceAvailable(), tts: ttsAvailable() }));

  app.post('/api/sessions/:id/transcribe', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    if (!voiceAvailable()) return reply.code(503).send({ error: 'Voice transcription is not configured on this server.' });
    if (!req.isMultipart?.()) return reply.code(400).send({ error: 'Send the recording as a multipart file.' });
    const part = await (req as any).file();
    if (!part) return reply.code(400).send({ error: 'No recording received.' });
    const tmp = path.join(os.tmpdir(), `chatvoice-${randomUUID()}-${(part.filename || 'clip.webm').replace(/[^\w.\-]+/g, '_')}`);
    try {
      await pipeline(part.file, fs.createWriteStream(tmp));
      if (part.file.truncated) return reply.code(413).send({ error: 'That recording is too large.' });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 70_000);
      try {
        const r = await transcribeAudio(tmp, ac.signal);
        if (!r.ok) return reply.code(502).send({ error: r.error || 'Could not transcribe that.' });
        if (r.noSpeech || !r.text) return { text: '', noSpeech: true };
        return { text: r.text };
      } finally {
        clearTimeout(timer);
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  app.post('/api/sessions/:id/speak', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    if (!ttsAvailable()) return reply.code(503).send({ error: 'Spoken replies are not configured on this server.' });
    const raw = String((req.body as any)?.text ?? '').trim();
    if (!raw) return reply.code(400).send({ error: 'Nothing to say.' });
    const text = speakableText(raw, SPEAK_CAP);
    if (!text) return reply.code(400).send({ error: 'Nothing speakable in that reply.' });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    try {
      const r = await synthesizeSpeechBuffer(text, {}, ac.signal);
      if (!r.ok || !r.buffer) return reply.code(502).send({ error: r.error || 'Speech synthesis failed.' });
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Cache-Control', 'no-store');
      return reply.send(r.buffer);
    } finally {
      clearTimeout(timer);
    }
  });
}
