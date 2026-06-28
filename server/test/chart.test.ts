import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVlSpec, renderChartSvg, makeSvgResponsive, chartSize, validateChartData, type ChartType } from '../src/agent/tools/chart';

test('validateChartData: flags data whose keys do not match x/y (the empty-chart bug), passes a match', () => {
  // The real bug: bar_h with value field "kg" but data rows keyed nation/value → empty axes shipped.
  const bad = validateChartData({ type: 'bar_h' as ChartType, x: 'nation', y: 'kg', data: [{ nation: 'Finland', value: 12 }, { nation: 'Norway', value: 9.9 }] } as any);
  assert.ok(bad && /"kg" isn't in your data/.test(bad), 'should flag the missing y field: ' + bad);
  assert.match(bad!, /nation, value/); // lists the actual keys to help the agent
  // Correct field names → no error.
  assert.equal(validateChartData({ type: 'bar_h' as ChartType, x: 'nation', y: 'value', data: [{ nation: 'Finland', value: 12 }] } as any), null);
  // Non-numeric value field is flagged; numeric strings are accepted (Vega coerces).
  assert.ok(/no numeric values/.test(validateChartData({ type: 'bar' as ChartType, x: 'm', y: 'v', data: [{ m: 'Jan', v: 'lots' }] } as any) || ''));
  assert.equal(validateChartData({ type: 'bar' as ChartType, x: 'm', y: 'v', data: [{ m: 'Jan', v: '10' }] } as any), null);
});

const sample = {
  bar: { type: 'bar' as ChartType, data: [{ m: 'Jan', v: 10 }, { m: 'Feb', v: 22 }], x: 'm', y: 'v', value_labels: true },
  line: { type: 'line' as ChartType, data: [{ m: 'Jan', v: 10 }, { m: 'Feb', v: 22 }, { m: 'Mar', v: 18 }], x: 'm', y: 'v' },
  dual_axis: {
    type: 'dual_axis' as ChartType,
    data: [{ m: 'Jan', leads: 100, rate: 3.1 }, { m: 'Feb', leads: 140, rate: 2.7 }],
    x: 'm', y: 'leads', y2: 'rate',
  },
  heatmap: {
    type: 'heatmap' as ChartType,
    data: [
      { mo: 'Jan', yr: '2024', v: 5 }, { mo: 'Feb', yr: '2024', v: 9 },
      { mo: 'Jan', yr: '2025', v: 7 }, { mo: 'Feb', yr: '2025', v: 3 },
    ],
    x: 'mo', y: 'yr', value: 'v', value_labels: true,
  },
};

test('buildVlSpec applies editorial defaults (transparent bg, our accent)', () => {
  const spec = buildVlSpec({ ...sample.bar, accent: '#c8962a' });
  assert.equal(spec.config.background, null);
  assert.equal(spec.config.range.category[0], '#c8962a'); // accent leads the categorical ramp
  assert.equal(spec.width >= 160, true);
});

test('buildVlSpec defaults the accent when none/invalid is given', () => {
  const spec = buildVlSpec({ type: 'bar', data: [{ m: 'A', v: 1 }], x: 'm', y: 'v', accent: 'not-a-hex' });
  assert.match(spec.config.range.category[0], /^#[0-9a-fA-F]{3,8}$/);
});

test('dual_axis builds two layers with independent y scales', () => {
  const spec = buildVlSpec(sample.dual_axis);
  assert.equal(spec.layer.length, 2);
  assert.equal(spec.resolve.scale.y, 'independent');
});

test('heatmap maps value to a colour ramp ending at the accent', () => {
  const spec = buildVlSpec({ ...sample.heatmap, accent: '#0a7d4f' });
  const rect = spec.layer[0];
  assert.deepEqual(rect.encoding.color.scale.range, ['#f5efe4', '#0a7d4f']);
  assert.equal(spec.layer.length, 2); // value_labels adds a text layer
});

test('buildVlSpec falls back to a (bar) chart on an unknown type — never throws', () => {
  const spec = buildVlSpec({ type: 'pie' as any, data: [{ a: 1, b: 2 }], x: 'a', y: 'b' });
  assert.equal(typeof spec, 'object');
  // produces a usable bar-style spec rather than failing the chart request
  assert.ok(JSON.stringify(spec).includes('"bar"'));
});

test('chartSize defaults to a full-measure width and floors a tiny request', () => {
  assert.equal(chartSize({ type: 'bar', data: [] }).width, 600); // full text-column default
  assert.equal(chartSize({ type: 'bar', data: [], width: 120 }).width, 360); // floored, never tiny
  assert.equal(chartSize({ type: 'bar', data: [], height: 50 }).height, 220); // floored
});

test('chartSize grows height with rows for bar_h / heatmap (avoids label collisions)', () => {
  const few = chartSize({ type: 'bar_h', data: Array.from({ length: 3 }, (_, i) => ({ i })) });
  const many = chartSize({ type: 'bar_h', data: Array.from({ length: 20 }, (_, i) => ({ i })) });
  assert.equal(many.height > few.height, true);
});

test('makeSvgResponsive makes the SVG fluid but keeps the viewBox', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="589" height="333" viewBox="0 0 589 333"><g/></svg>';
  const out = makeSvgResponsive(svg);
  assert.match(out, /style="[^"]*width:100%/);
  assert.match(out, /height:auto/);
  assert.match(out, /max-width:589px/); // capped at the natural size (no blurry upscaling)
  assert.match(out, /viewBox="0 0 589 333"/); // viewBox preserved so it scales
});

test('makeSvgResponsive replaces an existing inline style, not duplicates it', () => {
  const svg = '<svg width="600" height="300" viewBox="0 0 600 300" style="width:600px">x</svg>';
  const out = makeSvgResponsive(svg);
  assert.equal((out.match(/style="/g) || []).length, 1);
  assert.match(out, /width:100%/);
});

// Real Vega render (no browser / canvas). Covers the types Claude used + more.
for (const [name, args] of Object.entries(sample)) {
  test(`renderChartSvg emits valid SVG for ${name}`, async () => {
    const svg = await renderChartSvg(args as any);
    assert.equal(svg.trimStart().startsWith('<svg'), true, 'starts with <svg');
    assert.equal(svg.includes('</svg>'), true, 'closes the svg');
    assert.equal(svg.length > 500, true, 'non-trivial markup');
  });
}
