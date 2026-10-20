/**
 * Video prompt compiler — turns a casual ask into the granular, director-grade prompt Seedance
 * (1.5-pro / 2.0 / 2.5) responds to best, so the USER only ever writes "what happens" and the system
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

/* ── sentences (shared with the story narrator) ──────────────────────────── */

// Words whose trailing "." abbreviates (lower-cased, final dot dropped) — never a sentence end.
// Under-splitting is the SAFE failure: a missed boundary keeps two sentences in one scene, while a
// false one cuts a spoken line across a scene cut ("Say hi to Mr." … "Khan.").
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'mx', 'dr', 'st', 'prof', 'jr', 'sr', 'rev', 'hon', 'sgt', 'capt', 'lt', 'col', 'gen', 'gov',
  'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'llc', 'plc', 'mt', 'ave', 'rd', 'blvd', 'dept', 'approx', 'ph.d',
]);

// A "word" that carries meaning; a run without one (🎉🎉, —, ✨) is decoration, never a sentence.
const WORDY = /[\p{L}\p{N}]/u;

/**
 * Does `word` end a sentence? `next` is the word after it (absent at the end of the text). At a
 * soft line wrap (`atWrap`) `next` is the first word of the following line. PURE.
 */
function endsSentence(word: string, next?: string, atWrap = false): boolean {
  if (!/[.!?…。！？]["'”’)\]」』）]*$/.test(word)) return false;
  // A trailing emoji/symbol run rides with the sentence it closes: "Great job! 🎉🎉".
  if (next !== undefined && !WORDY.test(next)) return false;
  // A lowercase continuation stays one sentence: `"Ready?" she asks.` — across a soft wrap too,
  // except after a bare "." (a wrapped line that ends on a full stop is a deliberate break).
  if (next !== undefined && /^\p{Ll}/u.test(next) && !(atWrap && /[^.]\.$/.test(word))) return false;
  // Only a bare single "." can be an abbreviation (not ! ? … "..." or a closing quote).
  if (!/[^.]\.$/.test(word)) return true;
  const core = word.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, -1);
  const lc = core.toLowerCase();
  if (ABBREVIATIONS.has(lc)) return false;
  if (lc === 'no') return !(next && /^[#\d]/.test(next)); // "No. 5" vs "Just say no."
  if (/^(?:\p{L}\.)+\p{L}$/u.test(core)) return false; // U.S. · e.g. · i.e. · a.m. · p.m. · J.R.R.
  if (/^\p{Lu}$/u.test(core) && core !== 'I') return false; // an initial: "J. Smith"
  return true;
}

/**
 * Split spoken text into sentences, abbreviation- and initial-aware ("Mr. Khan", "9 a.m. Sunday",
 * "J. Smith" stay whole). A blank line is a hard paragraph break; a single newline is a soft wrap
 * (joined) unless the line before it ends a sentence — judged with the next line's first word, so
 * `"Ready?"⏎she asks.` and `No.⏎5 is…` stay whole. A trailing emoji/symbol run stays with its
 * sentence. Full-width 。！？ end sentences too. Whitespace is normalised. PURE.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of String(text || '').replace(/\r\n?/g, '\n').split(/\n[^\S\n]*\n/)) {
    const lines = para.split('\n').map((raw) => raw.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const chunks: string[] = [];
    let cur = '';
    lines.forEach((line, li) => {
      cur = cur ? `${cur} ${line}` : line;
      const next = lines[li + 1]?.split(' ')[0];
      if (next === undefined || endsSentence(line.slice(line.lastIndexOf(' ') + 1), next, true)) {
        chunks.push(cur);
        cur = '';
      }
    });
    for (const chunk of chunks) {
      const words = chunk.split(' ');
      let start = 0;
      for (let i = 0; i < words.length - 1; i++) {
        // Judge the boundary against the first real word after any emoji/symbol run, and cut
        // after that run — so the decoration closes its sentence instead of becoming one.
        let j = i;
        while (j + 1 < words.length && !WORDY.test(words[j + 1])) j++;
        if (endsSentence(words[i], words[j + 1])) {
          out.push(words.slice(start, j + 1).join(' '));
          start = j + 1;
          i = j;
        }
      }
      if (start < words.length) out.push(words.slice(start).join(' '));
    }
  }
  // A "sentence" with no letter or digit (an emoji-only paragraph, a lone "…") is never a line
  // of its own — fold it into its neighbour so no scene gets narration of just "🎉🎉".
  const merged: string[] = [];
  for (const s of out) {
    if (/[\p{L}\p{N}]/u.test(s) || !merged.length) merged.push(s);
    else merged[merged.length - 1] += ` ${s}`;
  }
  if (merged.length > 1 && !/[\p{L}\p{N}]/u.test(merged[0])) merged.splice(0, 2, `${merged[0]} ${merged[1]}`);
  return merged;
}

/** The most dialogue one clip speaks — past this a single shot can't voice it naturally. */
export const DIALOGUE_MAX_CHARS = 160;

/**
 * Fit a spoken line into one clip: unchanged when it fits; otherwise cut at the last SENTENCE
 * boundary within the cap, else the last full-width 。！？ (unspaced CJK), else the last WORD
 * boundary — never mid-word. A word cut that leaves a stub (a "Narrator:" label before unspaced
 * text, a lone dash) hard-cuts at the cap instead, on a character boundary (never mid surrogate
 * pair). `trimmed` tells the caller so the agent can tell the user (longer narration belongs in a
 * multi-scene story). PURE.
 */
export function fitDialogue(dialogue: string | undefined, cap = DIALOGUE_MAX_CHARS): { text: string; trimmed: boolean } {
  const whole = String(dialogue ?? '').replace(/\s+/g, ' ').trim();
  if (whole.length <= cap) return { text: whole, trimmed: false };
  const tidy = (t: string) => t.replace(/[\s,;:—–-]+$/, '');
  let text = '';
  for (const s of splitSentences(String(dialogue))) {
    const next = text ? `${text} ${s}` : s;
    if (next.length > cap) break;
    text = next;
  }
  // Whole characters only, ≤ cap code units.
  let head = '';
  for (const ch of whole) {
    if (head.length + ch.length > cap) break;
    head += ch;
  }
  if (!text) {
    const stop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
    if (stop > 0 && WORDY.test(head.slice(0, stop))) text = head.slice(0, stop + 1);
  }
  if (!text) {
    const sp = whole.slice(0, cap + 1).lastIndexOf(' ');
    const word = sp > 0 ? tidy(whole.slice(0, sp)) : '';
    text = WORDY.test(word) && word.length >= cap / 2 ? word : tidy(head);
  }
  return { text, trimmed: true };
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
  const spoken = fitDialogue(o.dialogue).text;
  if (spoken) {
    parts.push(`Audio: a clear voice says "${spoken}", lip-synced, with subtle matching ambience.`);
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
