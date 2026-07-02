/**
 * Video prompt compiler — turns a casual ask into the director-grade prompt Seedance responds
 * to best (per the official 1.5-pro prompt guide): SUBJECT + ACTION + CAMERA + STYLE/LIGHT +
 * AUDIO CUES. Deterministic + PURE (fail-open by construction: worst case it returns the brief
 * with tasteful defaults appended). The user never writes any of this themselves.
 */

const HAS_CAMERA = /camera|pov|close[- ]?up|wide shot|orbit|pan(ning)?|push[- ]?in|dolly|handheld|static shot|tracking|aerial|drone|zoom/i;
const HAS_STYLE = /cinematic|editorial|photoreal|anim(e|ated)|illustrat|film|35mm|grade|stylized|noir|documentary/i;
const HAS_AUDIO = /audio:|sound of|we hear|voice(over)?|dialogue|says|music|ambien(ce|t)/i;

export function compileVideoPrompt(o: { brief: string; dialogue?: string; purpose?: string }): string {
  const parts: string[] = [o.brief.trim().replace(/\s+/g, ' ')];
  if (!HAS_CAMERA.test(o.brief)) {
    parts.push(
      o.purpose === 'ad' || o.purpose === 'reel'
        ? 'Camera: one confident slow push-in on the subject.'
        : 'Camera: a smooth, deliberate movement suited to the subject (slow push-in or gentle orbit).',
    );
  }
  if (!HAS_STYLE.test(o.brief)) {
    parts.push('Style: premium, editorial, photoreal; natural colour grade; soft key light, bright and well-lit.');
  }
  if (o.dialogue?.trim()) {
    parts.push(`Audio: a clear voice says "${o.dialogue.trim().slice(0, 160)}", with subtle matching ambience.`);
  } else if (!HAS_AUDIO.test(o.brief)) {
    parts.push('Audio: natural ambient sound that matches the scene, no music.');
  }
  return parts.join(' ');
}
