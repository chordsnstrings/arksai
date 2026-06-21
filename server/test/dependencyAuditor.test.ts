import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditManifest } from '../src/agent/tools/dependencyAuditor';

const PKG = JSON.stringify({
  name: 'demo',
  dependencies: {
    lodash: '^4.17.20', // floating (^) → flagged
    express: '4.18.2', // exact pin → NOT flagged floating
    'left-pad': '*', // fully unpinned → flagged unpinned (high)
    beta: '0.3.1', // pre-1.0 pin → old-pin (low)
  },
  devDependencies: {
    lodash: '4.17.21', // DUPLICATE of dependencies.lodash → flagged
    typescript: '~5.4.0', // floating (~)
  },
});

test('package.json: floating ^ range is flagged', () => {
  const r = auditManifest('package.json', PKG, null);
  assert.equal(r.manifest_type, 'package.json');
  const f = r.findings.find((x) => x.category === 'floating' && x.dependency === 'lodash');
  assert.ok(f, 'expected lodash ^range flagged as floating');
  assert.equal(f!.severity, 'medium');
});

test('package.json: exact pin is NOT flagged as floating', () => {
  const r = auditManifest('package.json', PKG, null);
  const express = r.deps.find((d) => d.name === 'express' && d.scope === 'dependencies')!;
  assert.equal(express.floating, false);
  const flagged = r.findings.some(
    (x) => (x.category === 'floating' || x.category === 'unpinned') && x.dependency === 'express',
  );
  assert.equal(flagged, false);
});

test('package.json: a duplicate across scopes is flagged', () => {
  const r = auditManifest('package.json', PKG, null);
  const dup = r.findings.find((x) => x.category === 'duplicate' && x.dependency === 'lodash');
  assert.ok(dup, 'expected lodash duplicate flagged');
  assert.equal(dup!.severity, 'high');
  assert.equal(r.summary.duplicates, 1);
});

test('package.json: a fully unpinned "*" is flagged high', () => {
  const r = auditManifest('package.json', PKG, null);
  const u = r.findings.find((x) => x.category === 'unpinned' && x.dependency === 'left-pad');
  assert.ok(u, 'expected left-pad "*" flagged unpinned');
  assert.equal(u!.severity, 'high');
});

test('package.json: a pre-1.0 pin is flagged as old-pin', () => {
  const r = auditManifest('package.json', PKG, null);
  const old = r.findings.find((x) => x.category === 'old-pin' && x.dependency === 'beta');
  assert.ok(old, 'expected pre-1.0 "beta" flagged');
  assert.equal(old!.severity, 'low');
});

test('an honest, non-fabricated CVE note is ALWAYS present (no offline CVE claim)', () => {
  const r = auditManifest('package.json', PKG, null);
  const note = r.findings.find((x) => x.category === 'cve-note');
  assert.ok(note, 'expected an info-level cve-note finding');
  assert.equal(note!.severity, 'info');
  assert.match(r.cve_note, /OFFLINE/);
  assert.match(r.cve_note, /npm audit/);
  // The tool must NOT have manufactured any CVE id.
  const blob = JSON.stringify(r);
  assert.equal(/CVE-\d{4}-\d+/.test(blob), false, 'tool must never fabricate a CVE id offline');
});

test('missing lockfile is flagged when known to be absent', () => {
  const r = auditManifest('package.json', PKG, false);
  const lf = r.findings.find((x) => x.category === 'no-lockfile');
  assert.ok(lf, 'expected a no-lockfile finding when lockfilePresent=false');
  assert.equal(r.summary.lockfile_present, false);
});

test('requirements.txt: parses pins/ranges and flags the floating one', () => {
  const req = [
    '# a comment',
    'requests==2.31.0', // exact → not floating',
    'flask>=2.0', // floating
    'numpy', // no spec → unpinned (floats to latest)
    '-r base.txt', // ignored
  ].join('\n');
  const r = auditManifest('requirements.txt', req, null);
  assert.equal(r.manifest_type, 'requirements.txt');
  assert.equal(r.summary.total, 3);
  const requests = r.deps.find((d) => d.name === 'requests')!;
  assert.equal(requests.floating, false);
  const flask = r.deps.find((d) => d.name === 'flask')!;
  assert.equal(flask.floating, true);
  const numpy = r.deps.find((d) => d.name === 'numpy')!;
  assert.equal(numpy.floating, true);
  assert.ok(r.findings.some((x) => x.category === 'unpinned' && x.dependency === 'numpy'));
});
