import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertDocumentTool } from '../src/agent/tools/convert';

function ctx(dir: string): any {
  return { repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {}, session: {} };
}

test('convert_document: rejects an unknown extension with a clear message', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-conv-t-'));
  fs.writeFileSync(path.join(d, 'notes.txt'), 'hello');
  const r = await convertDocumentTool.run({ input: 'notes.txt' }, ctx(d));
  assert.match(r, /don't know how to convert/i);
});

test('convert_document: missing input is reported, not thrown', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-conv-t-'));
  const r = await convertDocumentTool.run({ input: 'nope.pptx' }, ctx(d));
  assert.match(r, /not found/i);
});

test('convert_document: a deck with no preview.html falls back to LibreOffice (which is absent in CI → clean error, no crash)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-conv-t-'));
  // a stub .pptx with no sibling preview — exercises the soffice fallback branch
  fs.writeFileSync(path.join(d, 'deck.pptx'), Buffer.from('PK\x03\x04 stub'));
  const r = await convertDocumentTool.run({ input: 'deck.pptx' }, ctx(d));
  // soffice is not installed in CI → a clean Error string (the branch ran without throwing)
  assert.match(r, /Error:/);
  assert.doesNotMatch(r, /don't know how to convert/i); // it DID route to the office path
});

test('convert_document: HTML input routes to the Chromium path (slides auto-detected for .preview.html)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-conv-t-'));
  fs.writeFileSync(path.join(d, 'deck.preview.html'), '<!doctype html><html><body><div>slide</div></body></html>');
  const r = await convertDocumentTool.run({ input: 'deck.preview.html' }, ctx(d));
  // Chromium may or may not be present in CI; either it renders, or returns a clean
  // "not available" / "render failed" Error — but it must NOT be the unknown-format error.
  assert.doesNotMatch(r, /don't know how to convert/i);
});

test('convert_document: tool is registered in code + report toolsets', async () => {
  const idx = await import('../src/agent/tools/index');
  const code = idx.getToolsForMode('code');
  const report = idx.getToolsForMode('report');
  assert.ok(code.map.has('convert_document'), 'convert_document in code mode');
  assert.ok(report.map.has('convert_document'), 'convert_document in report mode');
});
