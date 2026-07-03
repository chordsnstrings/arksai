import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildConcatList, concatCmd, xfadeCmd, lastFrameCmd, firstFrameCmd, probeDurationCmd, musicBedCmd, captionsCmd } from '../src/agent/videoStitch';
import { buildVideoTask, isContentPolicyError, VIDEO_MODELS } from '../src/engines/seedance';
import { mintVideoToken, registerVideoSrcRoutes } from '../src/routes/videoSrc';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── pure command builders (the exact ffmpeg invocations, testable without ffmpeg) ──

test('buildConcatList: demuxer format with quote escaping', () => {
  const list = buildConcatList(['/a/scene1.mp4', "/a/it's.mp4"]);
  assert.equal(list, "file '/a/scene1.mp4'\nfile '/a/it'\\''s.mp4'\n");
});

test('concatCmd: lossless stream-copy join', () => {
  const cmd = concatCmd('/tmp/list.txt', '/tmp/out.mp4');
  assert.match(cmd, /-f concat -safe 0/);
  assert.match(cmd, /-c copy/);
  assert.ok(!cmd.includes('libx264'), 'a cut never re-encodes');
});

test('xfadeCmd: A/V crossfade with clamped fade and offset', () => {
  const cmd = xfadeCmd('/a.mp4', '/b.mp4', '/o.mp4', { fadeS: 0.4, offsetS: 7.6 });
  assert.match(cmd, /xfade=transition=fade:duration=0\.4:offset=7\.6/);
  assert.match(cmd, /acrossfade=d=0\.8/);
  assert.match(cmd, /libx264/);
  // clamps: absurd fade values stay sane
  assert.match(xfadeCmd('/a', '/b', '/o', { fadeS: 99, offsetS: -5 }), /duration=2:offset=0/);
});

test('lastFrameCmd/firstFrameCmd/probeDurationCmd: frame-chain + QC probes', () => {
  assert.match(lastFrameCmd('/v.mp4', '/f.jpg'), /-sseof -0\.15 .* -frames:v 1/);
  assert.match(firstFrameCmd('/v.mp4', '/f.jpg'), /-frames:v 1/);
  assert.ok(!firstFrameCmd('/v.mp4', '/f.jpg').includes('-sseof'), 'first frame reads from the start');
  assert.match(probeDurationCmd('/v.mp4'), /ffprobe .*format=duration/);
});

test('xfadeCmd: fade-black kind selects the fadeblack transition', () => {
  assert.match(xfadeCmd('/a', '/b', '/o', { fadeS: 0.4, offsetS: 5, kind: 'fadeblack' }), /xfade=transition=fadeblack/);
  assert.match(xfadeCmd('/a', '/b', '/o', { fadeS: 0.4, offsetS: 5 }), /xfade=transition=fade:/);
});

test('musicBedCmd: bed loops quietly under the story; duck adds sidechain compression', () => {
  const plain = musicBedCmd('/story.mp4', '/bed.mp3', '/out.mp4');
  assert.match(plain, /aloop=loop=-1/);
  assert.match(plain, /volume=0\.3/);
  assert.match(plain, /amix=inputs=2:duration=first/);
  assert.match(plain, /-c:v copy/);
  assert.ok(!plain.includes('sidechaincompress'));
  const ducked = musicBedCmd('/story.mp4', '/bed.mp3', '/out.mp4', { duck: true });
  assert.match(ducked, /sidechaincompress/);
});

test('captionsCmd: drawtext strip with filter-breaking characters stripped', () => {
  const cmd = captionsCmd('/in.mp4', '/out.mp4', `Wherever; you're: "50%" there,`);
  assert.match(cmd, /drawtext=text='Wherever you re 50 there'/);
  assert.match(cmd, /-c:a copy/);
});

// ── seedance engine additions ──

test('VIDEO_MODELS: the probed 2.0 ids (fast suffix BEFORE the date)', () => {
  assert.equal(VIDEO_MODELS['arksai-video-20'].api, 'dreamina-seedance-2-0-260128');
  assert.equal(VIDEO_MODELS['arksai-video-20-fast'].api, 'dreamina-seedance-2-0-fast-260128');
  assert.equal(VIDEO_MODELS['arksai-video-20-fast'].draft, false);
});

test('buildVideoTask: videoUrl emits the reference_video role (the only accepted video role)', () => {
  const t = buildVideoTask({ prompt: 'continue this', model: 'arksai-video-20-fast', videoUrl: 'https://x/clip.mp4' });
  const vid = (t.body.content as any[]).find((c) => c.type === 'video_url');
  assert.ok(vid, 'video content present');
  assert.equal(vid.role, 'reference_video');
  assert.equal(vid.video_url.url, 'https://x/clip.mp4');
  const none = buildVideoTask({ prompt: 'plain shot' });
  assert.ok(!(none.body.content as any[]).some((c) => c.type === 'video_url'));
});

test('isContentPolicyError: classifies the output copyright/sensitive block', () => {
  assert.equal(isContentPolicyError('The request failed because the output video may be related to copyright restrictions.'), true);
  assert.equal(isContentPolicyError('OutputVideoSensitiveContentDetected.PolicyViolation'), true);
  assert.equal(isContentPolicyError('HTTP 500'), false);
  assert.equal(isContentPolicyError(''), false);
});

// ── token-gated clip publishing (security) ──

test('mintVideoToken: path-locked to videos/ dirs, rejects everything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-'));
  const videos = path.join(dir, 'videos');
  fs.mkdirSync(videos);
  const clip = path.join(videos, 'scene1.mp4');
  fs.writeFileSync(clip, Buffer.alloc(20_000));
  const token = mintVideoToken(clip);
  assert.match(token, /^[A-Za-z0-9_-]{20,}$/);
  // outside a videos/ dir → refused (secrets, .env, arbitrary reads)
  const secret = path.join(dir, 'secret.mp4');
  fs.writeFileSync(secret, 'x');
  assert.throws(() => mintVideoToken(secret), /videos\//);
  // traversal that ESCAPES videos/ resolves outside it → refused
  assert.throws(() => mintVideoToken(path.join(videos, '..', 'secret.mp4')), /videos\//);
  // missing file → refused
  assert.throws(() => mintVideoToken(path.join(videos, 'nope.mp4')), /not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('video-src route: serves the minted file (full + range), 404s garbage tokens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsr-'));
  const videos = path.join(dir, 'videos');
  fs.mkdirSync(videos);
  const clip = path.join(videos, 'scene1.mp4');
  const bytes = Buffer.from('MP4DATA-'.repeat(4000));
  fs.writeFileSync(clip, bytes);
  const app = Fastify();
  registerVideoSrcRoutes(app);
  const token = mintVideoToken(clip);

  const full = await app.inject({ method: 'GET', url: `/api/video-src/${token}` });
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers['content-type'], 'video/mp4');
  assert.equal(Number(full.headers['content-length']), bytes.length);

  const range = await app.inject({ method: 'GET', url: `/api/video-src/${token}`, headers: { range: 'bytes=0-99' } });
  assert.equal(range.statusCode, 206);
  assert.equal(Number(range.headers['content-length']), 100);
  assert.match(String(range.headers['content-range']), new RegExp(`bytes 0-99/${bytes.length}`));

  const bogus = await app.inject({ method: 'GET', url: '/api/video-src/not-a-real-token' });
  assert.equal(bogus.statusCode, 404);
  // a token is NOT a directory listing: nothing else under the path resolves
  const sibling = await app.inject({ method: 'GET', url: `/api/video-src/${token}/../other.mp4` });
  assert.notEqual(sibling.statusCode, 200);

  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
