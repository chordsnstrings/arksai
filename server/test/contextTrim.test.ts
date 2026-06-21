import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimStaleResearch } from '../src/agent/runner';

// Build a realistic report-mode context: a user brief, several research turns
// (web_search / web_fetch / fetch_data with large bodies), then the render_report
// turn that produced the deliverable, then a QC/revise round.
function buildContext() {
  const bigResearch = 'SCRAPED PAGE: ' + 'x'.repeat(5000);
  return [
    { role: 'user', content: 'Build me a research report on EV market share in 2026.' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'ws1', type: 'function', function: { name: 'web_search', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'ws1', content: bigResearch },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'wf1', type: 'function', function: { name: 'web_fetch', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'wf1', content: bigResearch },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'fd1', type: 'function', function: { name: 'fetch_data', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'fd1', content: bigResearch },
    // THE deliverable is produced here (the report HTML lives in these args).
    {
      role: 'assistant',
      content: 'Rendering the report.',
      tool_calls: [
        {
          id: 'rr1',
          type: 'function',
          function: { name: 'render_report', arguments: JSON.stringify({ html: '<html>FULL REPORT BODY ' + 'y'.repeat(4000) + '</html>' }) },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'rr1', content: 'Rendered report.pdf (4 pages).' },
    // A QC / revise turn after the deliverable — must survive untouched.
    { role: 'user', content: 'A design review flagged a lonely page; tighten the flow.' },
  ];
}

test('trimStaleResearch: stubs old research tool-results once a deliverable is produced', () => {
  const ctx = buildContext();
  const changed = trimStaleResearch(ctx);
  assert.equal(changed, true);
  const STUB = '[research results — used in the report, trimmed to save context]';
  // The three research tool results (before render_report) are stubbed.
  assert.equal(ctx[2].content, STUB);
  assert.equal(ctx[4].content, STUB);
  assert.equal(ctx[6].content, STUB);
});

test('trimStaleResearch: preserves the report content, the user brief, and recent turns', () => {
  const ctx = buildContext();
  trimStaleResearch(ctx);
  // The report HTML (in the render_report tool_call args) is fully intact.
  const renderTurn = ctx[7] as any;
  assert.ok(renderTurn.tool_calls[0].function.arguments.includes('FULL REPORT BODY'));
  // The render_report tool RESULT is not a research dump → untouched.
  assert.equal(ctx[8].content, 'Rendered report.pdf (4 pages).');
  // The user brief survives.
  assert.equal(ctx[0].content, 'Build me a research report on EV market share in 2026.');
  // The post-deliverable QC turn survives.
  assert.equal((ctx[9] as any).content, 'A design review flagged a lonely page; tighten the flow.');
});

test('trimStaleResearch: leaves research VERBATIM when no deliverable has been produced yet', () => {
  const big = 'SCRAPED PAGE: ' + 'x'.repeat(5000);
  const ctx = [
    { role: 'user', content: 'research this' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'ws1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'ws1', content: big },
  ];
  const changed = trimStaleResearch(ctx as any);
  assert.equal(changed, false);
  assert.equal(ctx[2].content, big); // raw research stays until it's been baked into a deliverable
});

test('trimStaleResearch: is idempotent and never re-stubs / corrupts an already-trimmed context', () => {
  const ctx = buildContext();
  trimStaleResearch(ctx);
  const after1 = JSON.stringify(ctx);
  const changed2 = trimStaleResearch(ctx);
  assert.equal(changed2, false); // nothing left to do
  assert.equal(JSON.stringify(ctx), after1);
});

test('trimStaleResearch: does not stub a tiny research result (already cheap)', () => {
  const ctx = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'ws1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'ws1', content: 'short result' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'rr1', type: 'function', function: { name: 'render_report', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'rr1', content: 'rendered' },
  ];
  trimStaleResearch(ctx as any);
  assert.equal(ctx[2].content, 'short result'); // < 200 chars → left alone
});
