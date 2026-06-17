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
type Hit = { kind: 'key' | 'mode' | 'model'; val: string; at: number };
const hits: Hit[] = [];
for (const m of src.matchAll(/key:\s*'([a-z]+\.[a-z_]+)'/g)) hits.push({ kind: 'key', val: m[1], at: m.index! });
for (const m of src.matchAll(/\bmode:\s*'([a-z]+)'/g)) hits.push({ kind: 'mode', val: m[1], at: m.index! });
for (const m of src.matchAll(/\bmodel:\s*([A-Za-z0-9_]+)/g)) hits.push({ kind: 'model', val: m[1], at: m.index! });
hits.sort((a, b) => a.at - b.at);

// walk in order → each key takes the next mode after it, and the next model BEFORE the
// following key (model is optional per play; null if the next model belongs to a later play)
const plays: { key: string; mode: string; model: string | null }[] = [];
const keyHits = hits.filter((h) => h.kind === 'key');
for (let i = 0; i < keyHits.length; i++) {
  const start = keyHits[i].at;
  const end = i + 1 < keyHits.length ? keyHits[i + 1].at : Infinity;
  const within = (k: Hit['kind']) => hits.find((h) => h.kind === k && h.at > start && h.at < end)?.val ?? null;
  plays.push({ key: keyHits[i].val, mode: within('mode') ?? '(none)', model: within('model') });
}

// every real, ready-to-run brief (the literal first message the play sends)
const prompts = [...src.matchAll(/prompt:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);

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

test('catalog: every play that pins a model uses a routable one (A=auto / M3=max)', () => {
  // departments.ts pins models via two constants only: A (arksai-auto) and M3 (arksai-max).
  // Anything else is a wiring typo that would route a play to a non-existent model.
  for (const p of plays) {
    if (p.model === null) continue; // optional — routes by mode default
    assert.ok(['A', 'M3'].includes(p.model), `${p.key}: unroutable model constant "${p.model}"`);
  }
});

test('catalog: EVERY play carries a substantial, ready-to-run prompt (the user input)', () => {
  // The prompt IS the first message the play sends — an empty/stub one is a broken input.
  assert.equal(prompts.length, plays.length, `expected one prompt per play (${plays.length}), found ${prompts.length}`);
  const thin = prompts.filter((p) => p.trim().length < 80);
  assert.equal(thin.length, 0, `plays with a thin/empty prompt: ${thin.map((p) => JSON.stringify(p.slice(0, 30))).join(', ')}`);
});
