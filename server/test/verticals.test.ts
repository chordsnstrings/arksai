import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERTICALS, classifyVertical, verticalById, countryCostIndex, adjustedBenchmark,
  suggestTargetCpr, targetAmbition,
} from '../src/agent/social/verticals';
import { decideOptimizations, type AdMetrics } from '../src/robots/socialCampaigns';

// ---- catalog integrity ----
test('verticals: catalog integrity — unique ids, labels, priors sane, generic fallback last', () => {
  const ids = VERTICALS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(VERTICALS.length >= 12);
  for (const v of VERTICALS) {
    assert.ok(v.label.length > 2);
    if (v.prior) assert.ok(v.prior.lowUsd > 0 && v.prior.highUsd > v.prior.lowUsd, v.id);
  }
  const generic = verticalById('generic');
  assert.equal(generic.prior, null);
  assert.equal(verticalById('nonsense').id, 'generic'); // unknown ids fall back safely
});

// ---- classifier ----
test('verticals: classifier maps real briefs to the right industry', () => {
  assert.equal(classifyVertical('Family dental clinic in Marina', ['teeth whitening']).profile.id, 'dental');
  assert.equal(classifyVertical('Home deep-cleaning service', ['move-out cleaning']).profile.id, 'homeservices');
  assert.equal(classifyVertical('Shawarma restaurant downtown', []).profile.id, 'restaurant');
  assert.equal(classifyVertical('Off-plan villa project', ['payment plans']).profile.id, 'realestate');
  assert.equal(classifyVertical('Modest wear abaya boutique', []).profile.id, 'ecom_fashion');
  // No keywords at all → generic with zero confidence.
  const g = classifyVertical('Quantum flux widgets', []);
  assert.equal(g.profile.id, 'generic');
  assert.equal(g.confidence, 0);
  // Multiple hits read firmer than one.
  const strong = classifyVertical('dental clinic — braces, veneers and implants', []);
  assert.ok(strong.confidence >= 0.6);
});

// ---- country cost index (operator: "lead costs should be country specific") ----
test('verticals: country index — UAE is NOT US-priced, blends, unknown → global', () => {
  const us = countryCostIndex(['US']);
  const ae = countryCostIndex(['AE']);
  const inx = countryCostIndex(['IN']);
  assert.ok(ae.high < us.low, 'UAE ceiling must sit below the US floor');
  assert.ok(inx.high < ae.low, 'India must be cheaper still');
  assert.equal(us.global, false);
  // Blend: AE + IN lands between the two.
  const blend = countryCostIndex(['AE', 'IN']);
  assert.ok(blend.low > inx.low && blend.low < ae.low);
  // Unknown country → US-priced band flagged global.
  const unk = countryCostIndex(['ZZ']);
  assert.equal(unk.global, true);
  assert.equal(countryCostIndex([]).global, true);
});

test('verticals: adjusted benchmark — a UAE dental quote is far below the US one, with AED', () => {
  const dental = verticalById('dental');
  const usq = adjustedBenchmark(dental, ['US'])!;
  const aeq = adjustedBenchmark(dental, ['AE'])!;
  // Bands deliberately overlap (honest widening) — the invariant is the whole band shifts down.
  const mid = (b: { lowUsd: number; highUsd: number }) => (b.lowUsd + b.highUsd) / 2;
  assert.ok(mid(aeq) < mid(usq) * 0.75, `AE mid ${mid(aeq)} should sit well below US mid ${mid(usq)}`);
  assert.ok(aeq.lowUsd < usq.lowUsd && aeq.highUsd < usq.highUsd);
  assert.equal(aeq.basis, 'industry-estimate');
  assert.ok(aeq.local && aeq.local.code === 'AED' && aeq.local.low > aeq.lowUsd, 'single-country UAE shows AED');
  // Multi-country → no local currency.
  assert.equal(adjustedBenchmark(dental, ['AE', 'SA'])!.local, undefined);
  // Generic (no prior) → null benchmark.
  assert.equal(adjustedBenchmark(verticalById('generic'), ['AE']), null);
});

test('verticals: own history beats any prior and needs no country scaling', () => {
  const dental = verticalById('dental');
  const own = adjustedBenchmark(dental, ['AE'], 18)!;
  assert.equal(own.basis, 'your-own-results');
  assert.ok(own.lowUsd < 18 && own.highUsd > 18, 'band brackets the real observed cost');
  assert.ok(own.highUsd - own.lowUsd < 18, 'own-history band is tight (±30%), not the wide prior');
  // Suggestion prefers it, and ambition is judged against it.
  const suggested = suggestTargetCpr(own)!;
  assert.ok(Math.abs(suggested - 18) < 6);
  assert.equal(targetAmbition(suggested, own), 'ok');
  assert.equal(targetAmbition(own.lowUsd * 0.3, own), 'ambitious');
  assert.equal(targetAmbition(5, null), 'ok'); // no benchmark → never nag
});

// ---- target-price steering in the optimizer (operator: "thrive to come closer to the set price") ----
const ad = (adId: string, cpr: number | null, over: Partial<AdMetrics> = {}): AdMetrics => ({
  adId, spend: 40, impressions: 5000, ctr: 1.4, frequency: 2,
  results: cpr ? Math.round((40 / cpr) * 100) / 100 : 0, costPerResult: cpr, ...over,
});

test('optimizer: pauses ads far over the user target and rotates harder above it', () => {
  // Ads similar to EACH OTHER (best×2.5 is blind) but far over the $10 target → the target
  // rule catches them; never-empty keeps one live; the campaign rotates harder.
  const d = decideOptimizations([ad('A', 25), ad('B', 28)], { targetCprUsd: 10 });
  assert.ok(d.pause.length >= 1 && d.pause.every((p) => /target/.test(p.reason)));
  assert.ok(d.pause.length < 2, 'never empties the campaign');
  assert.ok(d.rotate, 'campaign CPR over 1.3× target → rotate harder');
  assert.ok(d.notes.some((n) => /rotating harder|target/.test(n)));
});

test('optimizer: stability mode at/below target — no churn of a winning mix', () => {
  const d = decideOptimizations([ad('A', 8), ad('B', 9)], { targetCprUsd: 10 });
  assert.equal(d.pause.length, 0);
  assert.equal(d.rotate, false);
  assert.ok(d.notes.some((n) => /beating your \$10 target/.test(n)));
});

test('optimizer: vertical-prior backstop catches uniformly bad campaigns without a target', () => {
  // Two equally terrible ads — the old best×2.5 rule alone is blind here.
  const blind = decideOptimizations([ad('A', 200), ad('B', 210)]);
  assert.equal(blind.pause.length, 0);
  const seen = decideOptimizations([ad('A', 200), ad('B', 210)], { priorHighUsd: 60 });
  assert.ok(seen.pause.length >= 1);
  assert.ok(seen.pause.every((p) => /industry/.test(p.reason)));
});

test('optimizer: significance gate still guards target judging', () => {
  // Under-spend ads are never judged, even against a target.
  const d = decideOptimizations([ad('A', 50, { spend: 2, impressions: 200 })], { targetCprUsd: 5 });
  assert.equal(d.pause.length, 0);
  assert.ok(d.notes.some((n) => /significance floor/.test(n)));
});

// ---- Review-fix locks: word-boundary classification + sub-unit currency display ----

test('classifier matches at word starts — no substring false positives', () => {
  // 'rent' inside 'parents' must NOT read as real estate; 'tuition' wins for education.
  const tuition = classifyVertical('Maths tuition for kids — parents love us');
  assert.equal(tuition.profile.id, 'education');
  // 'hair' inside 'chairs' must NOT read as beauty.
  assert.notEqual(classifyVertical('Ergonomic office chairs for startups').profile.id, 'beauty');
  // Prefix stems still work ('rental' is real estate, 'plumbing' is home services).
  assert.equal(classifyVertical('Short-term rental apartments in Marina').profile.id, 'realestate');
  assert.equal(classifyVertical('Emergency plumbing repairs').profile.id, 'homeservices');
});

test('sub-unit currencies never display a 0 floor (KWD/BHD/OMR)', () => {
  const rest = verticalById('restaurant');
  const kw = adjustedBenchmark(rest, ['KW'])!;
  assert.equal(kw.local?.code, 'KWD');
  assert.ok((kw.local?.low ?? 0) >= 0.1, `KWD low must be >= 0.1, got ${kw.local?.low}`);
  assert.ok((kw.local?.high ?? 0) > (kw.local?.low ?? 0));
});
