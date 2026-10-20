import type { EngineResult } from './modelark';

/**
 * Speech (text-to-speech) — provider-neutral seam. ModelArk has NO speech model (verified
 * 2026-10-20), and the operator chose "Seedance native audio + no TTS": generated video carries
 * its own audio, and every feature that needs a NARRATOR voice (text_to_speech, narrated motion
 * videos / animated explainers, chat read-aloud, robot voice-note replies) is switched off.
 *
 * Callers keep their existing wiring and ask ttsAvailable() first, so wiring a future speech
 * provider is a change to THIS file only — nothing else needs rewiring.
 */

export const TTS_UNAVAILABLE = 'Voice narration is not available on this workspace yet.';

export function ttsAvailable(): boolean {
  return false;
}

/** Core TTS (MP3 bytes). Never throws; unavailable until a speech provider is configured. */
export async function synthesizeSpeechBuffer(
  _text: string,
  _opts: { voiceId?: string; speed?: number },
  _signal: AbortSignal,
): Promise<{ ok: boolean; buffer?: Buffer; error?: string }> {
  return { ok: false, error: TTS_UNAVAILABLE };
}

export async function textToSpeech(
  _text: string,
  _opts: { voiceId?: string; speed?: number },
  _repoDir: string,
  _signal: AbortSignal,
): Promise<EngineResult> {
  return { ok: false, files: [], error: TTS_UNAVAILABLE };
}
