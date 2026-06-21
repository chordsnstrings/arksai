import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TASK_KEYS,
  DEPARTMENT_KEYS,
  TASK_TRIGGERS,
  DEPARTMENT_TRIGGERS,
  expertiseFor,
} from '../src/agent/expertise';
import {
  EXPERTISE_KEYS,
  DEPARTMENT_IDS,
  departmentOf,
} from '../../shared/expertiseKeys';

/**
 * REGISTRY SYNC / DRIFT TESTS (Phase 2 of EXPERTISE_PLAN.md).
 *
 * The single source of truth for the expertise KEY SET + departments is
 * shared/expertiseKeys.ts. These tests make a half-added expertise impossible:
 * every registered key must have a play (client catalog) AND a server TASK standard
 * AND TASK_TRIGGERS; every standard/trigger key must be registered (no orphans);
 * every department must have a persona AND department triggers; no two task keys may
 * share a trigger phrase. Deleting any one of these will fail the build.
 *
 * The client catalog is in another workspace, so it's read as TEXT and the play
 * `key: '...'` values are extracted with a regex (the same approach catalog.test.ts uses).
 */

const REGISTRY = new Set<string>(EXPERTISE_KEYS);
const REGISTRY_DEPTS = new Set<string>(DEPARTMENT_IDS);

// --- Extract the play keys from the client catalog (as text) ---
const catalogSrc = fs.readFileSync(
  path.join(__dirname, '../../client/src/lib/departments.ts'),
  'utf8',
);
const PLAY_KEYS = [...catalogSrc.matchAll(/key:\s*'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]);
const PLAY_KEY_SET = new Set<string>(PLAY_KEYS);

function diff(a: Iterable<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

// ---------------------------------------------------------------------------
// 1. The registry has no internal duplicates and is non-trivial.
// ---------------------------------------------------------------------------
test('registry: keys are unique and substantial', () => {
  assert.equal(new Set(EXPERTISE_KEYS).size, EXPERTISE_KEYS.length, 'duplicate key(s) in EXPERTISE_KEYS');
  assert.ok(EXPERTISE_KEYS.length >= 80, `expected ≥80 registered keys, found ${EXPERTISE_KEYS.length}`);
  for (const k of EXPERTISE_KEYS) {
    assert.match(k, /^[a-z]+\.[a-z_]+$/, `malformed registry key: ${k}`);
    assert.ok(REGISTRY_DEPTS.has(departmentOf(k)), `key "${k}" is in an unregistered department`);
  }
});

// ---------------------------------------------------------------------------
// 2. Every registered key has a SERVER standard AND triggers (no half-add).
// ---------------------------------------------------------------------------
test('sync: every registered key has a server TASK standard', () => {
  const missing = diff(EXPERTISE_KEYS, new Set(TASK_KEYS));
  assert.equal(missing.length, 0, `registered keys with NO server standard (TASK): ${missing.join(', ')}`);
});

test('sync: every registered key has TASK_TRIGGERS', () => {
  const missing = diff(EXPERTISE_KEYS, new Set(Object.keys(TASK_TRIGGERS)));
  assert.equal(missing.length, 0, `registered keys with NO triggers: ${missing.join(', ')}`);
});

test('sync: every registered key resolves to real expertise via expertiseFor', () => {
  const broken: string[] = [];
  for (const k of EXPERTISE_KEYS) {
    const e = expertiseFor(k);
    if (!e || e.length < 60) broken.push(`${k} (${e ? e.length + ' chars' : 'null'})`);
  }
  assert.equal(broken.length, 0, `registered keys with no/thin expertise: ${broken.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 3. No ORPHANS — every standard/trigger key must be registered.
// ---------------------------------------------------------------------------
test('sync: no orphan TASK standards (every standard key is registered)', () => {
  const orphans = diff(TASK_KEYS, REGISTRY);
  assert.equal(orphans.length, 0, `TASK standards with NO registered key: ${orphans.join(', ')}`);
});

test('sync: no orphan TASK_TRIGGERS (every trigger key is registered)', () => {
  const orphans = diff(Object.keys(TASK_TRIGGERS), REGISTRY);
  assert.equal(orphans.length, 0, `TASK_TRIGGERS with NO registered key: ${orphans.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 4. The CLIENT play catalog matches the registry exactly (both directions).
//    This is the test that makes client/server drift impossible.
// ---------------------------------------------------------------------------
test('sync: every registered key has a play in the client catalog', () => {
  const missing = diff(EXPERTISE_KEYS, PLAY_KEY_SET);
  assert.equal(missing.length, 0, `registered keys with NO client play: ${missing.join(', ')}`);
});

test('sync: every client play key is registered (no orphan plays)', () => {
  const orphans = diff(PLAY_KEYS, REGISTRY);
  assert.equal(orphans.length, 0, `client plays with NO registered key: ${orphans.join(', ')}`);
});

test('sync: the client catalog has no duplicate play keys', () => {
  assert.equal(PLAY_KEY_SET.size, PLAY_KEYS.length, 'duplicate play key(s) in departments.ts');
});

// ---------------------------------------------------------------------------
// 5. Departments — persona + triggers for every registered department.
// ---------------------------------------------------------------------------
test('sync: every registered department has a persona', () => {
  const missing = diff(DEPARTMENT_IDS, new Set(DEPARTMENT_KEYS));
  assert.equal(missing.length, 0, `registered departments with NO persona: ${missing.join(', ')}`);
});

test('sync: every registered department has DEPARTMENT_TRIGGERS', () => {
  const missing = diff(DEPARTMENT_IDS, new Set(Object.keys(DEPARTMENT_TRIGGERS)));
  assert.equal(missing.length, 0, `registered departments with NO triggers: ${missing.join(', ')}`);
});

test('sync: no orphan personas or department triggers (every dept id is registered)', () => {
  const personaOrphans = diff(DEPARTMENT_KEYS, REGISTRY_DEPTS);
  const trigOrphans = diff(Object.keys(DEPARTMENT_TRIGGERS), REGISTRY_DEPTS);
  assert.equal(personaOrphans.length, 0, `personas with NO registered dept: ${personaOrphans.join(', ')}`);
  assert.equal(trigOrphans.length, 0, `dept triggers with NO registered dept: ${trigOrphans.join(', ')}`);
});

test('sync: every registered key belongs to a registered department', () => {
  for (const k of EXPERTISE_KEYS) {
    assert.ok(REGISTRY_DEPTS.has(departmentOf(k)), `key "${k}" is in an unregistered department`);
  }
});

// ---------------------------------------------------------------------------
// 6. Trigger-phrase collision guard (no two task keys share a phrase).
// ---------------------------------------------------------------------------
test('collision: no two task keys share an identical trigger phrase', () => {
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

// ---------------------------------------------------------------------------
// 7. Counts line up (a quick belt-and-braces sanity that all four sides agree).
// ---------------------------------------------------------------------------
test('sync: registry, plays, standards, and triggers all have the SAME key count', () => {
  assert.equal(PLAY_KEYS.length, EXPERTISE_KEYS.length, 'play count != registry count');
  assert.equal(TASK_KEYS.length, EXPERTISE_KEYS.length, 'standard count != registry count');
  assert.equal(Object.keys(TASK_TRIGGERS).length, EXPERTISE_KEYS.length, 'trigger count != registry count');
});
