import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoiseDeliverable } from '../src/agent/runner';

// The user's complaint: a build surfaced package.json / package-lock.json as "deliverables".
// The download chips must be ONLY what the user asked for, never project scaffolding.
test('isNoiseDeliverable: project scaffolding is filtered out', () => {
  for (const f of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'app.json',
    'vite.config.ts',
    'tailwind.config.js',
    'next.config.mjs',
    'components.json',
    'pom.xml',
    'androidmanifest.xml',
    'ui-kit/icons.svg',
    'favicon.png',
    'node_modules/lib/data.json',
    'dist/bundle.zip',
    'build/output.csv',
    'report-fonts/fonts.css',
  ]) {
    assert.equal(isNoiseDeliverable(f), true, `${f} should be noise`);
  }
});

test('isNoiseDeliverable: genuine user deliverables pass through', () => {
  for (const f of [
    'GIC-Global-report.pdf',
    'financial-model.xlsx',
    'offer-letter.docx',
    'pitch-deck.pptx',
    'logo.svg',
    'hero.png',
    'creative.jpg',
    'brand-kit.zip',
    'einvoice.xml', // PINT AE e-invoice — a real compliance deliverable
    'wps.sif',
    'export-data.csv',
  ]) {
    assert.equal(isNoiseDeliverable(f), false, `${f} should be a real deliverable`);
  }
});

import { isIntermediateAsset, dedupeVersions } from '../src/agent/runner';

// The user's "why so many deliverables?" — a single deck surfaced 3 versioned PDFs + 6 icon
// rasters + a slide-chart PNG. Intermediates (embedded assets) must not appear as downloads.
test('isIntermediateAsset: embedded build assets are not standalone deliverables', () => {
  for (const f of ['icon-4-0.png', 'icon-12.png', 'slide-chart-2.png', 'chart-1.png',
                   'deck.preview.html', 'charts/top10.svg', 'charts/trend.png']) {
    assert.equal(isIntermediateAsset(f), true, `${f} should be intermediate`);
  }
  // Real deliverables are NOT intermediates.
  for (const f of ['freshbox-pitch-deck.pdf', 'model.xlsx', 'hero.png', 'logo.svg', 'report.docx']) {
    assert.equal(isIntermediateAsset(f), false, `${f} should be a real deliverable`);
  }
});

test('dedupeVersions: collapses revise-round versions, keeps distinct files', () => {
  const mk = (name: string) => ({ name });
  const kept = dedupeVersions([
    mk('freshbox-pitch-deck.pdf'), mk('freshbox-pitch-deck-v2.pdf'), mk('freshbox-pitch-deck-v3.pdf'),
    mk('freshbox-pitch-deck.pptx'),
  ]).map((x) => x.name);
  assert.deepEqual(kept, ['freshbox-pitch-deck-v3.pdf', 'freshbox-pitch-deck.pptx'], kept.join(','));

  // Distinct files that merely share a stem with a trailing number are NOT merged.
  const distinct = dedupeVersions([mk('sales-2024.pdf'), mk('sales-2025.pdf')]).map((x) => x.name);
  assert.deepEqual(distinct.sort(), ['sales-2024.pdf', 'sales-2025.pdf']);
});
