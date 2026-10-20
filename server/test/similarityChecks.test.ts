import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisionUnchangedDefects, REVISION_UNCHANGED_COSINE, tiledPrompt } from '../src/agent/uiCheck';
import { duplicatePageDefects, DUPLICATE_PAGE_COSINE } from '../src/agent/deliverableCheck';

// Skylark-embedding similarity checks (pure): a design REVISE round whose re-render is visually
// identical to the previous one, and consecutive near-identical pages in a rendered deliverable.

const A = [1, 0, 0, 0];
const B = [0, 1, 0, 0];
const C = [0, 0, 1, 0];
// cos(A, nearA) ≈ 0.9999 — above both thresholds, but not an exact copy.
const nearA = [1, 0.01, 0, 0];

// ---------------------------------------------------------------- revisionUnchangedDefects

test('REVISION_UNCHANGED_COSINE sits just below 1 (only a no-op revision trips it)', () => {
  assert.ok(REVISION_UNCHANGED_COSINE > 0.95 && REVISION_UNCHANGED_COSINE < 1);
});

test('revisionUnchangedDefects: identical screenshot vectors → one blocking defect line', () => {
  const out = revisionUnchangedDefects(A, [...A]);
  assert.equal(out.length, 1);
  assert.match(out[0], /no effect on the rendered page/);
  assert.match(out[0], /similarity 1\.000/);
  // it tells the agent where the fix probably went wrong
  assert.match(out[0], /actually served/);
});

test('revisionUnchangedDefects: a near-identical re-render (≥ threshold) is still flagged', () => {
  assert.equal(revisionUnchangedDefects(A, nearA).length, 1);
});

test('revisionUnchangedDefects: a visibly different re-render → no defect', () => {
  assert.deepEqual(revisionUnchangedDefects(A, B), []);
  assert.deepEqual(revisionUnchangedDefects([1, 1, 0, 0], [1, 0, 1, 0]), []); // cos = 0.5
});

test('revisionUnchangedDefects: missing / empty / mismatched vectors → no defect', () => {
  assert.deepEqual(revisionUnchangedDefects(null, A), []);
  assert.deepEqual(revisionUnchangedDefects(A, null), []);
  assert.deepEqual(revisionUnchangedDefects(undefined, undefined), []);
  assert.deepEqual(revisionUnchangedDefects([], []), []);
  assert.deepEqual(revisionUnchangedDefects(A, [1, 0, 0]), []); // length mismatch → cosine 0
});

test('revisionUnchangedDefects: the threshold argument is honoured', () => {
  const half = [1, 1, 0, 0];
  const other = [1, 0, 1, 0]; // cos ≈ 0.5 (float: 0.4999…)
  assert.deepEqual(revisionUnchangedDefects(half, other), []);
  assert.equal(revisionUnchangedDefects(half, other, 0.49).length, 1);
});

// ---------------------------------------------------------------- tiledPrompt

test('tiledPrompt: a single tile (or none) returns the rubric unchanged', () => {
  assert.equal(tiledPrompt(1, 'RUBRIC'), 'RUBRIC');
  assert.equal(tiledPrompt(0, 'RUBRIC'), 'RUBRIC');
});

test('tiledPrompt: several tiles are framed as ONE page whose slice cuts are not defects', () => {
  const p = tiledPrompt(3, 'RUBRIC');
  assert.match(p, /These 3 images are consecutive top-to-bottom slices of ONE full-page screenshot/);
  assert.match(p, /NOT a defect/);
  assert.ok(p.endsWith('RUBRIC'), 'the rubric follows the framing');
});

// ---------------------------------------------------------------- duplicatePageDefects

test('DUPLICATE_PAGE_COSINE sits just below 1', () => {
  assert.ok(DUPLICATE_PAGE_COSINE > 0.95 && DUPLICATE_PAGE_COSINE < 1);
});

test('duplicatePageDefects: pages N and N+1 near-identical → flagged with 1-based page numbers', () => {
  const out = duplicatePageDefects([B, A, nearA, C]);
  assert.equal(out.length, 1);
  assert.match(out[0], /pages 2 and 3 look identical/);
  assert.match(out[0], /duplicated page\/slide/);
});

test('duplicatePageDefects: every consecutive repeat is reported', () => {
  const out = duplicatePageDefects([A, A, A]);
  assert.equal(out.length, 2);
  assert.match(out[0], /pages 1 and 2/);
  assert.match(out[1], /pages 2 and 3/);
});

test('duplicatePageDefects: distinct pages → none (and only NEIGHBOURS are compared)', () => {
  assert.deepEqual(duplicatePageDefects([A, B, C]), []);
  // page 1 and page 3 match, but they are not consecutive → not a duplicate
  assert.deepEqual(duplicatePageDefects([A, B, A]), []);
});

test('duplicatePageDefects: pages with missing embeddings are skipped, never compared across', () => {
  assert.deepEqual(duplicatePageDefects([A, null, A]), []);
  assert.deepEqual(duplicatePageDefects([A, undefined, [], A]), []);
  // a gap does not hide a real repeat elsewhere
  const out = duplicatePageDefects([null, B, B]);
  assert.equal(out.length, 1);
  assert.match(out[0], /pages 2 and 3/);
});

test('duplicatePageDefects: zero or one page → nothing to compare', () => {
  assert.deepEqual(duplicatePageDefects([]), []);
  assert.deepEqual(duplicatePageDefects([A]), []);
});

test('duplicatePageDefects: the threshold argument is honoured', () => {
  const half = [1, 1, 0, 0];
  const other = [1, 0, 1, 0]; // cos ≈ 0.5 (float: 0.4999…)
  assert.deepEqual(duplicatePageDefects([half, other]), []);
  assert.equal(duplicatePageDefects([half, other], 0.49).length, 1);
});
