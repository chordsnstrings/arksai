import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCreativeBatch, hookHeadline, estimateBatchCostUsd, generateImagePool,
  HOOK_ARCHETYPES, BATCH_FORMATS, EST_COST_PER_BACKGROUND_USD,
  archetypeCycle, bodyShape, imageryPrompt, COPY_SHAPES,
} from '../src/agent/social/creativeBatch';

const BRIEF = { product: 'FreshCrate', topics: ['weekly veg boxes', 'same-day delivery'], cta: 'Order now' };

test('planCreativeBatch: ~30 creatives → 10 backgrounds × 3 archetype-diverse headlines', () => {
  const { specs, qc } = planCreativeBatch(BRIEF, 30);
  assert.equal(specs.length, 10); // ceil(30/3)
  for (const s of specs) {
    assert.ok(s.headlines.length >= 1 && s.headlines.length <= 3);
    assert.equal(new Set(s.headlines).size, s.headlines.length); // distinct hooks
    assert.match(s.prompt, /no words or lettering/); // text-free imagery rule
    assert.ok((BATCH_FORMATS as readonly string[]).includes(s.aspect));
  }
  // Formats rotate across mobile + web.
  assert.ok(new Set(specs.map((s) => s.aspect)).size >= 4);
  // Topics cycle.
  assert.ok(specs.some((s) => s.topic === 'weekly veg boxes') && specs.some((s) => s.topic === 'same-day delivery'));
  // Every headline was checked by the copy gate.
  assert.ok(qc.checksRun >= specs.length);
});

test('planCreativeBatch clamps: tiny + huge requests', () => {
  assert.equal(planCreativeBatch(BRIEF, 1).specs.length, 1);
  assert.equal(planCreativeBatch(BRIEF, 500).specs.length, Math.ceil(50 / 3)); // hard cap 50 creatives
  assert.equal(planCreativeBatch({ product: 'X', topics: [] }, 3).specs.length, 1); // no topics → product
});

test('hookHeadline covers every archetype distinctly', () => {
  const set = new Set(HOOK_ARCHETYPES.map((a) => hookHeadline(a, 'FreshCrate', 'weekly veg boxes')));
  assert.equal(set.size, HOOK_ARCHETYPES.length);
});

test('hookHeadline: urgency speaks ONLY from grounded facts (truthful scarcity)', () => {
  // No facts → zero urgency language.
  const bare = hookHeadline('urgency', 'FreshCrate', 'weekly veg boxes');
  assert.doesNotMatch(bare, /only \d|ends|hurry|last chance|don'?t wait/i);
  // A real count → the exact number, never more.
  const counted = hookHeadline('urgency', 'FreshCrate', 'veg boxes', { limitedCount: 12, limitedUnit: 'boxes' });
  assert.match(counted, /Only 12 boxes left/);
  // A real end date → the date is named.
  const dated = hookHeadline('urgency', 'FreshCrate', 'veg boxes', { offerEndsAt: Date.UTC(2027, 0, 15) });
  assert.match(dated, /Offer ends Jan/);
});

test('planCreativeBatch: no grounded facts → the whole pool ships with zero urgency copy', () => {
  const { specs, qc } = planCreativeBatch(BRIEF, 30);
  for (const s of specs) for (const h of s.headlines) {
    assert.doesNotMatch(h, /only \d+ (left|spots)|ends (soon|today)|last chance|limited time/i);
  }
  assert.equal(qc.draftsRejected, 0); // the generator never even drafts ungrounded urgency
});

test('planCreativeBatch: grounded facts → urgency appears and matches the fact', () => {
  const { specs } = planCreativeBatch({ ...BRIEF, limitedCount: 8, limitedUnit: 'boxes' }, 30);
  const urgent = specs.flatMap((s) => s.headlines).filter((h) => /Only 8 boxes left/.test(h));
  assert.ok(urgent.length >= 1, 'grounded count-scarcity headlines present');
});

test('estimateBatchCostUsd is per-background', () => {
  const { specs } = planCreativeBatch(BRIEF, 30);
  assert.equal(estimateBatchCostUsd(specs), Math.round(10 * EST_COST_PER_BACKGROUND_USD * 100) / 100);
});

test('generateImagePool: a zero budget skips everything BEFORE any generation call', async () => {
  const out = await generateImagePool(BRIEF, 30, '/tmp', new AbortController().signal, { maxUsd: 0 });
  assert.equal(out.pool.length, 0);
  assert.equal(out.generatedBackgrounds, 0);
  assert.equal(out.skippedSpecs, 10);
  assert.match(out.errors[0], /generation cap \$0 reached/); // honest, never silent
  assert.ok(out.qc.checksRun > 0); // the gate ran at planning time regardless
});

test('generateImagePool: an aborted signal stops the loop', async () => {
  const ac = new AbortController();
  ac.abort();
  const out = await generateImagePool(BRIEF, 30, '/tmp', ac.signal, { maxUsd: 100 });
  assert.equal(out.pool.length, 0);
  assert.equal(out.skippedSpecs, 10);
});

// ---- Phase C: the vertical-tuned copy engine ----

test('archetypeCycle: weights differ by style; urgency earns NO slots without grounded facts', () => {
  const playful = archetypeCycle('playful', { grounded: true });
  const cred = archetypeCycle('credibility', { grounded: true });
  const count = (c: string[], a: string) => c.filter((x) => x === a).length;
  assert.ok(count(playful, 'offer') > count(playful, 'proof'), 'playful leads with offers');
  assert.ok(count(cred, 'proof') > count(cred, 'question'), 'credibility leads with proof');
  // Ungrounded → urgency stripped entirely from the cycle.
  assert.equal(count(archetypeCycle('playful', { grounded: false }), 'urgency'), 0);
  assert.ok(count(archetypeCycle('playful', { grounded: true }), 'urgency') > 0);
  // Expert override wins.
  const forced = archetypeCycle('credibility', { grounded: false, override: { question: 5, proof: 0 } });
  assert.ok(count(forced, 'question') >= 5 && count(forced, 'proof') === 0);
});

test('bodyShape: structurally distinct copy, frame-aware PAS', () => {
  const bodies = COPY_SHAPES.map((s) => bodyShape(s, 'FreshCrate', 'weekly veg boxes', 'gain', 'Order now.'));
  assert.equal(new Set(bodies).size, COPY_SHAPES.length); // real structural diversity
  assert.ok(bodies.every((b) => b.includes('Order now.'))); // the CTA rides every shape
  const loss = bodyShape('pas', 'Al Marwa Legal', 'contract review', 'loss');
  assert.match(loss, /too important to leave to chance/);
  const gain = bodyShape('pas', 'FreshCrate', 'weekly veg boxes', 'gain');
  assert.match(gain, /shouldn't be this hard/);
});

test('imageryPrompt: gaze rule + no-text rule on every style; casual mix switches the look', () => {
  for (const s of ['playful', 'credibility', 'demo'] as const) {
    const p = imageryPrompt(s, 'FreshCrate', 'veg boxes');
    assert.match(p, /never directly at the camera/); // the averted-gaze rule
    assert.match(p, /no words or lettering/);
  }
  assert.match(imageryPrompt('playful', 'X', 'y', { casual: true }), /smartphone photo style/);
  assert.doesNotMatch(imageryPrompt('playful', 'X', 'y', { casual: false }), /smartphone/);
});

test('planCreativeBatch: vertical tunes the pool; samples carry distinct plain-language angles', () => {
  // A dental brief → credibility style + proof-led headlines; casual mix appears every 3rd bg.
  const dental = planCreativeBatch({ product: 'Marina Dental', topics: ['teeth whitening'], vertical: 'dental' }, 30);
  assert.ok(dental.specs.some((s) => /calm and credible/.test(s.prompt)));
  assert.ok(dental.specs.some((s) => /smartphone photo style/.test(s.prompt)), 'UGC mix on by default');
  assert.ok(dental.samples.length >= 2);
  assert.equal(new Set(dental.samples.map((x) => x.angle)).size, dental.samples.length);
  // Voice override beats the vertical's auto style.
  const forced = planCreativeBatch({ product: 'Marina Dental', topics: ['whitening'], vertical: 'dental' }, 12, { voice: 'playful', casualMix: false });
  assert.ok(forced.specs.every((s) => !/smartphone/.test(s.prompt)));
  assert.ok(forced.specs.some((s) => /playful energy/.test(s.prompt)));
  // Structural body diversity across backgrounds.
  const bodies = new Set(dental.specs.map((s) => s.body.split('.')[0]));
  assert.ok(bodies.size >= 2);
});

// ---- Review-fix locks: no gate bypass, sanitized expert weights, no fabricated proof ----

test('gate bypass closed: a poisoned CTA never ships — dropped from body, image AND spec', async () => {
  const { checkAdCopy } = await import('../src/agent/social/copyCheck');
  const poisoned = { product: 'FreshCrate', topics: ['weekly veg boxes'], cta: "Hurry — don't miss out!" };
  const { specs, notes } = planCreativeBatch(poisoned as any, 12);
  assert.ok(specs.length >= 1, 'clean product/topic still produces ads');
  for (const s of specs) {
    assert.equal(s.cta, undefined, 'the failing CTA is composited on no image');
    for (const h of s.headlines) {
      assert.equal(checkAdCopy(h, s.body, {}).hard.length, 0, `shipped copy re-passes the gate: "${h}" / "${s.body}"`);
    }
  }
  assert.ok(notes.some((n) => /call-to-action/.test(n)), 'the user is told why their CTA was dropped');
});

test('gate bypass closed: wording that can never pass produces NOTHING, with an honest note', () => {
  // 'miracle' in the product name poisons every body that mentions it — nothing may ship.
  const { specs, notes } = planCreativeBatch({ product: 'Miracle Cleaning Services', topics: [] } as any, 6);
  assert.equal(specs.length, 0, 'failing copy never ships, period');
  assert.ok(notes.length >= 1 && notes.every((n) => /Reword/.test(n)), 'actionable skip notes');
});

test('archetypeCycle sanitizes the expert override: unknown keys, huge and non-finite weights', () => {
  // An unknown archetype name must not hang the loop (it could never decrement).
  const typo = archetypeCycle('playful', { grounded: false, override: { offers: 3 } as any });
  assert.ok(typo.length > 0 && typo.length <= 25);
  // A fat-fingered 1e9 clamps instead of materializing a billion-entry array.
  const huge = archetypeCycle('playful', { grounded: true, override: { offer: 1e9 } });
  assert.ok(huge.length <= 25, `clamped cycle, got ${huge.length}`);
  // Non-finite and negative weights are ignored / floored.
  assert.ok(archetypeCycle('demo', { grounded: true, override: { urgency: Infinity } }).length <= 25);
  assert.equal(archetypeCycle('demo', { grounded: true, override: { benefit: -5 } }).filter((a) => a === 'benefit').length, 0);
});

test('proof hook makes no fabricated countable claim', () => {
  assert.doesNotMatch(hookHeadline('proof', 'Marina Dental', 'whitening'), /hundreds|thousands|\d/i);
});
