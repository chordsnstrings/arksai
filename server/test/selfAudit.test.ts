import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// First-try correctness: the cheap pre-completion self-audit must be bounded by its OWN
// counter and must NEVER consume the verify/design gate budgets. A full Runner instance is
// too heavy to stand up here, so we assert the structural invariants of the source directly
// (the same approach craftComponents.test.ts takes for the CSS).
const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'runner.ts'), 'utf8');

function methodBody(src: string, name: string): string {
  const start = src.indexOf(`private async ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  // walk braces from the first { after the signature to the matching close
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

test('runCheapSelfAudit is bounded by its own selfAuditRounds counter', () => {
  assert.match(runner, /private selfAuditRounds = 0;/, 'a dedicated selfAuditRounds field exists');
  const body = methodBody(runner, 'runCheapSelfAudit');
  // a cap constant guards the top
  assert.match(body, /const MAX_SELF_AUDIT = \d+;/);
  assert.match(body, /this\.selfAuditRounds >= MAX_SELF_AUDIT/, 'returns early once the cap is hit');
  // it increments ITS OWN counter
  assert.match(body, /this\.selfAuditRounds\+\+/);
});

test('runCheapSelfAudit never touches the verify/design gate budgets (independent of their caps)', () => {
  const body = methodBody(runner, 'runCheapSelfAudit');
  assert.doesNotMatch(body, /this\.verifyRounds/, 'must not read or mutate verifyRounds');
  assert.doesNotMatch(body, /this\.designRounds/, 'must not read or mutate designRounds');
});

test('the self-audit runs BEFORE the verify/report gates at the completion point', () => {
  const selfAt = runner.indexOf('await this.runCheapSelfAudit(');
  const verifyAt = runner.indexOf('await this.runVerifyGate(');
  const reportAt = runner.indexOf('await this.runReportGate(');
  assert.ok(selfAt >= 0, 'self-audit is wired in');
  // the FIRST call site (the completion point) precedes both gate call sites
  assert.ok(selfAt < verifyAt, 'self-audit precedes runVerifyGate');
  assert.ok(selfAt < reportAt, 'self-audit precedes runReportGate');
});
