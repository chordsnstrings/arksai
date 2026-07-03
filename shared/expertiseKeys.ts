/**
 * EXPERTISE KEY REGISTRY — the single source of truth for the expertise *key set*.
 *
 * Adding an expertise used to mean hand-editing two unrelated files that drifted:
 *   • the client play catalog   (client/src/lib/departments.ts — the user-facing "play")
 *   • the server standards       (server/src/agent/expertise.ts — TASK standard + TASK_TRIGGERS)
 * with a comment that said "keys must match". A half-added expertise (a play with no
 * standard, or a standard with no play) shipped silently.
 *
 * This module is the ONE authoritative list of every `"<department>.<task>"` id and
 * which department it belongs to. Both sides reference it, and a server-side sync test
 * (server/test/expertiseRegistry.test.ts) fails the build the moment the play catalog,
 * the TASK standards, or the TASK_TRIGGERS diverge from this list. The *bodies* — the
 * actual standard prose, the trigger phrases, the play copy — stay where they are; this
 * registry governs the KEY/DEPARTMENT contract only, which is what kept drifting.
 *
 * To add an expertise: add its key here (under its department), then add the play,
 * the standard, and the triggers — the sync test enforces all three exist. See
 * EXPERTISE_AUTHORING.md for the full recipe.
 *
 * NOTE: keep this list IDENTICAL (same keys, same departments) to the play catalog and
 * the server standards. The order here groups by department for readability; tests
 * compare as sets, so order is cosmetic.
 */

/** The eight corporate functions ArksAI is organised around (display order = catalog order). */
export const DEPARTMENT_IDS = [
  'marketing',
  'sales',
  'finance',
  'people',
  'engineering',
  'bi',
  'tax',
  'legal',
  'personal',
  'learning',
] as const;

export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/**
 * Every canonical expertise key, grouped by department. The key format is
 * "<departmentId>.<task>". This is the contract every other file derives from.
 */
export const EXPERTISE_KEYS = [
  // marketing
  'marketing.landing',
  'marketing.emailkit',
  'marketing.creative',
  'marketing.storyad',
  'marketing.logo',
  'marketing.blog',
  'marketing.brief',
  'marketing.eventsite',
  'marketing.perfreport',
  'marketing.competitor',
  'marketing.audience',
  'marketing.calendar',
  'marketing.tracker',
  // sales
  'sales.pitchdeck',
  'sales.pricing',
  'sales.proposal',
  'sales.casestudy',
  'sales.outreach',
  'sales.accountbrief',
  'sales.battlecard',
  'sales.roi',
  'sales.accountplan',
  'sales.pipeline',
  // finance
  'finance.boarddeck',
  'finance.investorupdate',
  'finance.strategymemo',
  'finance.kpidashboard',
  'finance.variance',
  'finance.model',
  'finance.cashflow',
  'finance.scenario',
  'finance.budget',
  'finance.expenses',
  // people
  'people.jd',
  'people.offer',
  'people.policy',
  'people.handbook',
  'people.training',
  'people.survey',
  'people.peopledash',
  'people.onboardingportal',
  'people.onboardingchecklist',
  'people.teamtracker',
  'people.runbook',
  // engineering
  'engineering.internaltool',
  'engineering.prototype',
  'engineering.admin',
  'engineering.docssite',
  'engineering.engmetrics',
  'engineering.datadash',
  'engineering.api',
  'engineering.techdoc',
  'engineering.runbook',
  'engineering.designdoc',
  'engineering.statusreport',
  // engineering — developer tier (harvested from claude-skills)
  'engineering.schema',
  'engineering.apidesign',
  'engineering.apitests',
  'engineering.codereview',
  'engineering.depaudit',
  // bi
  'bi.dashboard',
  'bi.explorer',
  'bi.reviewdeck',
  'bi.datadict',
  'bi.adhoc',
  'bi.cohort',
  'bi.insight',
  'bi.forecast',
  'bi.scorecard',
  'bi.digest',
  'bi.alert',
  // tax
  'tax.guided',
  'tax.tax_invoice',
  'tax.einvoice',
  'tax.vat_return',
  'tax.ct_return',
  'tax.readiness',
  'tax.wps',
  'tax.excise_return',
  'tax.faf',
  // legal
  'legal.contract',
  'legal.nda',
  'legal.employment',
  'legal.poa',
  'legal.corporate',
  'legal.resolution',
  'legal.notice',
  'legal.policereport',
  'legal.opinion',
  'legal.review',
  'legal.forensic',
  'legal.compliance',
  'legal.dispute',
  'legal.licensing',
  'legal.calendar',
  // personal — everyday-life expertise for a non-business user ("for everyone")
  'personal.budget',
  'personal.savings',
  'personal.valuation',
  'personal.resume',
  'personal.coverletter',
  'personal.complaintletter',
  'personal.letter',
  'personal.emailrewrite',
  'personal.trip',
  'personal.event',
  'personal.checklist',
  // learning — teach / explain / study
  'learning.explainer',
  'learning.studyguide',
  'learning.summarize',
] as const;

export type ExpertiseKey = (typeof EXPERTISE_KEYS)[number];

/** Fast membership set (built once). */
const KEY_SET: ReadonlySet<string> = new Set(EXPERTISE_KEYS);
const DEPT_SET: ReadonlySet<string> = new Set(DEPARTMENT_IDS);

/** True if `key` is a registered canonical expertise key. */
export function isExpertiseKey(key: string): key is ExpertiseKey {
  return KEY_SET.has(key);
}

/** True if `id` is a registered department id. */
export function isDepartmentId(id: string): id is DepartmentId {
  return DEPT_SET.has(id);
}

/** The department id portion of an expertise key (the part before the dot). */
export function departmentOf(key: string): string {
  return key.split('.')[0];
}

/** Every key belonging to a department, in registry order. */
export function keysForDepartment(dept: DepartmentId): ExpertiseKey[] {
  return EXPERTISE_KEYS.filter((k) => departmentOf(k) === dept);
}
