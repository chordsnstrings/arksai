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
