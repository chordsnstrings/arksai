import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStoryPlan,
  heuristicPlan,
  planStory,
  extractJson,
  estimateStory,
  planSummary,
  STORY_CAPS,
  EXTEND_INPUT_KTOK_480P,
} from '../src/agent/videoStory';
import { videoCostEstimate } from '../src/engines/seedance';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';
import { config } from '../src/config';

const ECOSINE =
  'A person walking through the desert, holding a phone, the camera zooms in to the phone where he has an app open that has a button that says "pick up by ecosine" and right after a helicopter drops a tesla right in front of him, with a suited driver stepping out of the tesla and opening the door for him.';

// ── normalizeStoryPlan (the pure safety guards) ───────────────────────────────

test('normalize: scene 1 can never chain or extend', () => {
  const p = normalizeStoryPlan({ scenes: [{ prompt: 'x', mechanism: 'frame-chain' }, { prompt: 'y', mechanism: 'extend' }] });
  assert.equal(p.scenes[0].mechanism, 't2v');
  assert.equal(p.scenes[1].mechanism, 'extend');
});

test('normalize: extension drift guard forces a cut after 2 consecutive extends', () => {
  const p = normalizeStoryPlan({
    scenes: [
      { prompt: 'a', mechanism: 't2v' },
      { prompt: 'b', mechanism: 'extend' },
      { prompt: 'c', mechanism: 'extend' },
      { prompt: 'd', mechanism: 'extend' },
    ],
  });
  assert.deepEqual(
    p.scenes.map((s) => s.mechanism),
    ['t2v', 'extend', 'extend', 'frame-chain'],
  );
  assert.ok(p.notes.some((n) => n.includes('drift')));
});

test('normalize: durations clamp per mechanism (12s on 1.5 paths, 15s on extend, 4s floor)', () => {
  const p = normalizeStoryPlan({
    scenes: [
      { prompt: 'a', mechanism: 't2v', durationS: 30 },
      { prompt: 'b', mechanism: 'extend', durationS: 30 },
      { prompt: 'c', mechanism: 'frame-chain', durationS: 1 },
    ],
  });
  assert.equal(p.scenes[0].durationS, STORY_CAPS.maxSceneS15);
  assert.equal(p.scenes[1].durationS, STORY_CAPS.maxSceneS20);
  assert.equal(p.scenes[2].durationS, STORY_CAPS.minSceneS);
});

test('normalize: composited without HTML degrades to t2v; HTML passes through', () => {
  const p = normalizeStoryPlan({
    scenes: [
      { prompt: 'a', mechanism: 'i2v-composited' },
      { prompt: 'b', mechanism: 'i2v-composited', compositeHtml: '<div>Pick up by ecosine</div>' },
    ],
  });
  assert.equal(p.scenes[0].mechanism, 't2v');
  assert.equal(p.scenes[1].mechanism, 'i2v-composited');
  assert.match(p.scenes[1].compositeHtml!, /ecosine/);
});

test('normalize: scene-count and total-length ceilings hold', () => {
  const many = { scenes: Array.from({ length: 12 }, (_, i) => ({ prompt: `s${i}`, mechanism: 't2v', durationS: 12 })) };
  const p = normalizeStoryPlan(many);
  assert.ok(p.scenes.length <= STORY_CAPS.maxScenes);
  assert.ok(p.scenes.reduce((n, s) => n + s.durationS, 0) <= STORY_CAPS.maxTotalS);
  assert.ok(p.notes.length > 0, 'truncation is surfaced, never silent');
});

// ── heuristic fail-open splitter ──────────────────────────────────────────────

test('heuristicPlan: sequence markers split the ecosine story into chained scenes', () => {
  const p = heuristicPlan(ECOSINE);
  assert.ok(p.scenes.length >= 2 && p.scenes.length <= 4);
  assert.equal(p.scenes[0].mechanism, 't2v');
  for (const s of p.scenes.slice(1)) assert.equal(s.mechanism, 'frame-chain');
  assert.ok(p.styleLine.length > 20);
});

// ── extractJson tolerance ─────────────────────────────────────────────────────

test('extractJson: fenced/prefixed replies and nested strings parse', () => {
  const obj = extractJson('Sure! Here is the plan:\n```json\n{"a":{"b":"quote \\" and {brace}"},"n":1}\n```');
  assert.deepEqual(obj, { a: { b: 'quote " and {brace}' }, n: 1 });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{"broken": '), null);
});

// ── planStory with an injected LLM (the ecosine fixture) ─────────────────────

test('planStory: a well-formed LLM plan passes through the guards intact', async () => {
  const fixture = JSON.stringify({
    styleLine: 'Style: cinematic photoreal, warm golden-hour desert light throughout.',
    scenes: [
      { what: 'Man walks the desert', prompt: 'A man in a linen shirt walks golden dunes holding a phone, aerial descending', durationS: 6, mechanism: 't2v', audioDirection: 'wind' },
      { what: 'The app close-up', prompt: 'Close on the phone: a thumb taps the pick-up button', durationS: 4, mechanism: 'i2v-composited', compositeHtml: '<div style="background:#111;color:#fff">Pick up by ecosine</div>', audioDirection: 'a soft UI tap' },
      { what: 'Helicopter delivers the car', prompt: 'The same man watches a helicopter lower a sleek black electric car on a cable onto the sand', durationS: 6, mechanism: 'frame-chain', audioDirection: 'rotor + cable clank' },
      { what: 'The driver opens the door', prompt: 'The same take continues: a suited driver steps out and opens the rear door for the man', durationS: 5, mechanism: 'extend', audioDirection: 'door thunk, rotor fading' },
    ],
  });
  const plan = await planStory(ECOSINE, { llm: async () => fixture });
  assert.equal(plan.scenes.length, 4);
  assert.deepEqual(
    plan.scenes.map((s) => s.mechanism),
    ['t2v', 'i2v-composited', 'frame-chain', 'extend'],
  );
  assert.match(plan.scenes[1].compositeHtml!, /Pick up by ecosine/);
  assert.equal(plan.scenes.reduce((n, s) => n + s.durationS, 0), 21);
  assert.ok(plan.estUsd > 0 && plan.estMinutes >= 1);
});

test('planStory: LLM failure falls open to the splitter, never throws', async () => {
  const plan = await planStory(ECOSINE, { llm: async () => null });
  assert.ok(plan.scenes.length >= 2);
  assert.ok(plan.notes.some((n) => n.includes('splitter')));
  const garbled = await planStory(ECOSINE, { llm: async () => 'not json at all' });
  assert.ok(garbled.scenes.length >= 2);
});

test('planStory: castRefs flow through when stills are provided', async () => {
  const fixture = JSON.stringify({
    styleLine: 'Style: x.',
    scenes: [
      { what: 'a', prompt: 'the hero product on marble', durationS: 4, mechanism: 't2v', castRefs: ['uploads/jar.png'], audioDirection: 'quiet' },
    ],
  });
  const plan = await planStory('a product story', { castImages: ['uploads/jar.png'], llm: async () => fixture });
  assert.deepEqual(plan.scenes[0].castRefs, ['uploads/jar.png']);
});

test('planStory: the default planner is a ModelArk text call (arkTextModel, thinking off, system prompt)', async () => {
  const plan = JSON.stringify({
    styleLine: 'Style: crisp documentary realism.',
    scenes: [
      { what: 'Open', prompt: 'A man walks across rippled dunes at dawn, slow aerial descent', durationS: 6, mechanism: 't2v', audioDirection: 'wind' },
      { what: 'Phone', prompt: 'The same man lifts his phone and taps the screen, close shot', durationS: 4, mechanism: 'frame-chain', audioDirection: 'tap' },
    ],
  });
  const realFetch = globalThis.fetch;
  const bodies: any[] = [];
  const urls: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    urls.push(String(url));
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n' + plan + '\n```' } }] }), { status: 200 });
  }) as any;
  __setByteplusKeyForTest('ark-test');
  try {
    const p = await planStory(ECOSINE);
    assert.equal(p.scenes.length, 2);
    assert.equal(p.scenes[1].mechanism, 'frame-chain');
    assert.ok(!p.notes.some((n) => n.includes('splitter')), 'the full planner answered');
    assert.equal(bodies.length, 1);
    assert.match(urls[0], /\/chat\/completions$/);
    assert.equal(bodies[0].model, config.arkTextModel);
    assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
    assert.equal(bodies[0].messages[0].role, 'system');
    assert.equal(bodies[0].max_tokens, 2200);
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
});

test('planStory: no ModelArk key, or a provider error, falls open to the splitter without throwing', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 });
  }) as any;
  try {
    __setByteplusKeyForTest('');
    const unkeyed = await planStory(ECOSINE);
    assert.equal(calls, 0, 'no key → no network');
    assert.ok(unkeyed.notes.some((n) => n.includes('splitter')));
    __setByteplusKeyForTest('ark-test');
    const errored = await planStory(ECOSINE);
    assert.equal(calls, 1);
    assert.ok(errored.scenes.length >= 2);
    assert.ok(errored.notes.some((n) => n.includes('splitter')));
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
});

// ── estimator + summary ───────────────────────────────────────────────────────

test('estimateStory: extends cost meaningfully more than fresh drafts', () => {
  const fresh = estimateStory([{ durationS: 6, mechanism: 't2v' }]);
  const ext = estimateStory([{ durationS: 6, mechanism: 'extend' }]);
  assert.ok(ext.estUsd > fresh.estUsd * 2);
});

test('estimateStory: prices each scene on the model the executor ACTUALLY renders it on', () => {
  const close = (a: number, b: number) => Math.abs(a - b) < 0.006; // estUsd is rounded to cents
  const on15 = (s: number) => videoCostEstimate('arksai-video-15', '480p', s);
  const on20f = (s: number) => videoCostEstimate('arksai-video-20-fast', '480p', s);
  // Plain cut → 1.5.
  assert.ok(close(estimateStory([{ durationS: 6, mechanism: 't2v' }]).estUsd, on15(6)));
  // A non-extend scene with cast refs renders on 2.0-fast r2v (was quoted at the 1.5 rate — ~2.9× under).
  for (const mechanism of ['t2v', 'frame-chain', 'i2v-composited'] as const) {
    const e = estimateStory([{ durationS: 6, mechanism, castRefs: ['uploads/jar.png'] }]).estUsd;
    assert.ok(close(e, on20f(6)), `${mechanism} + castRefs`);
    assert.ok(e > on15(6) * 2.5, `${mechanism} + castRefs is not quoted at the 1.5 rate`);
  }
  // A style anchor moves ONLY plain t2v scenes onto 2.0-fast…
  assert.ok(close(estimateStory([{ durationS: 6, mechanism: 't2v' }], { styleAnchor: true }).estUsd, on20f(6)));
  assert.ok(close(estimateStory([{ durationS: 6, mechanism: 't2v' }, { durationS: 6, mechanism: 'frame-chain' }], { styleAnchor: true }).estUsd, on20f(6) + on15(6)));
  // …and an opening frame anchors scene 1 instead (1.5 i2v), leaving later t2v scenes style-anchored.
  assert.ok(close(estimateStory([{ durationS: 6, mechanism: 't2v' }, { durationS: 6, mechanism: 't2v' }], { styleAnchor: true, openingFrame: true }).estUsd, on15(6) + on20f(6)));
  // Extends keep the 2.0-fast rate + the input-clip tokens.
  assert.ok(close(estimateStory([{ durationS: 6, mechanism: 'extend' }]).estUsd, on20f(6) + EXTEND_INPUT_KTOK_480P * config.seedanceCostPerKTok));
  // Time follows the routing too.
  assert.ok(estimateStory([{ durationS: 6, mechanism: 't2v', castRefs: ['a.png'] }]).estMinutes >= 1);
});

test('planSummary: the scene table reads for a human', () => {
  const p = normalizeStoryPlan({ scenes: [{ what: 'Desert walk', prompt: 'x', mechanism: 't2v', durationS: 6 }] });
  const s = planSummary(p);
  assert.match(s, /1 scenes|1\. \[6s · t2v\] Desert walk/);
  assert.match(s, /\$\d/);
});
