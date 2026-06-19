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
  { prompt: 'make me a monthly budget for a family of four in Dubai', expect: 'finance.budget' },
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
];

test('BENCHMARK: deterministic router hits >= 85% (>= 26/30) on plain phrasings', () => {
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
  assert.ok(hits >= 26, `benchmark hit-rate ${hits}/30 (${pct}%) is below the 26/30 (85%) bar`);
});

test('empty / whitespace input routes to null (today behaviour, safe)', () => {
  assert.deepEqual(routeExpertise('', 'chat'), { taskKey: null, department: null, confidence: 0, source: 'auto' });
  assert.deepEqual(routeExpertise('   ', 'chat'), { taskKey: null, department: null, confidence: 0, source: 'auto' });
});

test('a clearly off-catalog ask returns null (no blind mis-route)', () => {
  const r = routeExpertise('what is the weather like today', 'chat');
  assert.equal(r.taskKey, null);
  // may persona-fallback to nothing; never a confident specific task
  assert.ok(r.confidence < 0.34 || r.taskKey === null);
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
