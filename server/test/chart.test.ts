import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVlSpec, renderChartSvg, type ChartType } from '../src/agent/tools/chart';

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

// Real Vega render (no browser / canvas). Covers the types Claude used + more.
for (const [name, args] of Object.entries(sample)) {
  test(`renderChartSvg emits valid SVG for ${name}`, async () => {
    const svg = await renderChartSvg(args as any);
    assert.equal(svg.trimStart().startsWith('<svg'), true, 'starts with <svg');
    assert.equal(svg.includes('</svg>'), true, 'closes the svg');
    assert.equal(svg.length > 500, true, 'non-trivial markup');
  });
}
