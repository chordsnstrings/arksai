import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productAdBrief, buildProductFrameHtml, buildLineupFrameHtml } from '../src/agent/productShot';
import { PRODUCT_CATEGORIES, UNIVERSAL_TEMPLATES, BACKDROP_CSS, BACKDROP_LABELS, findCategory, findTemplate, templatesFor } from '../../shared/productAds';
import { ART_STYLES, ART_STYLE_GROUPS, findArtStyle } from '../../shared/videoStyles';

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

test('universal styles: complete, unique, no key collisions, offered everywhere', () => {
  assert.ok(UNIVERSAL_TEMPLATES.length >= 8, 'a real universal menu');
  const uKeys = UNIVERSAL_TEMPLATES.map((t) => t.key);
  assert.equal(new Set(uKeys).size, uKeys.length, 'universal keys unique');
  for (const t of UNIVERSAL_TEMPLATES) {
    assert.ok(t.label.trim() && t.desc.trim() && t.beats.length >= 2 && t.light.trim() && t.audio.trim(), `${t.key}: complete`);
  }
  // A universal key must never shadow (or be shadowed by) a category's bespoke key —
  // findTemplate resolves bespoke first, so a collision would silently change meaning.
  for (const cat of PRODUCT_CATEGORIES) {
    for (const t of cat.templates) assert.ok(!uKeys.includes(t.key), `${cat.id}/${t.key} collides with a universal key`);
  }
  // Every category's menu = its bespoke styles then the universal set; General = universal only.
  for (const cat of PRODUCT_CATEGORIES) {
    const menu = templatesFor(cat.id);
    assert.equal(menu.length, cat.templates.length + UNIVERSAL_TEMPLATES.length, `${cat.id}: full menu`);
  }
  assert.equal(templatesFor('').length, UNIVERSAL_TEMPLATES.length);
  // Resolution: universal works WITH a category and WITHOUT one.
  assert.equal(findTemplate('skincare', 'unboxing')?.label, 'The unboxing');
  assert.equal(findTemplate('', 'zero-gravity')?.label, 'Zero gravity');
});

test('productAdBrief: a universal style drives the shot plan, with or without a category', () => {
  const noCat = productAdBrief({ productName: 'X', templateKey: 'unboxing', durationS: 9 });
  assert.match(noCat, /lid lifts in slow motion/);
  assert.match(noCat, /tissue foley/);
  const withCat = productAdBrief({ productName: 'X', categoryId: 'automotive', templateKey: 'retro-film', durationS: 9 });
  assert.match(withCat, /automotive commercial/);
  assert.match(withCat, /projector whir/);
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

test('buildLineupFrameHtml: hero centers, siblings flank, reflections only when isolated', () => {
  const items = [
    { imgDataUrl: 'data:image/png;base64,HERO', isolated: true },
    { imgDataUrl: 'data:image/png;base64,SIB1', isolated: true },
    { imgDataUrl: 'data:image/png;base64,SIB2', isolated: false },
  ];
  const html = buildLineupFrameHtml({ items, backdropId: 'studio-white', w: 1280, h: 720 });
  // Each product appears twice (hero image + reflection) in a shared row on one scene.
  for (const it of items) assert.equal((html.match(new RegExp(it.imgDataUrl, 'g')) || []).length, 2);
  assert.match(html, /class="row"/);
  // Hero (first item) renders center: row order for 3 = [sib2, hero, sib1] — hero is the 2nd slot.
  const slots = html.split('class="slot"').slice(1);
  assert.equal(slots.length, 3);
  assert.ok(slots[1].includes('HERO'), 'hero variant sits center');
  assert.ok(slots[1].includes('scale(1)'), 'hero at full size');
  assert.ok(slots[0].includes('scale(0.82)') && slots[2].includes('scale(0.82)'), 'siblings slightly smaller');
  // The non-isolated photo must not mirror its rectangular background.
  assert.ok(slots.find((s) => s.includes('SIB2'))!.includes('opacity:0"'), 'raw photo gets no reflection');
});

test('new universal styles resolve: problem→solution, hype cut, line-up', () => {
  assert.match(productAdBrief({ productName: 'X', templateKey: 'problem-solution', durationS: 12 }), /relatable everyday frustration/);
  assert.match(productAdBrief({ productName: 'X', templateKey: 'speed-ramp', durationS: 6 }), /speed ramp/);
  const lineup = productAdBrief({ productName: 'X', categoryId: 'skincare', templateKey: 'family-lineup', durationS: 12 });
  assert.match(lineup, /product range standing in a confident row/);
  assert.match(lineup, /no invented variants/);
});

test('ART_STYLES: unique ids, complete phrases, every group populated', () => {
  const ids = ART_STYLES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'style ids unique');
  assert.ok(ART_STYLES.length >= 20, 'a comprehensive style menu');
  for (const s of ART_STYLES) {
    assert.ok(s.label.trim() && s.phrase.trim().length > 20, `${s.id}: label + a real style phrase`);
    assert.ok(ART_STYLE_GROUPS.includes(s.group), `${s.id}: known group`);
  }
  for (const g of ART_STYLE_GROUPS) {
    assert.ok(ART_STYLES.some((s) => s.group === g), `${g}: has styles`);
  }
  assert.equal(findArtStyle('claymation')?.group, 'Animated & illustrated');
  assert.equal(findArtStyle('nope'), null);
  // Every phrase must trip the prompt compiler's HAS_STYLE guard so the default premium
  // grade never overwrites a chosen style (mirror of videoBrief.ts's regex).
  const HAS_STYLE = /cinematic|editorial|photoreal|anim(e|ated)|illustrat|film|35mm|4k|grade|grain|stylized|noir|documentary|vintage|retro|watercolou?r|3d render/i;
  const EXTRA = /cartoon|claymation|paper|comic|pixel|low-poly|sketch|neon|synthwave|fantasy|toy|surreal|handheld|ugc|dream|saturated|luxury|glow/i;
  for (const s of ART_STYLES) {
    assert.ok(HAS_STYLE.test(s.phrase) || EXTRA.test(s.phrase), `${s.id}: phrase carries a recognizable style signal`);
  }
});

test('buildProductFrameHtml: unknown backdrop falls back to studio-white; dark scenes deepen the shadow', () => {
  const fallback = buildProductFrameHtml({ imgDataUrl: 'data:image/png;base64,A', backdropId: 'nope', w: 100, h: 100, isolated: true });
  assert.ok(fallback.includes(BACKDROP_CSS['studio-white']));
  const dark = buildProductFrameHtml({ imgDataUrl: 'data:image/png;base64,A', backdropId: 'neon-night', w: 100, h: 100, isolated: true });
  assert.match(dark, /rgba\(0,0,0,0\.65\)/);
});
