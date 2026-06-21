import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImageRequest } from '../src/engines/minimax';

const DATA_URI =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';

test('buildImageRequest: WITHOUT a reference → no subject_reference key (back-compat)', () => {
  const body = buildImageRequest('image-01', 'a calm seaside scene', { aspectRatio: '16:9' });
  assert.ok(!('subject_reference' in body), 'subject_reference must be omitted when no reference is given');
});

test('buildImageRequest: WITH a data-URI reference → subject_reference[0] is a character carrying the data URI', () => {
  const body = buildImageRequest('image-01', 'the same person on a beach', {
    aspectRatio: '1:1',
    subjectReferenceDataUri: DATA_URI,
  });
  const sr = body.subject_reference as Array<{ type: string; image_file: string }>;
  assert.ok(Array.isArray(sr), 'subject_reference must be an array');
  assert.equal(sr.length, 1, 'only one reference is supported');
  assert.equal(sr[0].type, 'character');
  assert.equal(sr[0].image_file, DATA_URI);
});

test('buildImageRequest: model, prompt and aspect_ratio are carried through', () => {
  const body = buildImageRequest('image-01', 'a red bicycle', { aspectRatio: '4:3' });
  assert.equal(body.model, 'image-01');
  assert.equal(body.prompt, 'a red bicycle');
  assert.equal(body.aspect_ratio, '4:3');
});

test('buildImageRequest: aspect_ratio defaults to 1:1 and n is clamped to [1,4]', () => {
  const dflt = buildImageRequest('image-01', 'x', {});
  assert.equal(dflt.aspect_ratio, '1:1');
  assert.equal(dflt.n, 1);
  assert.equal(buildImageRequest('image-01', 'x', { n: 9 }).n, 4);
  assert.equal(buildImageRequest('image-01', 'x', { n: 0 }).n, 1);
});
