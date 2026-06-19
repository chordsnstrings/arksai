import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expertiseFor } from '../src/agent/expertise';
import { LEGAL_TASKS } from '../src/agent/legal/uae';
import { buildSystemPrompt } from '../src/agent/prompts';

test('expertiseFor: null for no task or unknown key', () => {
  assert.equal(expertiseFor(null), null);
  assert.equal(expertiseFor(undefined), null);
  assert.equal(expertiseFor('nope.nope'), null);
});

test('expertiseFor: finance task carries FP&A rigor + task specifics', () => {
  const e = expertiseFor('finance.cashflow')!;
  assert.match(e, /FP&A/);
  assert.match(e, /assumption/i);
  assert.match(e, /cash/i);
  assert.match(e, /never fabricate/i);
});

test('expertiseFor: HR job description enforces inclusive standards', () => {
  const e = expertiseFor('people.jd')!;
  assert.match(e, /inclusive/i);
  assert.match(e, /gender/i);
});

test('expertiseFor: sales battlecard + marketing landing carry their craft', () => {
  assert.match(expertiseFor('sales.battlecard')!, /comparison|battlecard|why we win/i);
  assert.match(expertiseFor('marketing.landing')!, /CTA/);
});

test('marketing wires in MiniMax image generation (persona + creative/email plays)', () => {
  // the brand-growth persona steers to the composited creative generator + raw image gen
  assert.match(expertiseFor('marketing.landing')!, /generate_creative/);
  assert.match(expertiseFor('marketing.landing')!, /generate_image/);
  // the dedicated creative play + the email/social kit use generate_creative (text-on-image)
  assert.match(expertiseFor('marketing.creative')!, /generate_creative/i);
  assert.match(expertiseFor('marketing.emailkit')!, /generate_creative/i);
});

test('marketing creative asks for the logo + carries high-conversion social tactics', () => {
  const c = expertiseFor('marketing.creative')!;
  assert.match(c, /logo/i); // prompt the user for / pass a logo
  assert.match(c, /logo_placeholder/); // …or a clean placeholder
  assert.match(c, /CTA|call-to-action/i); // a single clear CTA
  assert.match(c, /thumb/i); // the SOCIAL block ("make the thumb stop")
});

test('email and social are optimized for their own medium — no social-scroll tactics in email', () => {
  const email = expertiseFor('marketing.emailkit')!;
  assert.match(email, /subject|preheader|inbox/i); // email's own levers
  assert.doesNotMatch(email, /thumb/i); // NOT loaded with the social-scroll playbook
});

test('expertiseFor: every department persona resolves', () => {
  for (const d of ['marketing', 'sales', 'finance', 'people', 'engineering', 'bi']) {
    assert.ok(expertiseFor(`${d}.kpidashboard`) || expertiseFor(`${d}.unknown`) === null);
    // a known key per dept returns a block
  }
  assert.ok(expertiseFor('engineering.designdoc'));
});

test('expertiseFor: personal/everyday family resolves with the right rigor', () => {
  // friendly persona, not corporate
  const persona = expertiseFor('personal')!;
  assert.match(persona, /plain language|everyday|friendly/i);
  // valuation must demand real cited prices, no fabrication
  const val = expertiseFor('personal.valuation')!;
  assert.match(val, /resale|cite|never fabricate/i);
  // budget is friendly + formula-driven, not FP&A
  const budget = expertiseFor('personal.budget')!;
  assert.match(budget, /formula|what.s left|household|monthly/i);
  // résumé is ATS-friendly
  assert.match(expertiseFor('personal.resume')!, /ATS|action-verb|quantif/i);
});

test('expertiseFor: learning family teaches accurately and never fabricates', () => {
  const persona = expertiseFor('learning')!;
  assert.match(persona, /teacher|explain|level/i);
  assert.match(expertiseFor('learning.summarize')!, /faithful|tl.dr|only what/i);
  assert.match(expertiseFor('learning.explainer')!, /intuition|example|level/i);
});

test('expertiseFor: BI & Analytics tasks carry analytics rigor', () => {
  assert.match(expertiseFor('bi.dashboard')!, /F-pattern|KPI/i);
  assert.match(expertiseFor('bi.datadict')!, /definition|metric/i);
  assert.match(expertiseFor('bi.forecast')!, /formula|assumption/i);
  assert.ok(expertiseFor('bi.alert'));
});

test('expertiseFor: Legal — converse in the user language; bilingual is by destination; internal defaults to English', () => {
  const e = expertiseFor('legal.contract')!;
  assert.match(e, /BRITISH ENGLISH/);
  assert.match(e, /jurisdiction/i);
  assert.match(e, /licensed UAE advocate|licensed UAE lawyer/i);
  assert.match(e, /not legal advice/i);
  // the CONVERSATION mirrors the user's language, never bilingual chat
  assert.match(e, /MATCH THE USER/i);
  assert.match(e, /same language the user/i);
  assert.doesNotMatch(e, /bilingual by default/i);
  // bilingual is BY DESTINATION (government/court/notary); internal → default English
  assert.match(e, /BY DESTINATION/i);
  assert.match(e, /government|court|notary/i);
  assert.match(e, /DEFAULT ENGLISH/i);
});

test('expertiseFor: government-facing legal docs are bilingual; internal ones default to English', () => {
  const police = expertiseFor('legal.policereport')!;
  assert.match(police, /BILINGUAL/);
  assert.match(police, /Penal Code|Public Prosecution/i);
  // internal work product → English by default, not bilingual
  assert.match(expertiseFor('legal.forensic')!, /default English/i);
  assert.match(expertiseFor('legal.opinion')!, /default English/i);
  for (const k of Object.keys(LEGAL_TASKS)) {
    assert.match(expertiseFor(k) ?? '', /BRITISH ENGLISH/, `${k} resolves with the legal persona`);
  }
});

test('buildSystemPrompt: injects the expert standards when the session has a task', () => {
  const base: any = { id: 's', title: 't', mode: 'code', model: 'arksai-auto', repoName: null, branch: null, projectId: null, status: 'idle', task: null };
  const profile: any = { type: 'dashboard', isVisual: true, tier: 'standard' };
  const without = buildSystemPrompt(base, '/tmp', '', profile);
  const withTask = buildSystemPrompt({ ...base, task: 'finance.cashflow' }, '/tmp', '', profile);
  assert.doesNotMatch(without, /Expert standards for this task/);
  assert.match(withTask, /Expert standards for this task/);
  assert.match(withTask, /FP&A/);
});
