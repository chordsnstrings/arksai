import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compositeOverlayCmd, overlayFrameName, frameName } from '../src/agent/motion/encode';

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
