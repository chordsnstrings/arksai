import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCreativeBatch, hookHeadline, estimateBatchCostUsd, generateImagePool,
  HOOK_ARCHETYPES, BATCH_FORMATS, EST_COST_PER_BACKGROUND_USD,
} from '../src/agent/social/creativeBatch';

const BRIEF = { product: 'FreshCrate', topics: ['weekly veg boxes', 'same-day delivery'], cta: 'Order now' };

test('planCreativeBatch: ~30 creatives → 10 backgrounds × 3 archetype-diverse headlines', () => {
  const specs = planCreativeBatch(BRIEF, 30);
  assert.equal(specs.length, 10); // ceil(30/3)
  for (const s of specs) {
    assert.equal(s.headlines.length, 3);
    assert.equal(new Set(s.headlines).size, 3); // archetype rotation → distinct hooks
    assert.match(s.prompt, /no words or lettering/); // text-free imagery rule
    assert.ok((BATCH_FORMATS as readonly string[]).includes(s.aspect));
  }
  // Formats rotate across mobile + web.
  assert.ok(new Set(specs.map((s) => s.aspect)).size >= 4);
  // Topics cycle.
  assert.ok(specs.some((s) => s.topic === 'weekly veg boxes') && specs.some((s) => s.topic === 'same-day delivery'));
});

test('planCreativeBatch clamps: tiny + huge requests', () => {
  assert.equal(planCreativeBatch(BRIEF, 1).length, 1);
  assert.equal(planCreativeBatch(BRIEF, 500).length, Math.ceil(50 / 3)); // hard cap 50 creatives
  assert.equal(planCreativeBatch({ product: 'X', topics: [] }, 3).length, 1); // no topics → product
});

test('hookHeadline covers every archetype distinctly', () => {
  const set = new Set(HOOK_ARCHETYPES.map((a) => hookHeadline(a, 'FreshCrate', 'weekly veg boxes')));
  assert.equal(set.size, HOOK_ARCHETYPES.length);
});

test('estimateBatchCostUsd is per-background', () => {
  const specs = planCreativeBatch(BRIEF, 30);
  assert.equal(estimateBatchCostUsd(specs), Math.round(10 * EST_COST_PER_BACKGROUND_USD * 100) / 100);
});

test('generateImagePool: a zero budget skips everything BEFORE any generation call', async () => {
  const out = await generateImagePool(BRIEF, 30, '/tmp', new AbortController().signal, { maxUsd: 0 });
  assert.equal(out.pool.length, 0);
  assert.equal(out.generatedBackgrounds, 0);
  assert.equal(out.skippedSpecs, 10);
  assert.match(out.errors[0], /generation cap \$0 reached/); // honest, never silent
});

test('generateImagePool: an aborted signal stops the loop', async () => {
  const ac = new AbortController();
  ac.abort();
  const out = await generateImagePool(BRIEF, 30, '/tmp', ac.signal, { maxUsd: 100 });
  assert.equal(out.pool.length, 0);
  assert.equal(out.skippedSpecs, 10);
});
