import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCreativeBatch, hookHeadline, estimateBatchCostUsd, generateImagePool,
  HOOK_ARCHETYPES, BATCH_FORMATS, EST_COST_PER_BACKGROUND_USD,
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
