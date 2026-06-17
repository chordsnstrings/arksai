import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expertiseFor } from '../src/agent/expertise';
import { SESSION_MODES } from '../../shared/types';

/**
 * COMPLETE catalog audit: every play a user can launch (the client catalog) must
 * resolve to real server-side expertise and carry a valid mode — so no department
 * tile can ever fire a brief the agent has no persona/standards for, or an invalid
 * mode. Parsed from the source of truth (departments.ts) as text so the server test
 * needs no client (@shared) module resolution. Pairs each key with the mode that
 * follows it in document order (each play declares key before mode).
 */
const src = fs.readFileSync(path.join(__dirname, '../../client/src/lib/departments.ts'), 'utf8');

// ordered occurrences of key: '…' and mode: '…'
type Hit = { kind: 'key' | 'mode'; val: string; at: number };
const hits: Hit[] = [];
for (const m of src.matchAll(/key:\s*'([a-z]+\.[a-z_]+)'/g)) hits.push({ kind: 'key', val: m[1], at: m.index! });
for (const m of src.matchAll(/\bmode:\s*'([a-z]+)'/g)) hits.push({ kind: 'mode', val: m[1], at: m.index! });
hits.sort((a, b) => a.at - b.at);

// walk in order → each key takes the next mode after it
const plays: { key: string; mode: string }[] = [];
for (let i = 0; i < hits.length; i++) {
  if (hits[i].kind === 'key') {
    const nextMode = hits.slice(i + 1).find((h) => h.kind === 'mode');
    plays.push({ key: hits[i].val, mode: nextMode?.val ?? '(none)' });
  }
}

const DEPTS = ['marketing', 'sales', 'finance', 'people', 'engineering', 'bi', 'tax', 'legal'];

test('catalog: a substantial number of plays are defined (sanity)', () => {
  assert.ok(plays.length >= 80, `expected ≥80 plays, found ${plays.length}`);
});

test('catalog: every play key is well-formed and in a known department', () => {
  for (const p of plays) {
    assert.match(p.key, /^[a-z]+\.[a-z_]+$/, `malformed key: ${p.key}`);
    assert.ok(DEPTS.includes(p.key.split('.')[0]), `unknown dept in key: ${p.key}`);
  }
});

test('catalog: NO duplicate play keys', () => {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const p of plays) {
    if (seen.has(p.key)) dups.push(p.key);
    seen.add(p.key);
  }
  assert.equal(dups.length, 0, `duplicate keys: ${dups.join(', ')}`);
});

test('catalog: EVERY play key resolves to real server-side expertise (persona + standards)', () => {
  const broken: string[] = [];
  for (const p of plays) {
    const e = expertiseFor(p.key);
    if (!e || e.length < 60) broken.push(`${p.key} (${e ? e.length + ' chars' : 'null'})`);
  }
  assert.equal(broken.length, 0, `plays with no/thin expertise: ${broken.join(', ')}`);
});

test('catalog: every play declares a valid session mode', () => {
  for (const p of plays) {
    assert.ok(SESSION_MODES.includes(p.mode as any), `${p.key}: invalid mode "${p.mode}"`);
  }
});
