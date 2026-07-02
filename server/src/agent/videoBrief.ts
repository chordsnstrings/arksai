/**
 * Video prompt compiler — turns a casual ask into the granular, director-grade prompt Seedance
 * (1.5-pro / 2.0) responds to best, so the USER only ever writes "what happens" and the system
 * fills in the professional detail automatically.
 *
 * Structure follows the official Seedance guides (BytePlus ModelArk + fal + Dreamina 2.0):
 *   SUBJECT + ACTION → ONE CAMERA MOVE → LIGHTING → STYLE → AUDIO → NEGATIVE CONSTRAINTS
 * ordered as a shot plan so the model "locks" the frame before inventing motion. Key rules baked in:
 *   • exactly ONE primary camera instruction (multiple moves = jittery, conflicting results);
 *   • lighting is the highest-impact lever, so a tasteful light is always specified;
 *   • dialogue goes in quotes (that's the signal to prioritise synced audio);
 *   • character shots get "avoid warped faces/hands, no bent limbs"; longer shots get "no flicker".
 *
 * Deterministic + PURE + fail-open: it only ADDS a layer the author didn't already provide, so it
 * can never fight an explicit instruction, and worst case it returns the brief with safe defaults.
 */

const HAS_CAMERA = /camera|pov|close[- ]?up|wide shot|orbit|arc|pan(ning)?|push[- ]?in|pull[- ]?out|dolly|handheld|static|locked[- ]?off|fixed shot|tracking|follow shot|aerial|drone|crane|rise|zoom|tilt/i;
const HAS_STYLE = /cinematic|editorial|photoreal|anim(e|ated)|illustrat|film|35mm|4k|grade|grain|stylized|noir|documentary|vintage|retro|watercolou?r|3d render/i;
const HAS_LIGHT = /light|lit|golden hour|sunlit|sunset|sunrise|backlit|rim light|neon|overcast|window light|candle|moonlit|dusk|dawn|shadow|glow/i;
const HAS_AUDIO = /audio:|sound of|we hear|voice(over)?|dialogue|says|speaking|music|ambien(ce|t)|sfx|whoosh|hum|chatter/i;

// A human/character in frame → add anatomy-stability negatives (the #1 Seedance failure mode).
const HAS_PEOPLE = /\b(person|people|man|woman|men|women|boy|girl|child|kid|baby|founder|barista|model|character|dancer|athlete|runner|worker|chef|driver|crowd|couple|family|face|hands?|portrait|someone|he |she |they )/i;
// Product/object hero → an orbit reads better than a push-in.
const IS_PRODUCT = /\b(product|phone|laptop|bottle|can|watch|shoe|sneaker|handbag|jewel|perfume|cosmetic|packaging|gadget|device|object|pedestal|turntable)\b/i;
// Landscape / establishing → a slow aerial or rise suits the scale.
const IS_SCENERY = /\b(landscape|city(scape)?|skyline|mountain|valley|forest|desert|ocean|coast|beach|field|aerial|drone|horizon|street|architecture|building)\b/i;

/** Choose ONE camera move that fits the subject (only used when the author gave none). */
function defaultCamera(brief: string, purpose?: string): string {
  if (purpose === 'ad' || purpose === 'reel') return 'Camera: one confident slow push-in on the subject (single move, steady).';
  if (IS_PRODUCT.test(brief)) return 'Camera: a slow orbit around the subject (single move, steady).';
  if (IS_SCENERY.test(brief)) return 'Camera: a slow aerial rise revealing the scene (single move, steady).';
  return 'Camera: one smooth slow push-in on the subject (single move, steady — no other camera motion).';
}

export function compileVideoPrompt(o: {
  brief: string;
  dialogue?: string;
  purpose?: string;
  /** clamp-agnostic hint used only to decide whether to add the "no flicker" negative */
  durationSec?: number;
}): string {
  const brief = o.brief.trim().replace(/\s+/g, ' ');
  const parts: string[] = [brief];

  // 1 · Camera — exactly one move, only if the author didn't direct it.
  if (!HAS_CAMERA.test(brief)) parts.push(defaultCamera(brief, o.purpose));

  // 2 · Lighting — highest-impact lever; always ensure a light is named.
  if (!HAS_LIGHT.test(brief)) parts.push('Lighting: soft natural key light, gently directional, bright and well-exposed.');

  // 3 · Style — a premium, coherent grade.
  if (!HAS_STYLE.test(brief)) parts.push('Style: premium cinematic, photoreal, natural film-tone colour grade, crisp 4K detail.');

  // 4 · Audio — dialogue in quotes is the synced-audio signal; else a matching ambient bed.
  if (o.dialogue?.trim()) {
    parts.push(`Audio: a clear voice says "${o.dialogue.trim().slice(0, 160)}", lip-synced, with subtle matching ambience.`);
  } else if (!HAS_AUDIO.test(brief)) {
    parts.push('Audio: natural ambient sound that matches the scene, no music.');
  }

  // 5 · Negative constraints — steer away from Seedance's known failure modes.
  const negatives: string[] = [];
  if (HAS_PEOPLE.test(brief)) negatives.push('natural anatomy, no warped faces or hands, no bent or extra limbs');
  if ((o.durationSec ?? 0) >= 8) negatives.push('no temporal flicker or morphing between frames');
  negatives.push('no jitter, stable subject');
  parts.push(`Avoid: ${negatives.join('; ')}.`);

  return parts.join(' ');
}
