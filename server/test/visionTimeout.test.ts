import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage } from '../src/engines/minimax';

// Regression: M3 vision can buffer response headers for minutes, and ac.abort() does NOT
// reliably reject a pending undici fetch awaiting headers — so the verify/report gate froze
// (an 11-min stuck legal run). analyzeImage now races the fetch against its deadline and
// DEGRADES to {ok:false} instead of hanging. Proven here with a fetch that never resolves.
test('analyzeImage: a never-responding vision endpoint degrades (no infinite hang)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise(() => {})) as any; // never resolves, ignores abort
  process.env.MINIMAX_VISION_TIMEOUT_MS = '150';
  try {
    const t0 = Date.now();
    const r = await analyzeImage('data:image/png;base64,iVBORw0KGgo=', 'Is this legible?', new AbortController().signal);
    assert.equal(r.ok, false, 'should degrade, not succeed');
    assert.ok(Date.now() - t0 < 3000, `degraded promptly (was ${Date.now() - t0}ms), did not hang`);
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.MINIMAX_VISION_TIMEOUT_MS;
  }
});
