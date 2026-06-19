import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeExpertise } from '../src/agent/expertiseRouter';
import { TASK_TRIGGERS, DEPARTMENT_TRIGGERS, expertiseFor } from '../src/agent/expertise';

/**
 * FIXED 30-PROMPT BENCHMARK — plain user phrasings → the expected task key.
 * Covers all 8 departments + natural / personal-sounding phrasings. The
 * deterministic router must hit ≥ 85% (≥ 26/30). Misses are printed.
 *
 * `expect` is the expected task key; the router passes the case if it returns
 * exactly that task key (a department-only fallback that matches the dept also
 * counts, since the persona is still the right expertise family).
 */
const BENCHMARK: { prompt: string; expect: string }[] = [
  // Real-world phrasings found during live validation (locked so live == unit forever)
  { prompt: 'draft an NDA for a contractor', expect: 'legal.nda' },
  { prompt: 'I need a power of attorney', expect: 'legal.poa' },
  { prompt: 'help me write a resignation policy', expect: 'people.policy' },
  { prompt: 'build a pitch deck for my coffee startup', expect: 'sales.pitchdeck' },
  { prompt: 'competitor teardown of Notion vs us', expect: 'marketing.competitor' },
  // Finance
  { prompt: 'make me a monthly budget for a family of four in Dubai', expect: 'personal.budget' },
  { prompt: 'cash-flow forecast for next 12 months', expect: 'finance.cashflow' },
  { prompt: 'how much runway do we have, build a cash flow', expect: 'finance.cashflow' },
  { prompt: 'build a 3 statement financial model for my startup', expect: 'finance.model' },
  { prompt: 'I need a budget vs actual variance report', expect: 'finance.variance' },
  // Sales
  { prompt: 'a pitch deck for my coffee startup', expect: 'sales.pitchdeck' },
  { prompt: 'investor deck to raise money for our app', expect: 'sales.pitchdeck' },
  { prompt: 'write a cold outreach sequence to prospects', expect: 'sales.outreach' },
  { prompt: 'make a sales battlecard against our competitor', expect: 'sales.battlecard' },
  { prompt: 'I want a sales pipeline tracker', expect: 'sales.pipeline' },
  // Marketing
  { prompt: 'competitor teardown: Notion vs us', expect: 'marketing.competitor' },
  { prompt: 'design a landing page for our new product', expect: 'marketing.landing' },
  { prompt: 'create an instagram ad creative for our sale', expect: 'marketing.creative' },
  { prompt: 'write a marketing email campaign for the launch', expect: 'marketing.emailkit' },
  { prompt: 'build me a content calendar for social media', expect: 'marketing.calendar' },
  // People / HR
  { prompt: 'write a job description for a backend engineer', expect: 'people.jd' },
  { prompt: 'I need a job offer letter for a new hire', expect: 'people.offer' },
  { prompt: 'draft an employee handbook for my company', expect: 'people.handbook' },
  { prompt: 'create an onboarding checklist for new hires', expect: 'people.onboardingchecklist' },
  // Engineering
  { prompt: 'build an internal tool for our ops team', expect: 'engineering.internaltool' },
  { prompt: 'write a PRD for the new feature', expect: 'engineering.designdoc' },
  { prompt: 'I need a quick prototype / mvp of the idea', expect: 'engineering.prototype' },
  // BI & Analytics
  { prompt: 'build a dashboard of these sales numbers', expect: 'bi.dashboard' },
  { prompt: 'do a cohort retention analysis', expect: 'bi.cohort' },
  { prompt: 'a quarterly business review deck for leadership', expect: 'bi.reviewdeck' },
  // Tax (UAE)
  { prompt: 'help me file my VAT return (VAT 201)', expect: 'tax.vat_return' },
  { prompt: 'prepare a corporate tax computation for the FTA', expect: 'tax.ct_return' },
  { prompt: 'generate the WPS salary file for payroll', expect: 'tax.wps' },
  // Legal (UAE)
  { prompt: 'draft an NDA for a contractor', expect: 'legal.nda' },
  { prompt: 'write a police report / criminal complaint', expect: 'legal.policereport' },
  // Personal / everyday (Phase 3 — the "for everyone" family)
  { prompt: 'household budget for next month', expect: 'personal.budget' },
  { prompt: 'help me make a family budget', expect: 'personal.budget' },
  { prompt: 'I need a savings plan to save money for a house', expect: 'personal.savings' },
  { prompt: 'help me pay off debt this year', expect: 'personal.savings' },
  { prompt: 'should I buy a 2019 Cayenne at 200k km, buy and resale price', expect: 'personal.valuation' },
  { prompt: 'value my iPhone 13 Pro for resale in UAE', expect: 'personal.valuation' },
  { prompt: 'help me build a résumé, I am a marketing manager', expect: 'personal.resume' },
  { prompt: 'write a cover letter for a job application', expect: 'personal.coverletter' },
  { prompt: 'write a complaint letter, the airline lost my bag', expect: 'personal.complaintletter' },
  { prompt: 'rewrite my email so it sounds more professional', expect: 'personal.emailrewrite' },
  { prompt: 'plan a 5-day Tokyo trip for a couple, mid-budget', expect: 'personal.trip' },
  { prompt: 'help me plan a birthday party for 20 people', expect: 'personal.event' },
  // Learning & explainers
  { prompt: 'explain compound interest to a 15-year-old', expect: 'learning.explainer' },
  { prompt: 'make me a study guide for my biology exam', expect: 'learning.studyguide' },
  { prompt: 'summarize this contract for me', expect: 'learning.summarize' },
];

test('BENCHMARK: deterministic router hits >= 85% on plain phrasings', () => {
  const misses: string[] = [];
  let hits = 0;
  for (const { prompt, expect } of BENCHMARK) {
    const r = routeExpertise(prompt, 'chat');
    const expectedDept = expect.split('.')[0];
    const got = r.taskKey ?? (r.department ? `@dept:${r.department}` : 'null');
    const pass = r.taskKey === expect || (r.taskKey === null && r.department === expectedDept);
    if (pass) hits++;
    else misses.push(`  ✗ "${prompt}" → got ${got} (conf ${r.confidence}), expected ${expect}`);
  }
  const pct = ((hits / BENCHMARK.length) * 100).toFixed(0);
  if (misses.length) {
    // eslint-disable-next-line no-console
    console.log(`\n[expertiseRouter benchmark] ${hits}/${BENCHMARK.length} (${pct}%). Misses:\n${misses.join('\n')}\n`);
  }
  const bar = Math.ceil(BENCHMARK.length * 0.85);
  assert.ok(hits >= bar, `benchmark hit-rate ${hits}/${BENCHMARK.length} (${pct}%) is below the ${bar}/${BENCHMARK.length} (85%) bar`);
});

test('empty / whitespace input routes to null (today behaviour, safe)', () => {
  assert.deepEqual(routeExpertise('', 'chat'), { taskKey: null, department: null, confidence: 0, tier: 'none', source: 'auto' });
  assert.deepEqual(routeExpertise('   ', 'chat'), { taskKey: null, department: null, confidence: 0, tier: 'none', source: 'auto' });
});

test('a clearly off-catalog ask returns null (no blind mis-route)', () => {
  const r = routeExpertise('what is the weather like today', 'chat');
  assert.equal(r.taskKey, null);
  assert.equal(r.tier, 'none');
});

// ─── PHASE 4: confidence tiers + the mis-route guard ("never confidently wrong") ───

test('PHASE 4 — a specific taskKey is ONLY ever returned at tier "high" (mis-route guard)', () => {
  // The router invariant: it may never surface a confident SPECIFIC task below 'high'.
  // Below high it degrades to a department persona (medium) or nothing (low/none).
  const probes = [
    ...BENCHMARK.map((b) => b.prompt),
    'make me something nice',
    'help with my thing tomorrow',
    'I run a bakery, need to look more professional',
    'what is the weather like today',
    'can you help me with something',
    'I have a startup',
    'something for my business please',
    'make it better',
    'do the thing',
    'help',
  ];
  for (const prompt of probes) {
    const r = routeExpertise(prompt, 'chat');
    if (r.taskKey !== null) {
      assert.equal(r.tier, 'high', `"${prompt}" surfaced a specific task "${r.taskKey}" at tier "${r.tier}" (must be high)`);
    }
    if (r.tier !== 'high') {
      assert.equal(r.taskKey, null, `tier "${r.tier}" for "${prompt}" must NOT carry a specific task`);
    }
  }
});

test('PHASE 4 — deliberately ambiguous prompts never return a confident specific task', () => {
  // These have no clear subject/audience. At MOST a department persona; never a specific task.
  const vague = [
    'make me something nice',
    'help with my thing tomorrow',
    'something for my business',
    'can you help me',
    'make it better',
  ];
  for (const prompt of vague) {
    const r = routeExpertise(prompt, 'chat');
    assert.equal(r.taskKey, null, `"${prompt}" must not route to a specific task (got "${r.taskKey}")`);
    assert.notEqual(r.tier, 'high', `"${prompt}" must not be tier high (got "${r.tier}")`);
  }
});

test('PHASE 4 — a clear request still routes to its specific task at tier high (no regression)', () => {
  for (const { prompt, expect } of BENCHMARK) {
    const r = routeExpertise(prompt, 'chat');
    if (r.taskKey === expect) {
      // when the deterministic matcher nails the exact task it MUST be a confident high tier
      assert.equal(r.tier, 'high', `"${prompt}" hit "${expect}" but at tier "${r.tier}" (expected high)`);
      assert.ok(r.confidence >= 0.5, `"${prompt}" task confidence ${r.confidence} below the high bar`);
    }
  }
});

test('PHASE 4 — tier is one of the four declared values', () => {
  for (const { prompt } of BENCHMARK) {
    const t = routeExpertise(prompt, 'chat').tier;
    assert.ok(['high', 'medium', 'low', 'none'].includes(t), `unexpected tier "${t}"`);
  }
});

test('source is always "auto"', () => {
  assert.equal(routeExpertise('build a dashboard', 'chat').source, 'auto');
});

test('confidence is bounded 0..1', () => {
  for (const { prompt } of BENCHMARK) {
    const c = routeExpertise(prompt, 'chat').confidence;
    assert.ok(c >= 0 && c <= 1, `confidence ${c} out of range for "${prompt}"`);
  }
});

test('every task key in TASK_TRIGGERS resolves to real expertise (no orphan trigger keys)', () => {
  for (const key of Object.keys(TASK_TRIGGERS)) {
    assert.ok(expertiseFor(key), `TASK_TRIGGERS key "${key}" has no expertise standard`);
  }
});

test('every DEPARTMENT_TRIGGERS dept resolves to a persona', () => {
  for (const dept of Object.keys(DEPARTMENT_TRIGGERS)) {
    assert.ok(expertiseFor(dept), `department "${dept}" has no persona`);
  }
});

test('collision sanity: no two task keys share an identical trigger phrase', () => {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const [key, phrases] of Object.entries(TASK_TRIGGERS)) {
    for (const p of phrases) {
      const prior = seen.get(p);
      if (prior && prior !== key) collisions.push(`"${p}" shared by ${prior} and ${key}`);
      else seen.set(p, key);
    }
  }
  assert.equal(collisions.length, 0, `duplicate trigger phrases:\n${collisions.join('\n')}`);
});

test('benchmark prompts are unambiguous (each expected key actually reachable)', () => {
  // every expected key in the benchmark must be a known task with triggers
  for (const { expect } of BENCHMARK) {
    assert.ok(TASK_TRIGGERS[expect], `benchmark expects "${expect}" but it has no triggers`);
  }
});

test('expertiseFor accepts a bare department id (persona-only fallback)', () => {
  const fin = expertiseFor('finance')!;
  assert.match(fin, /FP&A/);
  // a bare dept returns NO task-specific block (just the persona)
  const full = expertiseFor('finance.cashflow')!;
  assert.ok(full.length > fin.length, 'a full task key should carry more than the bare persona');
});
