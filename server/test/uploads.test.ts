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

test('buildUploadNote: an image always steers to see_image — never claims it is unavailable', () => {
  const note = buildUploadNote(['uploads/photo.jpg'], false)!;
  assert.match(note, /see_image/);
  assert.doesNotMatch(note, /unavailable/i);
  assert.doesNotMatch(note, /can't view/i);
});

test('buildUploadNote: a LOGO routes to extract_palette when palette extraction is available (onboarding/code/report) — even without vision', () => {
  // vision OFF but palette available → must steer to extract_palette, NOT refuse.
  const offline = buildUploadNote(['uploads/logo.png'], false, true)!;
  assert.match(offline, /extract_palette/);
  assert.match(offline, /exact hex/i);
  assert.doesNotMatch(offline, /unavailable/i);
  assert.doesNotMatch(offline, /can't view/i);
  // vision ON and palette available → offer both extract_palette (colours) and see_image (content).
  const online = buildUploadNote(['uploads/logo.png'], true, true)!;
  assert.match(online, /extract_palette/);
  assert.match(online, /see_image/);
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
