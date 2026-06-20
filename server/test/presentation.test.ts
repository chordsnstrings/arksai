import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { readPresentationTool } from '../src/agent/tools/presentation';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-pptx-'));
const ctx = (): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'chat',
  signal: new AbortController().signal,
  addCost: () => {},
});

// Build a small, real .pptx with pptxgenjs: a title slide, a bullets slide with speaker
// notes, a table slide, and an image-less content slide — covering every assertion below.
async function makeDeck(file: string): Promise<void> {
  const PptxGenJS: any = (await import('pptxgenjs')).default ?? (await import('pptxgenjs'));
  const pptx = new PptxGenJS();
  pptx.title = 'Quarterly Review';

  const s1 = pptx.addSlide();
  s1.addText('Q3 Strategy Review', { x: 1, y: 2.5, w: 8, h: 1, fontSize: 40, bold: true });

  const s2 = pptx.addSlide();
  s2.addText('Key Priorities', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 30, bold: true });
  s2.addText(
    [
      { text: 'Grow ARR by 40 percent', options: { bullet: true } },
      { text: 'Launch the mobile app', options: { bullet: true } },
      { text: 'Hire two senior engineers', options: { bullet: true } },
    ],
    { x: 0.7, y: 1.5, w: 8, h: 3, fontSize: 18 },
  );
  s2.addNotes('Emphasise the ARR target — it is the board metric this quarter.');

  const s3 = pptx.addSlide();
  s3.addText('Regional Breakdown', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28, bold: true });
  s3.addTable(
    [
      [{ text: 'Region' }, { text: 'Revenue' }],
      [{ text: 'EMEA' }, { text: '1.2M' }],
      [{ text: 'APAC' }, { text: '0.8M' }],
    ],
    { x: 0.7, y: 1.5, w: 6 },
  );

  const s4 = pptx.addSlide();
  s4.addText('Closing Thoughts', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28, bold: true });
  s4.addText('Execution beats strategy', { x: 0.7, y: 1.5, w: 8, h: 1, fontSize: 20 });

  await pptx.writeFile({ fileName: path.join(ws, file) });
}

test('read_presentation manifest lists EVERY slide with titles, bullet counts, images/tables, notes', async () => {
  await makeDeck('deck.pptx');
  const out = await readPresentationTool.run({ path: 'deck.pptx' }, ctx());
  assert.doesNotMatch(out, /^Error/);
  assert.match(out, /4 slides/);
  assert.match(out, /Deck "Quarterly Review"/); // deck title from docProps/core.xml
  // every slide present, in order, by title
  assert.match(out, /Slide 1\/4: Q3 Strategy Review/);
  assert.match(out, /Slide 2\/4: Key Priorities/);
  assert.match(out, /Slide 3\/4: Regional Breakdown/);
  assert.match(out, /Slide 4\/4: Closing Thoughts/);
  // bullets surfaced in the manifest sample
  assert.match(out, /Grow ARR by 40 percent/);
  // a table on slide 3 is reflected
  assert.match(out, /Slide 3\/4:.*table/);
  // slide 2 has speaker notes → flagged in its manifest line
  assert.match(out, /Slide 2\/4: Key Priorities — .*notes/);
});

test('read_presentation reads full text + speaker notes for a specific slide', async () => {
  await makeDeck('deck2.pptx');
  const out = await readPresentationTool.run({ path: 'deck2.pptx', slide: '2' }, ctx());
  assert.match(out, /Slide 2\/4: Key Priorities/);
  assert.match(out, /Launch the mobile app/);
  assert.match(out, /Hire two senior engineers/);
  assert.match(out, /Speaker notes: .*board metric/);
});

test('read_presentation accepts a slide range', async () => {
  await makeDeck('deck3.pptx');
  const out = await readPresentationTool.run({ path: 'deck3.pptx', slide: '3-4' }, ctx());
  assert.match(out, /slides 3–4 of 4/);
  assert.match(out, /Regional Breakdown/);
  assert.match(out, /EMEA/); // table cell text is included
  assert.match(out, /Closing Thoughts/);
  assert.doesNotMatch(out, /Q3 Strategy Review/); // slide 1 excluded
});

test('read_presentation errors helpfully on a missing file', async () => {
  const out = await readPresentationTool.run({ path: 'nope.pptx' }, ctx());
  assert.match(out, /no file/i);
});

test('read_presentation is available in every mode (incl. chat) and in REPORT_TOOLS', async () => {
  for (const m of ['chat', 'plan', 'code', 'report'] as const) assert.ok(readPresentationTool.modes.includes(m));
  const { getToolsForMode } = await import('../src/agent/tools/index');
  assert.ok(getToolsForMode('report').map.has('read_presentation'));
});
