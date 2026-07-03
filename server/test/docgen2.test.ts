import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scriptSegments, ARABIC_RE } from '../src/agent/tools/docx';
import { generateDocTool } from '../src/agent/tools/docx';

const ctxFor = (repoDir: string): any => ({ repoDir, signal: new AbortController().signal, addCost: () => {}, session: {}, mode: 'code' });

// ── script segmentation (the bilingual/RTL core) ─────────────────────────────

test('scriptSegments: pure Latin, pure Arabic, and bilingual splits', () => {
  assert.deepEqual(scriptSegments('Hello world'), [{ text: 'Hello world', arabic: false }]);
  const ar = scriptSegments('اتفاقية عدم الإفصاح');
  assert.equal(ar.length, 1);
  assert.equal(ar[0].arabic, true);
  const mixed = scriptSegments('Clause 4 — البند الرابع — applies');
  assert.ok(mixed.length >= 3);
  assert.equal(mixed[0].arabic, false);
  assert.ok(mixed.some((s) => s.arabic && ARABIC_RE.test(s.text)));
  // neutral chars (digits/punctuation) stick to their neighbouring script
  const joined = mixed.map((s) => s.text).join('');
  assert.equal(joined, 'Clause 4 — البند الرابع — applies');
});

// ── full document build: every block type + furniture + validation ───────────

test('generate_doc: full-feature document builds, validates, and round-trips its text', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doc2-'));
  // a workspace image for the image block + logo
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(repo, 'logo.png'), png1x1);
  const out = await generateDocTool.run(
    {
      output: 'brief.docx',
      accent: '#7a2e3b',
      toc: true,
      logo: 'logo.png',
      cover: {
        masthead: 'ACME · LEGAL',
        eyebrow: 'Advisory',
        title: 'Non-Compete Enforceability',
        thesis: 'A bilingual assessment under Federal Decree-Law 33/2021.',
        kpis: [{ value: '6 mo', label: 'Max restraint' }, { value: 'Art. 10', label: 'Governing article' }],
        meta: { preparedBy: 'ArksAI', date: '2026-07-03' },
        confidential: true,
      },
      blocks: [
        { type: 'heading', text: 'Executive summary' },
        { type: 'paragraph', text: 'The **restraint** is enforceable if limited in time, place and nature.' },
        { type: 'callout', title: 'Key finding', text: 'Six months is the defensible ceiling for this role.' },
        { type: 'heading', text: 'التحليل القانوني' },
        { type: 'paragraph', text: 'يخضع شرط عدم المنافسة للمادة 10 من المرسوم بقانون اتحادي رقم 33 لسنة 2021.' },
        { type: 'heading3', text: 'Scope of restraint' },
        { type: 'bullets', items: ['Time: 6 months', 'Geography: Dubai mainland', 'النطاق: الإمارة فقط'] },
        { type: 'table', header: ['Element', 'Position'], rows: [['Duration', '6 months'], ['Remedy', 'Damages only']] },
        { type: 'quote', text: 'Restraints are construed narrowly.' },
        { type: 'image', path: 'logo.png', width: 120, caption: 'Exhibit A' },
      ],
    },
    ctxFor(repo),
  );
  assert.match(out, /^Generated brief\.docx/, out);
  assert.match(out, /re-open validated/);
  assert.match(out, /Contents page/);
  // Round-trip: the written file re-opens and carries both languages.
  const mammoth: any = await import('mammoth');
  const text = String((await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(repo, 'brief.docx')) })).value);
  assert.match(text, /Non-Compete Enforceability/);
  assert.match(text, /التحليل القانوني/);
  assert.match(text, /Six months is the defensible ceiling/);
  assert.match(text, /Exhibit A/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('generate_doc: missing image degrades honestly; landscape accepted', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doc2-'));
  const out = await generateDocTool.run(
    { output: 'x.docx', orientation: 'landscape', blocks: [{ type: 'image', path: 'nope.png' }, { type: 'paragraph', text: 'hello content' }] },
    ctxFor(repo),
  );
  assert.match(out, /^Generated x\.docx/);
  const mammoth: any = await import('mammoth');
  const text = String((await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(repo, 'x.docx')) })).value);
  assert.match(text, /image not found/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('generate_doc: Arabic font asset is embedded when present', () => {
  assert.ok(fs.existsSync(path.join(process.cwd(), 'assets', 'report-fonts', 'NotoNaskhArabic-Regular.ttf')));
});
