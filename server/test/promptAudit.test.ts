import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSystemPrompt, intakeContext } from '../src/agent/prompts';
import { classifyTask } from '../src/agent/taskProfile';
import { typePacks } from '../src/agent/designSystem';
import { renderChartTool } from '../src/agent/tools/chart';
import { generateSpreadsheetTool } from '../src/agent/tools/excel';
import { expertiseFor } from '../src/agent/expertise';

// ---------------------------------------------------------------------------
// Prompt-quality audit (2026-07-02) — one locking test per executed fix, so a
// future prompt edit can't silently reintroduce a resolved contradiction.
// ---------------------------------------------------------------------------

const SRC = (rel: string) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

const codeSession = { id: 's', mode: 'code', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;
const reportSession = { id: 's', mode: 'report', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;
const schedSession = { id: 's', mode: 'code', task: 'scheduled', model: 'arksai-auto', orgId: null, projectId: null } as any;

// 1. Design-brief compiler must steer to DISTINCTIVE (the rubric's bar), never mandate muted.
test('audit#1: designBrief compiler aligns with the distinctiveness rubric', () => {
  const s = SRC('agent/designBrief.ts');
  assert.match(s, /DISTINCTIVE, art-directed for its subject/);
  assert.match(s, /restraint must be a['\s+]+deliberate choice, never the default/i); // spans a string-concat line break
  assert.doesNotMatch(s, /minimal, modern, muted/); // the old contradiction
  // and the AVOID list names the rubric's fail patterns
  assert.match(s, /named FAIL patterns in design review/);
  assert.match(s, /generic minimal-muted AI look/);
});

// 2. Scheduled runs get the unattended block (and it overrides ask-first guidance).
test('audit#2: task:"scheduled" injects the unattended-run block in every mode', () => {
  const p = buildSystemPrompt(schedSession, '/tmp', '');
  assert.match(p, /Unattended scheduled run — no user is present/);
  assert.match(p, /NEVER ask a clarifying question/);
  assert.match(p, /OVERRIDDEN here/);
  // a normal session does NOT carry it
  assert.doesNotMatch(buildSystemPrompt(codeSession, '/tmp', ''), /Unattended scheduled run/);
});

// 3. DOCX is a first-class deliverable with a real protocol; the bar-lowering line is gone.
test('audit#3: docx protocol exists and the bar-lowering line is removed', () => {
  const p = buildSystemPrompt(reportSession, '/tmp', '');
  assert.match(p, /first-class deliverable held to the same editorial bar/);
  assert.match(p, /Heading 1 → 2 → 3, never skipping levels/);
  assert.doesNotMatch(p, /won't be as richly designed/);
});

// 4. Creative QC checks subject + baked text + legibility with machine verdicts,
//    and the tool descriptions demand subject fidelity.
test('audit#4: creative QC verdicts are broad + actionable; subject fidelity steered', () => {
  const engine = SRC('agent/creative.ts');
  assert.match(engine, /REVISE:SUBJECT/);
  assert.match(engine, /REVISE:TEXT_IN_IMAGE/);
  assert.match(engine, /REVISE:LEGIBILITY/);
  assert.match(engine, /regenerated the background once/); // every class has an action
  const tool = SRC('agent/tools/creative.ts');
  assert.match(tool, /SUBJECT FIDELITY/);
  assert.match(tool, /name LANDMARKS precisely/i);
  const img = SRC('agent/tools/minimax.ts');
  assert.match(img, /SUBJECT FIDELITY/);
});

// 5. Page fill has ONE canonical floor/target framing in both document protocols.
test('audit#5: page-fill floor (60%) + target (85–100%) are stated as floor/target', () => {
  const report = buildSystemPrompt(reportSession, '/tmp', '');
  assert.match(report, /≥60% is the hard FLOOR/);
  assert.match(report, /85–100%/);
  assert.match(report, /floor is a minimum for the worst page, never the goal|~85–100% the TARGET/);
});

// 6. One canonical intake rule (one round, ≤4 questions, scheduled never asks).
test('audit#6: canonical intake doctrine', () => {
  const s = intakeContext(classifyTask('build a web app for tracking habits', 'code'));
  assert.match(s, /THE ONE INTAKE RULE/);
  assert.match(s, /usually one, never more than four/);
  assert.match(s, /unattended scheduled run,\s+never ask at all/);
});

// 7. Charts get number-format + chart-choice guidance; xlsx currency follows the brief.
test('audit#7: chart number formats + xlsx currency parameter', () => {
  const d = renderChartTool.description;
  assert.match(d, /NUMBER FORMAT/);
  assert.match(d, /155K/);
  assert.match(d, /never default to \$/);
  assert.match(d, /CHART CHOICE/);
  const params: any = generateSpreadsheetTool.parameters;
  assert.ok(params.properties.currency, 'generate_spreadsheet has a currency option');
  assert.match(String(params.properties.currency.description), /AED/);
});

// 8. Native mobile builds get their own design core that supersedes the web CSS one.
test('audit#8: native design core exists inside the mobile pack', () => {
  const m = typePacks.mobile;
  assert.match(m, /NATIVE DESIGN CORE/);
  assert.match(m, /REPLACES the web CSS design system/);
  assert.match(m, /44pt minimum touch targets/);
  assert.match(m, /NEVER emoji as icons/);
});

// 9. Revise/failure messages explain HOW to fix, not just what failed.
test('audit#9: web design revise + publish failure are fix-explaining', () => {
  const runner = SRC('agent/runner.ts');
  assert.match(runner, /HOW TO FIX \(targeted edits ONLY/);
  assert.match(runner, /design_direction/);
  const pub = SRC('agent/tools/publish.ts');
  assert.match(pub, /diagnose in this order/);
  assert.match(pub, /process\.env\.PORT/);
});

// 10. The bare expertise entries were uplifted to the structure→method→bar→failure pattern.
test('audit#10: dashboard/techdoc/teamtracker standards carry real task rigor', () => {
  for (const key of ['finance.kpidashboard', 'people.peopledash', 'engineering.datadash', 'engineering.techdoc', 'people.teamtracker']) {
    const s = expertiseFor(key);
    assert.ok(s && s.length > 400, `${key} is no longer a bare constant`);
    assert.match(s!, /COMMON FAILURE/, `${key} names its common failure`);
  }
  assert.match(expertiseFor('finance.kpidashboard')!, /runway/);
  assert.match(expertiseFor('engineering.techdoc')!, /quickstart/i);
});

// ---------------------------------------------------------------------------
// One-pass doctrine (operator, 2026-07-02): "one pass if it works — iterate
// only on a named issue." Locks the doctrine + the craft/checkpoint reconciliation
// + the finish-before-stop budget notice.
// ---------------------------------------------------------------------------
import { checkpointPlanGuidance } from '../src/agent/checkpoint';

test('doctrine: ONE PASS IF IT WORKS is the code-mode default', () => {
  const p = buildSystemPrompt(codeSession, '/tmp', '');
  assert.match(p, /ONE PASS IF IT WORKS/);
  assert.match(p, /iterate ONLY on a NAMED, concrete defect/i);
  assert.match(p, /TRUST DIRECT OBSERVATION OVER A NOISY INSTRUMENT/);
});

test('doctrine: checkpoint guidance is the SAME one-pass rule per step (no contradiction)', () => {
  const g = checkpointPlanGuidance();
  assert.match(g, /Same one-pass rule, applied per STEP/);
  assert.match(g, /Never add steps \(or extra passes\) a working result doesn't need/);
  assert.doesNotMatch(g, /Do NOT try to produce everything in one pass/); // the old contradicting line
});

test('doctrine: finish-before-stop budget notice exists in the runner', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'runner.ts'), 'utf8');
  assert.match(runner, /BUDGET NOTICE — WRAP UP NOW/);
  assert.match(runner, /maxRunTokens \* 0\.6/);
});

// ---------------------------------------------------------------------------
// "Fix the things exposed" (operator, 2026-07-02, from the live method bake-off):
// auto-continue instead of death, wrap-up teeth, harness auto-checkpoints,
// idempotent publish-proxy rewrite, and the no-hand-rolled-server/prefix rule.
// ---------------------------------------------------------------------------
import { rewriteHtml } from '../src/routes/deployments';

test('exposed#1: auto-continue — a checkpointed build compacts and continues, never asks for "continue"', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'runner.ts'), 'utf8');
  assert.match(runner, /AUTO-CONTINUE/);
  assert.match(runner, /MAX_AUTO_WINDOWS/);
  assert.match(runner, /Auto-continuing from checkpoint/);
  assert.match(runner, /context\.length = 0/); // real compaction, not another append
});

test('exposed#2: wrap-up has teeth — no new design rounds after the budget notice', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'runner.ts'), 'utf8');
  assert.match(runner, /!this\.wrapUp && this\.designRounds </);
});

test('exposed#3: harness auto-checkpoint on every verified gate pass', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'runner.ts'), 'utf8');
  assert.match(runner, /autoCheckpoint\(dir\)/);
  assert.match(runner, /auto: verified build state/);
});

test('exposed#4: publish-proxy rewrite is idempotent (kills the double-prefix bug)', () => {
  const html = '<html><head></head><body></body></html>';
  const out = rewriteHtml(html, '/apps/taskforge/');
  // the injected fx() must skip URLs that ALREADY carry the prefix
  assert.match(out, /u\.indexOf\(B\)!==0/);
});

test('exposed#5: the CODE prompt forbids client prefix-detection + hand-rolled servers', () => {
  const p = buildSystemPrompt(codeSession, '/tmp', '');
  assert.match(p, /PUBLISH PREFIX/);
  assert.match(p, /NEVER add your own prefix-detection/);
  assert.match(p, /DOUBLE-PREFIXES/);
});

test('exposed#6: checkpoint steps are the default for standard builds too (not only heavy)', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'runner.ts'), 'utf8');
  assert.match(runner, /tier !== 'light' && !this\.simpleBuild/);
});
