import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compositeOverlayCmd, overlayFrameName, frameName } from '../src/agent/motion/encode';
import {
  clipPrompt,
  buildOverlayHtml,
  normalizeOverlay,
  overlayText,
  AX_STYLES,
  AX_STYLE_IDS,
  AX_NEGATIVE,
} from '../src/agent/motion/overlay';

/**
 * The "animated explainer" keystone: composite a transparent crisp-text overlay OVER a
 * generative illustrated clip into one uniform scene mp4. These lock the pure ffmpeg command
 * builder — which is where the real bugs live (input/stream-map ordering, the tpad clone-pad,
 * the uniform-output params that keep the final join a lossless concat).
 */

test('overlay frames are PNG-named, distinct from the JPEG scene frames', () => {
  assert.equal(overlayFrameName(0), 'o00000.png');
  assert.equal(overlayFrameName(123), 'o00123.png');
  assert.equal(frameName(0), 'frame00000.jpg'); // scene frames stay JPEG
});

test('composite command orders inputs clip=0, overlay=1, audio=2 and maps 2:a (narration)', () => {
  const cmd = compositeOverlayCmd('/w/clip.mp4', '/w/ov', 30, '/w/scene.mp4', {
    audioIn: '/w/vo.mp3',
    durationS: 6,
    width: 1920,
    height: 1080,
  });
  // input order
  assert.match(cmd, /-i "\/w\/clip\.mp4" -framerate 30 -i "\/w\/ov\/o%05d\.png" -i "\/w\/vo\.mp3"/);
  // audio ALWAYS maps input 2 (the bug: silence was wrongly mapped to 1)
  assert.match(cmd, /-map 2:a/);
  // narration is padded to the exact scene length
  assert.match(cmd, /apad=whole_dur=6\.000/);
  // exact final length
  assert.match(cmd, /-t 6\.000/);
});

test('composite with no narration uses generated silence, still mapped 2:a', () => {
  const cmd = compositeOverlayCmd('/w/clip.mp4', '/w/ov', 24, '/w/scene.mp4', {
    durationS: 8,
    width: 1080,
    height: 1920,
  });
  // silence is input 2 (after clip 0 and overlay 1) — this is exactly the ordering bug the
  // proof caught: "Stream map '1:a' matches no streams".
  assert.match(cmd, /anullsrc=r=44100:cl=stereo/);
  assert.match(cmd, /-map 2:a/);
  assert.doesNotMatch(cmd, /apad/); // no narration → no pad
});

test('the base clip is scaled+cropped to WxH and clone-padded so a short clip still fills the scene', () => {
  const cmd = compositeOverlayCmd('/w/clip.mp4', '/w/ov', 30, '/w/scene.mp4', {
    durationS: 5,
    width: 1920,
    height: 1080,
  });
  assert.match(cmd, /scale=1920:1080:force_original_aspect_ratio=increase/);
  assert.match(cmd, /crop=1920:1080/);
  assert.match(cmd, /tpad=stop_mode=clone:stop_duration=3600/); // hold last frame, cut by -t
  assert.match(cmd, /\[bg\]\[ov\]overlay=0:0/); // overlay drawn at origin
});

test('output params are IDENTICAL to framesToVideoCmd so scenes concat losslessly', () => {
  const cmd = compositeOverlayCmd('/w/clip.mp4', '/w/ov', 30, '/w/scene.mp4', {
    durationS: 6,
    width: 1920,
    height: 1080,
  });
  assert.match(cmd, /-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30/);
  assert.match(cmd, /-c:a aac -b:a 160k -ar 44100 -ac 2/);
  assert.match(cmd, /format=yuv420p/); // flatten alpha for h264
  assert.match(cmd, /-movflags \+faststart/);
});

/* ---- Layer 2 (the crisp text overlay) + the clip prompt that keeps layer 1 clean ---- */

test('the clip prompt bans on-screen text AND realism, and reserves negative space', () => {
  const p = clipPrompt('a wind turbine on a hill at dawn', AX_STYLES['ink-wash'].tokens, 'lower');
  assert.match(p, /no text, no words, no letters/i); // the constant text ban
  assert.match(p, /no photorealism|no live-action/i); // realism ban
  assert.match(p, /negative space in the lower third/i); // room for the lower-third overlay
  assert.match(p, /watercolour|ink/i); // the style tokens are carried in
  assert.equal(AX_NEGATIVE.includes('no text'), true);
});

test('the clip prompt reserves the RIGHT zone per overlay layout', () => {
  assert.match(clipPrompt('x', 'flat', 'center'), /centre of the frame/i);
  assert.match(clipPrompt('x', 'flat', 'stat'), /lower-left quarter/i);
  assert.match(clipPrompt('x', 'flat', 'caption'), /lower third/i);
});

test('normalizeOverlay validates the layout and defaults to lower', () => {
  assert.equal(normalizeOverlay({ layout: 'center' }).layout, 'center');
  assert.equal(normalizeOverlay({ layout: 'bogus' }).layout, 'lower'); // invalid → safe default
  assert.equal(normalizeOverlay(undefined).layout, 'lower');
  assert.equal(normalizeOverlay({ layout: 'stat', num: '42', unit: '%' }).num, '42');
});

test('buildOverlayHtml is a TRANSPARENT motion-kit page with the right composition per layout', () => {
  const st = { width: 1920, height: 1080, kitPrefix: '../../' };
  const lower = buildOverlayHtml({ layout: 'lower', kicker: 'Kick', title: 'Big title', sub: 'a sub' }, st);
  assert.match(lower, /background:transparent/); // the clip shows through
  assert.match(lower, /\.\.\/\.\.\/motion-kit\/motion\.css/); // kit linked relatively
  assert.match(lower, /\.\.\/\.\.\/motion-kit\/motion\.js/);
  assert.match(lower, /class="ax-stage ax-lower"/);
  assert.match(lower, /class="ax-scrim bottom"/); // legibility scrim present
  assert.match(lower, /ax-kicker">Kick/);
  assert.match(lower, /ax-title">Big title/);

  const stat = buildOverlayHtml({ layout: 'stat', num: '42', unit: '%', label: 'of load' }, st);
  assert.match(stat, /class="ax-card"/);
  assert.match(stat, /ax-num">42<span class="u">%<\/span>/);

  const center = buildOverlayHtml({ layout: 'center', title: 'Hook' }, st);
  assert.match(center, /class="ax-scrim full"/); // centered hook gets the full veil
});

test('buildOverlayHtml HTML-escapes copy (no injection from slot text)', () => {
  const html = buildOverlayHtml({ layout: 'lower', title: 'A <b>bold</b> & "risky" title' }, { width: 1080, height: 1080 });
  assert.match(html, /A &lt;b&gt;bold&lt;\/b&gt; &amp; &quot;risky&quot; title/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
});

test('AX_STYLES catalog is well-formed and overlayText concatenates the copy', () => {
  assert.ok(AX_STYLE_IDS.length >= 6);
  for (const id of AX_STYLE_IDS) {
    assert.ok(AX_STYLES[id].label && AX_STYLES[id].tokens.length > 20, `${id} has label + tokens`);
    assert.doesNotMatch(AX_STYLES[id].tokens, /photo(realistic|graph)/i, `${id} tokens are non-photoreal`);
  }
  assert.equal(overlayText({ layout: 'lower', kicker: 'a', title: 'b', sub: 'c' }), 'a b c');
});
