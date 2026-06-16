import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadNote } from '../src/lib/extract';

test('buildUploadNote: null when nothing was uploaded', () => {
  assert.equal(buildUploadNote([], true), null);
});

test('buildUploadNote: a data file points the agent at its extracted sidecar', () => {
  const note = buildUploadNote(['uploads/q1.xlsx'], true)!;
  assert.match(note, /the user just uploaded/);
  assert.match(note, /uploads\/q1\.xlsx/);
  assert.match(note, /uploads\/q1\.xlsx\.extracted\.txt/);
  assert.match(note, /do NOT ask the user to paste or re-upload/i);
});

test('buildUploadNote: csv/pdf/docx are all treated as extractable documents', () => {
  for (const f of ['uploads/data.csv', 'uploads/report.pdf', 'uploads/brief.docx']) {
    const note = buildUploadNote([f], true)!;
    assert.match(note, new RegExp(`${f.replace(/[.]/g, '\\.')}\\.extracted\\.txt`));
  }
});

test('buildUploadNote: an image routes to see_image when vision is available', () => {
  const note = buildUploadNote(['uploads/photo.png'], true)!;
  assert.match(note, /see_image/);
  assert.match(note, /uploads\/photo\.png/);
});

test('buildUploadNote: an image says viewing is unavailable when vision is off', () => {
  const note = buildUploadNote(['uploads/photo.jpg'], false)!;
  assert.match(note, /unavailable/i);
  assert.match(note, /MINIMAX_API_KEY/);
  assert.doesNotMatch(note, /call see_image/);
});

test('buildUploadNote: a plain/unknown file is read directly with read_file', () => {
  const note = buildUploadNote(['uploads/notes.txt'], true)!;
  assert.match(note, /read with read_file/);
  assert.match(note, /uploads\/notes\.txt/);
  assert.doesNotMatch(note, /extracted\.txt/);
});

test('buildUploadNote: a mixed batch surfaces every kind in one note', () => {
  const note = buildUploadNote(['uploads/model.xlsx', 'uploads/logo.png', 'uploads/readme.md'], true)!;
  assert.match(note, /model\.xlsx\.extracted\.txt/); // doc → sidecar
  assert.match(note, /logo\.png/); // image
  assert.match(note, /see_image/);
  assert.match(note, /readme\.md/); // other → read_file
  assert.match(note, /read with read_file/);
});
