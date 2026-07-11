/**
 * Deterministic ad-copy QC gate (CAMPAIGN_CRAFT.md §5 encoded) — the ads-equivalent of the
 * motion engine's scriptProblems. Pure + unit-tested; runs over EVERY headline/body BEFORE
 * anything is composited or uploaded. HARD violations are never shipped — the generator
 * swaps in a safe rewrite and counts the rejection (the review panel's trust line reads
 * "N checks run, M drafts rejected and rewritten").
 *
 * The two non-negotiables:
 * 1. Meta compliance — personal-attribute copy, negative self-perception in health,
 *    sensationalism. These get ads (and accounts) rejected.
 * 2. TRUTHFUL SCARCITY — urgency/scarcity language may appear ONLY when the user gave a
 *    grounding fact (a real offer end date, a real limited count), and numeric claims must
 *    match the fact. Fabricated urgency is FTC dark-pattern territory; the engine never
 *    invents it (>40% of countdown timers in the wild are fake — we are not that).
 */

export interface CopyFacts {
  /** Epoch ms of a REAL offer end the user stated. Undefined = no time-urgency allowed. */
  offerEndsAt?: number | null;
  /** A REAL limited quantity the user stated. Undefined = no count-scarcity allowed. */
  limitedCount?: number | null;
  limitedUnit?: string | null;
  /** Vertical carries Meta health rules (18+, no negative self-perception). */
  healthRules?: boolean;
}

export interface CopyVerdict {
  hard: string[]; // ship-blocking — rewrite required
  advisories: string[]; // quality nudges — allowed to ship
}

// ── Lexicons (compiled once) ────────────────────────────────────────────────────────────────

/** Second-person probes that, combined with a personal attribute, imply the viewer HAS it. */
const PROBE_RE = /\b(are you|do you (?:have|suffer|struggle)|struggling with|suffering from|tired of being|embarrassed (?:by|about)|ashamed of)\b/i;
const ATTRIBUTE_RE = /\b(diabet\w*|depress\w*|anxi\w*|obes\w*|overweight|fat\b|bald\w*|wrinkl\w*|acne|addict\w*|debts?\b|bad credit|credit score|disab\w*|hiv|aids|pregnan\w*|infertil\w*|divorc\w*|lonely|single\b|muslim|christian|hindu|jewish|your age|over (?:40|50|60)|senior citizen)\b/i;

/** Health verticals: copy must never generate negative self-perception (Meta hard rule). */
const NEG_SELF_RE = /\b(embarrass\w*|ashamed|ugly|flabby|gross|hate (?:your|my)|fix your (?:body|face|smile)|imperfect\w*|flaw(?:s|ed)?|unattractive|disgust\w*)\b/i;

const SENSATIONAL_RE = /\b(you won'?t believe|shocking|miracle|doctors hate|secret trick|one weird trick|instant(?:ly)? cure\w*|100% guaranteed|guaranteed results|risk[- ]?free forever)\b/i;

/** Urgency/scarcity tokens — allowed ONLY with a grounding fact. */
const TIME_URGENCY_RE = /\b(ends? (?:soon|today|tonight|tomorrow|this week(?:end)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?:on )?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.? \d{1,2})|last chance|final (?:hours|days?|call)|limited time|hurry|don'?t miss out|closing soon|offer expires|deadline|\d+ (?:hours?|days?|weeks?) (?:left|remain\w*|to go))\b/i;
// "only N <anything> left" is count-scarcity for ANY noun ("boxes", "rooms") — but time nouns
// ("only 2 days left") belong to the TIME class above, never judged against limitedCount.
const COUNT_SCARCITY_RE = /\bonly (\d+) (?:(?:spots?|seats?|slots?|items?|units?|places?)\b|(?!hours?\b|days?\b|weeks?\b|minutes?\b)\w+ (?:left|remain\w*)|left\b|remain\w*)/i;
const SUPPLY_SCARCITY_RE = /\b(limited edition|while (?:stocks?|supplies) last|selling fast|almost (?:gone|sold out)|running out)\b/i;

const VAGUE_RE = /\b(discover a better way|take your \w+ to the next level|unlock your (?:potential|best)|elevate your|transform your life|like never before)\b/i;

// ── The gate ────────────────────────────────────────────────────────────────────────────────

/** Check ONE piece of ad copy (headline + body together) against the facts. Pure. */
export function checkAdCopy(headline: string, body: string, facts: CopyFacts = {}): CopyVerdict {
  const text = `${headline} ${body}`;
  const hard: string[] = [];
  const advisories: string[] = [];

  // 1) Personal attributes — a probe + an attribute implies the viewer has it.
  if (PROBE_RE.test(text) && ATTRIBUTE_RE.test(text)) {
    hard.push('implies a personal attribute of the viewer (Meta ban) — rewrite in third person or about the SERVICE, never "are you [attribute]"');
  }
  // 2) Health: no negative self-perception, ever.
  if (facts.healthRules && NEG_SELF_RE.test(text)) {
    hard.push('negative self-perception language in a health ad (Meta ban) — rewrite as a positive aspiration');
  }
  // 3) Sensationalism.
  if (SENSATIONAL_RE.test(text)) {
    hard.push('sensational/overclaim language (Meta rejects this) — state the concrete benefit instead');
  }
  // 4) Truthful scarcity.
  const hasTime = TIME_URGENCY_RE.test(text);
  const countMatch = text.match(COUNT_SCARCITY_RE);
  const hasSupply = SUPPLY_SCARCITY_RE.test(text);
  const timeGrounded = !!(facts.offerEndsAt && facts.offerEndsAt > 0);
  const countGrounded = !!(facts.limitedCount && facts.limitedCount > 0);
  if (hasTime && !timeGrounded) {
    hard.push('time urgency with no real deadline on record — either the user states a real end date or the line goes');
  }
  if (countMatch && !countGrounded) {
    hard.push('a "only N left" claim with no real count on record — invented scarcity never ships');
  }
  if (countMatch && countGrounded && Number(countMatch[1]) > (facts.limitedCount as number)) {
    hard.push(`claims ${countMatch[1]} available but the user said ${facts.limitedCount} — the number must match the fact`);
  }
  if (hasSupply && !countGrounded && !timeGrounded) {
    hard.push('supply-scarcity language ("selling fast"/"limited edition") with nothing limited on record');
  }

  // Advisories — quality, not compliance.
  if (VAGUE_RE.test(text)) advisories.push('vague-benefit phrasing — winners name a concrete offer, number or outcome');
  if (!/\d/.test(text) && text.length > 60) advisories.push('no concrete number anywhere — a price, count or timeframe usually lifts response');
  return { hard, advisories };
}

/** Gate a whole batch: returns kept copy (safe rewrites substituted for hard failures) plus
 *  the trust-line counters. `rewrite` supplies the fallback for a rejected line; a rewrite
 *  that ITSELF fails the gate drops the item entirely — failing copy never ships, period. */
export function gateCopyBatch<T extends { headline: string; body: string }>(
  items: T[],
  facts: CopyFacts,
  rewrite: (item: T, problems: string[]) => T,
): { items: T[]; checksRun: number; draftsRejected: number; notes: string[] } {
  let rejected = 0;
  const notes: string[] = [];
  const out: T[] = [];
  for (const item of items) {
    const v = checkAdCopy(item.headline, item.body, facts);
    if (!v.hard.length) { out.push(item); continue; }
    rejected++;
    const fixed = rewrite(item, v.hard);
    const recheck = checkAdCopy(fixed.headline, fixed.body, facts);
    if (recheck.hard.length) {
      notes.push(`rewrite still failing (${recheck.hard[0]}) — line dropped entirely`);
      continue;
    }
    out.push(fixed);
  }
  return { items: out, checksRun: items.length, draftsRejected: rejected, notes };
}
