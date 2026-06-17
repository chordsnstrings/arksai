import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadNote } from '../src/lib/extract';
import { sanitizeFilename } from '../src/routes/upload';
import { contentDisposition } from '../src/routes/files';

test('buildUploadNote: null when nothing was uploaded', () => {
  assert.equal(buildUploadNote([], true), null);
});

// SECURITY: an upload filename is untrusted input — it must never escape the uploads dir.
test('sanitizeFilename: path traversal is neutralized (no separators survive)', () => {
  for (const evil of ['../../../etc/passwd', '/etc/shadow', '..\\..\\windows\\system32\\cmd.exe', './../secret']) {
    const safe = sanitizeFilename(evil);
    assert.ok(!safe.includes('/') && !safe.includes('\\'), `no separators in ${safe}`);
  }
  assert.equal(sanitizeFilename('../../../etc/passwd'), 'passwd'); // basename wins
});

test('sanitizeFilename: shell metacharacters / control chars / non-word chars are stripped', () => {
  // only [\w.\- ()] survive — shell metachars, pipes, redirects, null bytes all become _
  assert.doesNotMatch(sanitizeFilename('a;rm -rf~`$()<>|&.png\0'), /[;~`$<>|&\0]/);
  // a legitimate dotted/hyphenated/spaced/parenthesised name is preserved verbatim
  assert.equal(sanitizeFilename('Q3 Report (final)-v2.xlsx'), 'Q3 Report (final)-v2.xlsx');
});

test('sanitizeFilename: empty / undefined / oversized names degrade safely', () => {
  assert.equal(sanitizeFilename(''), 'file');
  assert.equal(sanitizeFilename(undefined as any), 'file');
  assert.ok(sanitizeFilename('x'.repeat(500)).length <= 100);
  // a name that's all-separators still yields a usable, contained segment
  assert.ok(sanitizeFilename('/////').length >= 1);
});

// A downloaded deliverable can be named in Arabic (legal dept) or carry odd chars —
// the Content-Disposition header must stay valid AND preserve the real UTF-8 name.
test('contentDisposition: ASCII name → simple, valid header', () => {
  const h = contentDisposition('Q3 Report.pdf', false);
  assert.match(h, /^attachment; filename="Q3 Report\.pdf"/);
  assert.match(h, /filename\*=UTF-8''Q3%20Report\.pdf/);
});

test('contentDisposition: a non-ASCII (Arabic) name keeps an ASCII fallback + a UTF-8 form', () => {
  const h = contentDisposition('عقد-إيجار.docx', false); // "lease contract" .docx
  // fallback must be pure printable ASCII (no raw non-ASCII bytes in filename="…")
  const fallback = h.match(/filename="([^"]*)"/)![1];
  assert.doesNotMatch(fallback, /[^\x20-\x7e]/);
  // the real name survives, percent-encoded, in filename*=
  assert.ok(h.includes("filename*=UTF-8''"));
  assert.match(h, /%D8/); // Arabic bytes are UTF-8 percent-encoded
});

test('contentDisposition: CR/LF and quotes in a filename cannot inject a header', () => {
  const h = contentDisposition('evil"\r\nSet-Cookie: x=1.png', true);
  assert.doesNotMatch(h, /[\r\n]/); // no CRLF → no header injection
  assert.match(h, /^inline; /);
  assert.doesNotMatch(h.match(/filename="([^"]*)"/)![1], /["]/); // quote neutralized
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
