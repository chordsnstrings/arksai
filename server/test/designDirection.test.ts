import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import {
  designDirectionTool,
  normalizeBrief,
  buildTokensCss,
  buildDesignMd,
} from '../src/agent/tools/design-direction';
import { createWebAppTool } from '../src/agent/tools/web-app';
import { designCore } from '../src/agent/designSystem';
import { DESIGN_RUBRIC_PROMPT } from '../src/agent/uiCheck';

const mkws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-dd-'));
const ctx = (ws: string): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'code',
  signal: new AbortController().signal,
  addCost: () => {},
});

test('normalizeBrief fills sane defaults + auto-picks accent ink', () => {
  const b = normalizeBrief({ concept: 'Port of Entry', palette: { accent: '1b4d3e' }, type: {} });
  assert.equal(b.concept, 'Port of Entry');
  assert.equal(b.palette.accent, '#1b4d3e'); // normalized with #
  assert.equal(b.palette.accentInk, '#ffffff'); // dark accent → white ink
  assert.ok(b.type.display.family && b.type.body.family && b.type.data.family); // always a trio
  assert.ok(b.antiDefaults.length >= 1); // always names defaults to avoid
});

test('normalizeBrief picks dark ink on a light accent', () => {
  const b = normalizeBrief({ concept: 'x', palette: { accent: '#f3e9c8' }, type: {} });
  assert.equal(b.palette.accentInk, '#14161b');
});

test('normalizeBrief sanitizes font family names (no injection)', () => {
  const b = normalizeBrief({ concept: 'x', palette: {}, type: { display: { family: 'Evil"</style>' } } });
  assert.ok(!/["'<>]/.test(b.type.display.family));
});

test('buildTokensCss emits the locked palette + three type roles + rationale', () => {
  const b = normalizeBrief({
    concept: 'Port of Entry',
    rationale: 'Travel documents.',
    palette: { accent: '#c8432b', ink: '#14201a', paper: '#f5f3ec' },
    type: { display: { family: 'Spectral' }, body: { family: 'Hanken Grotesk' }, data: { family: 'IBM Plex Mono' } },
  });
  const css = buildTokensCss(b);
  assert.match(css, /--accent: #c8432b/);
  assert.match(css, /--display: "Spectral"/);
  assert.match(css, /--font: "Hanken Grotesk"/);
  assert.match(css, /--font-mono: "IBM Plex Mono"/);
  assert.match(css, /Port of Entry/);
  // careful palette: a derived accent ramp + glass tokens, not a flat single accent
  assert.match(css, /--accent-deep:\s*color-mix/);
  assert.match(css, /--accent-tint:\s*color-mix/);
  assert.match(css, /--glass-bg:\s*color-mix/);
});

test('buildDesignMd documents the concept + structure + avoided defaults', () => {
  const b = normalizeBrief({
    concept: 'Port of Entry',
    structureEncodes: 'real country codes',
    antiDefaults: ['cream+serif+terracotta'],
    palette: { accent: '#c8432b' },
    type: {},
  });
  const md = buildDesignMd(b);
  assert.match(md, /# Design direction — Port of Entry/);
  assert.match(md, /real country codes/);
  assert.match(md, /cream\+serif\+terracotta/);
});

test('design_direction tool writes json + md + tokens.css into the workspace', async () => {
  const ws = mkws();
  const out = await designDirectionTool.run(
    {
      concept: 'The Roast Log',
      palette: { accent: '#6b3a1f' },
      type: { display: { family: 'Fraunces' }, body: { family: 'Hanken Grotesk' }, data: { family: 'Space Mono' } },
      signature: 'a roast-log board keyed to origin codes',
    },
    ctx(ws),
  );
  assert.match(out, /The Roast Log/);
  const brief = JSON.parse(fs.readFileSync(path.join(ws, 'design-direction.json'), 'utf8'));
  assert.equal(brief.concept, 'The Roast Log');
  assert.ok(fs.existsSync(path.join(ws, 'DESIGN.md')));
  const tokens = fs.readFileSync(path.join(ws, 'tokens.css'), 'utf8');
  assert.match(tokens, /--font-mono: "Space Mono"/);
});

test('create_web_app PRESERVES a locked tokens.css (does not clobber the direction)', async () => {
  const ws = mkws();
  // Lock a direction first
  await designDirectionTool.run(
    { concept: 'Locked', palette: { accent: '#112233' }, type: { display: { family: 'Spectral' } } },
    ctx(ws),
  );
  const before = fs.readFileSync(path.join(ws, 'tokens.css'), 'utf8');
  // Now scaffold — must NOT overwrite the locked look
  await createWebAppTool.run({ name: 'Test', accent: '#999999' }, ctx(ws));
  const after = fs.readFileSync(path.join(ws, 'tokens.css'), 'utf8');
  assert.equal(after, before); // preserved verbatim
  assert.match(after, /Locked/);
  // and the scaffold still installed the mechanics + craft
  assert.ok(fs.existsSync(path.join(ws, 'site.css')));
  assert.ok(fs.existsSync(path.join(ws, 'ui-kit', 'craft.css')));
});

test('create_web_app (no prior direction) themes tokens.css with the accent', async () => {
  const ws = mkws();
  await createWebAppTool.run({ name: 'Fresh', accent: '#0a7d55' }, ctx(ws));
  const tokens = fs.readFileSync(path.join(ws, 'tokens.css'), 'utf8');
  assert.match(tokens, /--accent: #0a7d55/);
  // site.css is mechanics-only now (no token block)
  const site = fs.readFileSync(path.join(ws, 'site.css'), 'utf8');
  assert.doesNotMatch(site, /--accent: #3a5a78/);
  // pages link all three stylesheets
  const html = fs.readFileSync(path.join(ws, 'index.html'), 'utf8');
  assert.match(html, /tokens\.css/);
  assert.match(html, /ui-kit\/craft\.css/);
});

test('designCore steers art-direction-first + names the AI-default looks', () => {
  assert.match(designCore, /ART DIRECTION FIRST/);
  assert.match(designCore, /design_direction/);
  assert.match(designCore, /AI-DEFAULT LOOKS/i);
  assert.match(designCore, /terracotta|clay/i); // names a cliché
  assert.match(designCore, /mono.?\/?.?data|MONO\/DATA/i); // the data role
  // minimal-muted must be demoted, not the mandated house style
  assert.match(designCore, /minimal-muted is ONE option/i);
});

test('the design critique fails generic/templated output (distinctiveness)', () => {
  assert.match(DESIGN_RUBRIC_PROMPT, /DISTINCTIVENESS/);
  assert.match(DESIGN_RUBRIC_PROMPT, /competent-but-generic is a FAIL/);
  assert.match(DESIGN_RUBRIC_PROMPT, /SIGNATURE/);
});
