import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productAdBrief, buildProductFrameHtml } from '../src/agent/productShot';
import { PRODUCT_CATEGORIES, BACKDROP_CSS, BACKDROP_LABELS, findCategory, findTemplate } from '../../shared/productAds';

// ── Catalog integrity ─────────────────────────────────────────────────────────
// The catalog is pure data shared by the server brief compiler and the client Video
// studio; a duplicate id or an empty template silently breaks a picker or a brief.

test('PRODUCT_CATEGORIES: unique ids, each with at least one complete template', () => {
  const ids = PRODUCT_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'category ids must be unique');
  assert.ok(PRODUCT_CATEGORIES.length >= 10, 'the researched catalog covers at least 10 kinds of product');
  const total = PRODUCT_CATEGORIES.reduce((n, c) => n + c.templates.length, 0);
  assert.ok(total >= 36, `a real menu of ad styles across the catalog (got ${total})`);
  for (const cat of PRODUCT_CATEGORIES) {
    assert.ok(cat.label.trim(), `${cat.id}: label`);
    assert.ok(cat.templates.length >= 3, `${cat.id}: a real choice of ad styles (3+), got ${cat.templates.length}`);
    const keys = cat.templates.map((t) => t.key);
    assert.equal(new Set(keys).size, keys.length, `${cat.id}: template keys unique`);
    for (const t of cat.templates) {
      assert.ok(t.label.trim() && t.desc.trim(), `${cat.id}/${t.key}: label + desc (shown on the picker card)`);
      assert.ok(t.beats.length >= 2, `${cat.id}/${t.key}: a real shot plan has 2+ beats`);
      for (const b of t.beats) assert.ok(b.motion.trim() && b.view.trim(), `${cat.id}/${t.key}: beat motion + view`);
      assert.ok(t.light.trim() && t.audio.trim(), `${cat.id}/${t.key}: light + audio direction`);
    }
  }
});

test('backdrops: every labelled tile has a CSS scene, and vice versa', () => {
  const labelIds = BACKDROP_LABELS.map((b) => b.id);
  assert.equal(new Set(labelIds).size, labelIds.length, 'backdrop label ids unique');
  for (const b of BACKDROP_LABELS) assert.ok(BACKDROP_CSS[b.id], `${b.id}: has a CSS scene`);
  for (const id of Object.keys(BACKDROP_CSS)) assert.ok(labelIds.includes(id), `${id}: has a picker label`);
  for (const [id, css] of Object.entries(BACKDROP_CSS)) assert.match(css, /^background:/, `${id}: a plain background declaration`);
});

test('findCategory/findTemplate: lookups and misses', () => {
  assert.equal(findCategory('skincare')?.label, 'Skincare & beauty');
  assert.equal(findCategory('nope'), null);
  assert.ok(findTemplate('skincare', 'texture-ritual'));
  assert.equal(findTemplate('skincare', 'nope'), null);
});

// ── productAdBrief ────────────────────────────────────────────────────────────

test('productAdBrief: splits the template beats across the duration', () => {
  const brief = productAdBrief({ productName: 'Aurora Serum', categoryId: 'skincare', templateKey: 'texture-ritual', durationS: 12 });
  assert.match(brief, /0–4s:/);
  assert.match(brief, /4–8s:/);
  assert.match(brief, /8–12s:/);
  assert.match(brief, /skincare & beauty commercial for "Aurora Serum"/i);
  // The product-fidelity rule is the whole point of first-frame staging.
  assert.match(brief, /stay exactly as photographed/);
});

test('productAdBrief: category default template, tagline, and negatives flow through', () => {
  const brief = productAdBrief({ productName: 'X', categoryId: 'skincare', tagline: 'Glow, bottled.', durationS: 8 });
  assert.match(brief, /voiceover says: "Glow, bottled\."/);
  // texture-ritual is skincare's first template — its ad language + guardrails apply.
  assert.match(brief, /glowing, healthy skin/);
  assert.match(brief, /no warped faces or hands/);
});

test('productAdBrief: unknown category falls back to the generic hero plan', () => {
  const brief = productAdBrief({ productName: 'Widget', categoryId: 'not-a-category', durationS: 6 });
  assert.match(brief, /premium product commercial/);
  assert.match(brief, /orbit around the product/);
  assert.match(brief, /0–2s:/);
});

test('productAdBrief: duration clamps to the 4–15s the video models support', () => {
  assert.match(productAdBrief({ productName: 'X', durationS: 60 }), /–15s:/);
  assert.match(productAdBrief({ productName: 'X', durationS: 1 }), /–4s:/);
});

// ── buildProductFrameHtml ─────────────────────────────────────────────────────

test('buildProductFrameHtml: scene, product, shadow and reflection compose', () => {
  const html = buildProductFrameHtml({ imgDataUrl: 'data:image/png;base64,AAA', backdropId: 'studio-white', w: 1280, h: 720, isolated: true });
  assert.ok(html.includes(BACKDROP_CSS['studio-white'].replace(/^background:\s*/, 'background: ').replace('background: ', 'background:').slice(0, 20)) || html.includes('radial-gradient'), 'backdrop scene css present');
  assert.match(html, /drop-shadow/);
  assert.match(html, /scaleY\(-1\)/);
  assert.equal((html.match(/data:image\/png;base64,AAA/g) || []).length, 2, 'product appears as hero + reflection');
  // Isolated cutouts get a visible reflection; a raw rectangular photo must not (it would
  // mirror the whole photo including its background).
  assert.match(html, /opacity:0\.16/);
  const raw = buildProductFrameHtml({ imgDataUrl: 'data:image/jpeg;base64,BBB', backdropId: 'dark-luxury', w: 720, h: 1280, isolated: false });
  assert.match(raw, /opacity:0;/);
});

test('buildProductFrameHtml: unknown backdrop falls back to studio-white; dark scenes deepen the shadow', () => {
  const fallback = buildProductFrameHtml({ imgDataUrl: 'data:image/png;base64,A', backdropId: 'nope', w: 100, h: 100, isolated: true });
  assert.ok(fallback.includes(BACKDROP_CSS['studio-white']));
  const dark = buildProductFrameHtml({ imgDataUrl: 'data:image/png;base64,A', backdropId: 'neon-night', w: 100, h: 100, isolated: true });
  assert.match(dark, /rgba\(0,0,0,0\.65\)/);
});
