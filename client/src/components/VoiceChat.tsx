import { useEffect, useRef, useState } from 'react';
import type { LiveState } from '../state/sessionStore';

/**
 * Voice for the web chat — a mic button (hold a thought, tap to talk) and a
 * CONVERSATION MODE toggle: your recording is transcribed and sent as a message, and when
 * the reply lands it's read aloud. Degrades honestly: no ASR configured → the mic explains;
 * no TTS (spoken replies) → the Conversation toggle is hidden and the mic just fills the box.
 */

export interface VoiceCaps {
  asr: boolean;
  tts: boolean;
}

// One fetch per page load, shared by every surface that offers voice (chat, Video studio's
// narrated kinds, robot voice replies, Design studio's narrated animation).
let capsCache: VoiceCaps | null = null;
let capsInflight: Promise<VoiceCaps> | null = null;
export function voiceCaps(): Promise<VoiceCaps> {
  if (capsCache) return Promise.resolve(capsCache);
  capsInflight ??= (async () => {
    try {
      const r = await fetch('/api/voice/capabilities', { credentials: 'include' });
      const d = (await r.json()) as Partial<VoiceCaps>;
      capsCache = { asr: !!d?.asr, tts: !!d?.tts };
    } catch {
      capsCache = { asr: false, tts: false };
    }
    return capsCache;
  })();
  return capsInflight;
}

/** The server's voice capabilities (null while loading) — hide voice-dependent options until
 *  they're confirmed available, so nothing appears and then vanishes. */
export function useVoiceCaps(): VoiceCaps | null {
  const [caps, setCaps] = useState<VoiceCaps | null>(capsCache);
  useEffect(() => {
    if (!caps) void voiceCaps().then(setCaps);
  }, [caps]);
  return caps;
}

async function transcribeBlob(sessionId: string, blob: Blob): Promise<{ text: string; noSpeech?: boolean }> {
  const form = new FormData();
  form.append('file', blob, blob.type.includes('mp4') ? 'clip.m4a' : 'clip.webm');
  const r = await fetch(`/api/sessions/${sessionId}/transcribe`, { method: 'POST', body: form, credentials: 'include' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Transcription failed (${r.status})`);
  return d;
}

export function VoiceControls({
  sessionId,
  live,
  onTranscript,
  onSystem,
}: {
  sessionId: string;
  live: LiveState | undefined;
  /** Receives the transcript; `conversation` tells the caller to auto-send it. */
  onTranscript: (text: string, conversation: boolean) => void;
  onSystem: (text: string, level?: 'info' | 'error') => void;
}) {
  const caps = useVoiceCaps();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [convoPref, setConvo] = useState(() => {
    try {
      return localStorage.getItem('arksai.voiceMode') === '1';
    } catch {
      return false;
    }
  });
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spokenForRef = useRef<string | null>(null);
  const wasRunningRef = useRef(false);
  // Conversation mode = voice in + replies read aloud, so it only exists with spoken replies; a
  // remembered "on" from a server that had them never auto-sends transcripts here.
  const convo = convoPref && !!caps?.tts;

  const setConversation = (on: boolean) => {
    setConvo(on);
    try {
      localStorage.setItem('arksai.voiceMode', on ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (!on && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  };

  // Conversation mode: when a run finishes, read the reply aloud (once per message).
  useEffect(() => {
    const running = !!live?.running;
    const justFinished = wasRunningRef.current && !running;
    wasRunningRef.current = running;
    if (!justFinished || !convo || !caps?.tts) return;
    const items = live?.items ?? [];
    const last = [...items].reverse().find((i: any) => i.kind === 'assistant' && i.text?.trim());
    if (!last || spokenForRef.current === (last as any).id) return;
    spokenForRef.current = (last as any).id;
    void (async () => {
      try {
        const r = await fetch(`/api/sessions/${sessionId}/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text: (last as any).text }),
        });
        if (!r.ok) return; // silent — the text reply is on screen
        const buf = await r.blob();
        const url = URL.createObjectURL(buf);
        audioRef.current?.pause();
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play().catch(() => URL.revokeObjectURL(url));
      } catch {
        /* speaking is best-effort */
      }
    })();
  }, [live?.running, live?.items, convo, caps?.tts, sessionId]);

  const stopTracks = () => {
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
  };

  const toggleRecord = async () => {
    if (busy) return;
    if (recording) {
      recRef.current?.stop();
      return;
    }
    if (!caps?.asr) {
      onSystem('Voice input isn’t configured on this server yet.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopTracks();
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 800) return; // an accidental tap, nothing recorded
        setBusy(true);
        void transcribeBlob(sessionId, blob)
          .then((r) => {
            if (r.noSpeech || !r.text) onSystem('I couldn’t hear any speech in that — try again a little closer to the mic.');
            else onTranscript(r.text, convo);
          })
          .catch((e) => onSystem(e?.message || 'Couldn’t transcribe that.', 'error'))
          .finally(() => setBusy(false));
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      // Safety stop: nobody means to record for 2+ minutes.
      setTimeout(() => {
        if (recRef.current === rec && rec.state === 'recording') rec.stop();
      }, 120_000);
    } catch {
      onSystem('Microphone access was blocked — allow it in your browser to talk.', 'error');
    }
  };

  // No ASR and no spoken replies → render nothing (no dead chrome).
  if (caps && !caps.asr && !caps.tts) return null;

  return (
    <>
      <button
        type="button"
        className={`icon-btn vc-mic${recording ? ' rec' : ''}`}
        onClick={() => void toggleRecord()}
        disabled={busy}
        title={
          recording
            ? convo
              ? 'Tap to stop & send'
              : 'Tap to stop — your words go in the box'
            : busy
              ? 'Transcribing…'
              : 'Talk instead of typing'
        }
        aria-label={recording ? 'Stop recording' : 'Record a voice message'}
      >
        {busy ? '…' : recording ? '■' : '🎙'}
      </button>
      {caps?.tts && (
        <button
          type="button"
          className={`vc-convo${convo ? ' on' : ''}`}
          onClick={() => setConversation(!convo)}
          title={
            convo
              ? 'Conversation mode is ON — your voice sends immediately and replies are read aloud'
              : 'Conversation mode: talk, and hear the replies'
          }
        >
          {convo ? '🔊 Conversation on' : 'Conversation'}
        </button>
      )}
    </>
  );
}
