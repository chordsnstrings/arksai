import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenerateBody,
  buildExtendBody,
  buildCoverBody,
  parseRecordInfo,
  parseLyrics,
  SUNO_LIMITS,
} from '../src/engines/suno';

test('buildGenerateBody: non-custom (auto) mode sends only a description prompt', () => {
  const b = buildGenerateBody({ prompt: 'upbeat indie pop about summer road trips' });
  assert.equal(b.customMode, false);
  assert.equal(b.instrumental, false);
  assert.equal(b.prompt, 'upbeat indie pop about summer road trips');
  assert.equal(b.style, undefined);
  assert.equal(b.title, undefined);
});

test('buildGenerateBody: custom mode REQUIRES both style AND title', () => {
  // style alone is NOT enough — the API rejects custom without a title.
  const styleOnly = buildGenerateBody({ prompt: '[Verse]\nhi', style: 'dream pop' });
  assert.equal(styleOnly.customMode, false);
  const titleOnly = buildGenerateBody({ prompt: '[Verse]\nhi', title: 'My Song' });
  assert.equal(titleOnly.customMode, false);
  const both = buildGenerateBody({ prompt: '[Verse]\nhi', style: 'dream pop', title: 'My Song' });
  assert.equal(both.customMode, true);
  assert.equal(both.style, 'dream pop');
  assert.equal(both.title, 'My Song');
  assert.equal(both.prompt, '[Verse]\nhi');
});

test('buildGenerateBody: instrumental custom omits the lyrics prompt', () => {
  const b = buildGenerateBody({ prompt: '', style: 'lofi', title: 'Calm', instrumental: true });
  assert.equal(b.customMode, true);
  assert.equal(b.instrumental, true);
  assert.equal(b.prompt, undefined); // no lyrics for an instrumental
});

test('buildGenerateBody: enforces char limits and passes optional controls', () => {
  const b = buildGenerateBody({
    prompt: 'x'.repeat(9000),
    style: 's'.repeat(2000),
    title: 't'.repeat(200),
    vocalGender: 'f',
    styleWeight: 5, // out of range → clamped
    weirdnessConstraint: -2, // clamped
    negativeTags: 'n'.repeat(999),
  });
  assert.equal(String(b.style).length, SUNO_LIMITS.style);
  assert.equal(String(b.title).length, SUNO_LIMITS.title);
  assert.equal(String(b.prompt).length, SUNO_LIMITS.customLyrics);
  assert.equal(b.vocalGender, 'f');
  assert.equal(b.styleWeight, 1); // clamped to [0,1]
  assert.equal(b.weirdnessConstraint, 0);
  assert.equal(String(b.negativeTags).length, SUNO_LIMITS.negativeTags);
});

test('buildGenerateBody: style limit is model-dependent (V4=200, modern=1000)', () => {
  const v4 = buildGenerateBody({ prompt: '[Verse]\nx', style: 's'.repeat(2000), title: 'T', model: 'V4' });
  assert.equal(String(v4.style).length, SUNO_LIMITS.styleV4); // legacy V4 caps style at 200
  const v5 = buildGenerateBody({ prompt: '[Verse]\nx', style: 's'.repeat(2000), title: 'T', model: 'V5' });
  assert.equal(String(v5.style).length, SUNO_LIMITS.style); // 1000 on modern models
});

test('buildGenerateBody: non-custom prompt capped at 500', () => {
  const b = buildGenerateBody({ prompt: 'p'.repeat(900) });
  assert.equal(String(b.prompt).length, SUNO_LIMITS.nonCustomPrompt);
});

test('buildGenerateBody: model defaults are config-driven and overridable', () => {
  const def = buildGenerateBody({ prompt: 'x' });
  assert.ok(typeof def.model === 'string' && (def.model as string).length > 0);
  const overridden = buildGenerateBody({ prompt: 'x', model: 'V5' });
  assert.equal(overridden.model, 'V5');
});

test('buildExtendBody: params present → defaultParamFlag true; absent → inherit', () => {
  const inherit = buildExtendBody({ audioId: 'abc', continueAt: 120 });
  assert.equal(inherit.audioId, 'abc');
  assert.equal(inherit.continueAt, 120);
  assert.equal(inherit.defaultParamFlag, false); // no style/title/prompt → inherit source
  const steered = buildExtendBody({ audioId: 'abc', style: 'rock', title: 'Longer' });
  assert.equal(steered.defaultParamFlag, true);
  assert.equal(steered.style, 'rock');
});

test('buildCoverBody: custom needs style+title; lyrics dropped when instrumental', () => {
  const plain = buildCoverBody({ uploadUrl: 'https://x/a.mp3', style: 'jazz' });
  assert.equal(plain.uploadUrl, 'https://x/a.mp3');
  assert.equal(plain.customMode, false); // style without title is not custom
  const inst = buildCoverBody({ uploadUrl: 'https://x/a.mp3', style: 'jazz', title: 'Cover', prompt: 'la la', instrumental: true });
  assert.equal(inst.customMode, true);
  assert.equal(inst.prompt, undefined); // instrumental → no lyrics
});

test('parseRecordInfo: SUCCESS with audio tracks (sunoData shape)', () => {
  const out = parseRecordInfo({
    data: { status: 'SUCCESS', response: { sunoData: [{ audioUrl: 'http://a/1.mp3', title: 'A' }, { audio_url: 'http://a/2.mp3' }] } },
  });
  assert.equal(out.status, 'SUCCESS');
  assert.equal(out.tracks.length, 2);
  assert.equal(out.failed, undefined);
});

test('parseRecordInfo: tolerates the response.data shape too', () => {
  const out = parseRecordInfo({ data: { status: 'SUCCESS', response: { data: [{ audioUrl: 'http://a/1.mp3' }] } } });
  assert.equal(out.tracks.length, 1);
});

test('parseRecordInfo: sensitive-word + generic failures surface a message', () => {
  const sw = parseRecordInfo({ data: { status: 'SENSITIVE_WORD_ERROR' } });
  assert.match(String(sw.failed), /content filter|rephrase/i);
  const fail = parseRecordInfo({ data: { status: 'GENERATE_AUDIO_FAILED' } });
  assert.match(String(fail.failed), /failed/i);
});

test('parseRecordInfo: pending state has no tracks and no failure', () => {
  const out = parseRecordInfo({ data: { status: 'PENDING', response: {} } });
  assert.equal(out.tracks.length, 0);
  assert.equal(out.failed, undefined);
});

test('parseLyrics: extracts text variants across field-name shapes', () => {
  const a = parseLyrics({ data: { status: 'SUCCESS', response: { data: [{ title: 'V1', text: 'la la' }] } } });
  assert.equal(a.lyrics.length, 1);
  assert.equal(a.lyrics[0].text, 'la la');
  const b = parseLyrics({ data: { status: 'SUCCESS', lyricsData: [{ lyrics: 'oh oh' }] } });
  assert.equal(b.lyrics[0].text, 'oh oh');
  const empty = parseLyrics({ data: { status: 'PENDING' } });
  assert.equal(empty.lyrics.length, 0);
});
