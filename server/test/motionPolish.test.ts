import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { materializeScaffold, SCAFFOLD_IDS, groundClass, type ScaffoldCtx } from '../src/agent/motion/scaffolds';
import { stillnessPairs, parseSignalstat, isPacingMonotone, hookProblems, frameDiffCmd, cellStdevCmd } from '../src/agent/motion/qc';
import { xfadeCmd, XFADE_KINDS, stitchClipsSegmented } from '../src/agent/videoStitch';
import {
  pexelsSearchUrl,
  parsePexels,
  openverseSearchUrl,
  parseOpenverse,
  wikimediaSearchUrl,
  parseWikimedia,
  searchPhotos,
  __setPexelsKeyForTest,
} from '../src/agent/assets/photos';
import { renderMotionVideoTool } from '../src/agent/tools/motionVideo';

// ---------------- scaffolds: every archetype × every pack materializes ----------------

const MINIMAL_SLOTS: Record<string, any> = {
  'hook-question': { question: 'Why does your heart attack itself?' },
  'hero-stat': { value: 142, label: 'the number that matters', suffix: ' mg' },
  'split-compare': { left: { title: 'Pay debt', lines: ['guaranteed 7%'] }, right: { title: 'Invest', lines: ['average 7%'] }, verdict: 'a dead tie' },
  'process-steps': { title: 'Three moves that work', steps: [{ label: 'Eat soluble fibre' }, { label: 'Move every day' }] },
  'annotated-plate': { plate: 'assets/photos/pexels-1.jpg', labels: [{ text: 'THE EVIDENCE', x: '8%', y: '20%' }], headline: 'Where your money goes' },
  callout: { subject: 'assets/icon.svg', text: 'of your paycheck', big: 37, tone: 'danger' },
  'character-beat': { line: 'Your liver never stops working', acting: 'look-r' },
  'chart-insight': { chart: 'assets/chart.svg', insight: 'The drop happens in month three', highlight: 'month three' },
  'quote-punch': { lines: ['Small changes,', 'compounding daily'] },
  'list-recap': { title: 'REMEMBER', items: [{ label: 'Fibre first' }, { label: 'Move daily' }, { label: 'Ask your doctor' }] },
  'end-punch': { line: 'Start with breakfast tomorrow', sub: 'One bowl. That is it.' },
  'photo-hero': { photo: 'assets/photos/pexels-2.jpg', headline: 'The engine inside you', kicker: 'THE SCIENCE' },
  'cutout-stat': { cutout: 'assets/photos/pexels-3-cutout.png', value: 42, suffix: '%', label: 'more capacity retained' },
  'collage-compare': { left: { cutout: 'assets/photos/a-cutout.png', title: 'Cheap' }, right: { cutout: 'assets/photos/b-cutout.png', title: 'Quality' }, verdict: 'Quality wins' },
  'bar-chart': { title: 'Where it goes', unit: '%', bars: [{ label: 'Housing', value: 38 }, { label: 'Food', value: 21 }], highlight: 'Housing', insight: 'Housing eats *a third*', source: 'BLS 2025' },
  'line-chart': { title: 'The climb', points: [100, 118, 131, 155], labels: ['2019', '2025'], insight: 'Up *55 percent*' },
  'donut-stat': { value: 73, label: 'skip *breakfast* daily', kicker: 'THE SHARE' },
  'chapter-card': { name: 'The turn', number: '02', kicker: 'PART TWO' },
  timeline: { title: 'How we got here', events: [{ label: 'First warning', year: '2019' }, { label: 'The spike', year: '2022' }, { label: 'New normal', year: '2025' }] },
  breath: { line: 'breathe' },
};

function ctx(style: ScaffoldCtx['style'], sceneIndex = 0): ScaffoldCtx {
  return {
    style,
    kitPrefix: '../../',
    sceneIndex,
    readAsset: (rel) => (rel.endsWith('.svg') ? '<svg viewBox="0 0 24 24"><path d="M0 0h24v24"/></svg>' : null),
    accent: '#0a7d5b',
  };
}

test('scaffolds: every archetype renders for every style pack with the craft baked in', () => {
  for (const id of SCAFFOLD_IDS) {
    for (const style of ['clean', 'nutshell', 'broadcast', 'vox', 'nordic'] as const) {
      if (id === 'character-beat' && style !== 'nutshell') continue; // pack fidelity: mascot is nutshell-only
      const r = materializeScaffold({ id, slots: MINIMAL_SLOTS[id] }, ctx(style, 2));
      assert.deepEqual(r.problems, [], `${id}/${style}: ${r.problems.join('; ')}`);
      const html = r.html!;
      assert.match(html, /\.\.\/\.\.\/motion-kit\/motion\.js/, `${id}/${style} links the runtime with the kit prefix`);
      assert.match(html, /\.\.\/\.\.\/motion-kit\/motion\.css/);
      assert.match(html, /mg-vignette/, `${id}/${style} carries atmosphere`);
      assert.match(html, /mg-cam-(in|out|drift)/, `${id}/${style} has a camera move`);
      assert.match(html, /mg-exit-(up|fade|scale)/, `${id}/${style} has exit choreography`);
      assert.doesNotMatch(html, /https?:\/\//, `${id}/${style} is self-contained`);
    }
  }
});

test('scaffolds: word ceilings reject walls of text; unknown ids and missing assets fail with guidance', () => {
  const long = materializeScaffold(
    { id: 'hook-question', slots: { question: 'This is a very long question that goes on and on and on and definitely exceeds the word ceiling for a hook' } },
    ctx('clean'),
  );
  assert.ok(long.problems.some((p) => p.includes('word ceiling')), long.problems.join());
  const unknown = materializeScaffold({ id: 'nope', slots: {} }, ctx('clean'));
  assert.ok(unknown.problems[0].includes('unknown scaffold'));
  const missingAsset = materializeScaffold({ id: 'callout', slots: { subject: 'assets/never-made.svg', text: 'of everything' } }, {
    ...ctx('broadcast'),
    readAsset: () => null,
  });
  assert.ok(missingAsset.problems.some((p) => p.includes('search_assets')), missingAsset.problems.join());
});

test('scaffolds: camera direction and auto-grounds rotate per scene (adjacent contrast by default)', () => {
  const a = materializeScaffold({ id: 'quote-punch', slots: MINIMAL_SLOTS['quote-punch'], }, ctx('clean', 0)).html!;
  const b = materializeScaffold({ id: 'quote-punch', slots: MINIMAL_SLOTS['quote-punch'], }, ctx('clean', 1)).html!;
  const cam = (h: string) => h.match(/mg-cam-(in|out|drift)/)![0];
  assert.notEqual(cam(a), cam(b), 'adjacent scenes get different camera moves');
  assert.notEqual(groundClass('clean', undefined, 0), groundClass('clean', undefined, 1));
  assert.equal(groundClass('nutshell', undefined, 0), 'mg-ground-space');
  assert.equal(groundClass('vox', 'home', 0), 'mg-ground-studio');
});

// ---------------- deterministic QC: pure pieces ----------------

test('qc: stillness pairs, signalstat parsing, monotone pacing, hook gate', () => {
  const pairs = stillnessPairs(9000, 30);
  assert.equal(pairs.length, 3);
  for (const [i, j] of pairs) assert.equal(j - i, 15, '0.5s apart at 30fps');
  assert.equal(parseSignalstat('lavfi.signalstats.YAVG=1.234', 'YAVG'), 1.234);
  assert.equal(parseSignalstat('no match here', 'YAVG'), null);
  assert.match(frameDiffCmd('/a.jpg', '/b.jpg'), /blend=all_mode=difference,signalstats/);
  assert.match(cellStdevCmd('/f.jpg', { w: 640, h: 360, x: 640, y: 0 }), /crop=640:360:640:0/);

  assert.equal(isPacingMonotone([9000, 9100, 8900, 9050]), true, 'uniform scenes = monotone');
  assert.equal(isPacingMonotone([2000, 9000, 5000, 12000]), false);
  assert.equal(isPacingMonotone([9000, 9000]), false, 'too few scenes to judge');

  assert.ok(hookProblems('Welcome to our video about cholesterol!'), 'greeting rejected');
  assert.ok(hookProblems("In this video I'll show you how to lower LDL"), 'topic statement rejected');
  assert.ok(hookProblems('Today we are going to explore the fascinating world of lipids'), 'throat-clearing rejected');
  assert.equal(hookProblems('Why does your own bloodstream turn against you?'), null, 'a real hook passes');
  assert.equal(hookProblems(''), null, 'silent visual hook allowed');
  assert.ok(hookProblems('This is a very long opening narration that keeps going and going with lots of setup and context and background information before ever getting to any point at all which loses every viewer'), 'over-long hook rejected');
});

// ---------------- transitions ----------------

test('transitions: xfade kinds are whitelisted, audio fade is bounded (voice-safe), segmented stitch validates seams', async () => {
  const cmd = xfadeCmd('/a.mp4', '/b.mp4', '/o.mp4', { fadeS: 0.5, offsetS: 7.5, kind: 'smoothup', audioFadeS: 0.5 });
  assert.match(cmd, /xfade=transition=smoothup:duration=0\.5:offset=7\.5/);
  assert.match(cmd, /acrossfade=d=0\.5/, 'audio crossfade bounded to the silent holds');
  const cheesy = xfadeCmd('/a.mp4', '/b.mp4', '/o.mp4', { fadeS: 0.5, offsetS: 7.5, kind: 'pixelize' });
  assert.match(cheesy, /xfade=transition=fade:/, 'non-whitelisted kind falls back to fade');
  assert.ok(XFADE_KINDS.includes('fadeblack') && XFADE_KINDS.includes('circleopen'));
  await assert.rejects(
    () => stitchClipsSegmented(['/a.mp4', '/b.mp4'], '/tmp/never.mp4', [], {}),
    /one entry per seam/,
  );
});

// ---------------- photos: builders, parsers, provider fallback ----------------

test('photos: request builders + parsers (pexels/openverse/wikimedia)', () => {
  assert.match(pexelsSearchUrl('salmon', { orientation: 'landscape', perPage: 5 }), /api\.pexels\.com\/v1\/search\?query=salmon&per_page=5&orientation=landscape/);
  assert.match(pexelsSearchUrl('city', { kind: 'video' }), /api\.pexels\.com\/videos\/search/);
  const px = parsePexels(
    { photos: [{ id: 9, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/9/', photographer: 'Jane', src: { large2x: 'https://images.pexels.com/9-l2x.jpg', medium: 'https://images.pexels.com/9-m.jpg' } }] },
    'photo',
  );
  assert.equal(px.length, 1);
  assert.equal(px[0].id, 'pexels:9');
  assert.match(px[0].attribution, /Jane/);
  const ov = parseOpenverse({ results: [{ id: 'abc', url: 'https://x.org/i.jpg', thumbnail: 'https://x.org/t.jpg', width: 2000, height: 1500, creator: 'Bob', license: 'by-sa', attribution: '"i" by Bob is licensed under CC BY-SA' }] });
  assert.equal(ov[0].provider, 'openverse');
  assert.equal(ov[0].license, 'BY-SA');
  const wm = parseWikimedia({ query: { pages: { '1': { pageid: 1, title: 'File:Salmon.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/salmon-1600.jpg', thumbwidth: 1600, thumbheight: 1000, extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: '<a href="#">Ann</a>' } } }] } } } });
  assert.equal(wm[0].provider, 'wikimedia');
  assert.match(wm[0].attribution, /Ann/);
  assert.match(wikimediaSearchUrl('salmon'), /commons\.wikimedia\.org/);
  assert.match(openverseSearchUrl('salmon'), /license_type=commercial/);
});

test('photos: provider order — pexels when keyed, keyless CC fallbacks otherwise, honest empty', async () => {
  const calls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes('pexels')) {
      assert.equal((init?.headers as any)?.Authorization, 'px-test-key', 'pexels gets the auth header');
      return { status: 200, body: JSON.stringify({ photos: [{ id: 1, width: 3000, height: 2000, photographer: 'P', src: { large: 'https://images.pexels.com/1.jpg' } }] }) };
    }
    if (url.includes('openverse')) return { status: 200, body: JSON.stringify({ results: [{ id: 'o1', url: 'https://o.org/1.jpg', width: 1600, height: 1200 }] }) };
    return { status: 200, body: JSON.stringify({ query: { pages: {} } }) };
  };
  __setPexelsKeyForTest('px-test-key');
  const keyed = await searchPhotos('salmon', { limit: 1 }, fetcher);
  assert.equal(keyed.candidates[0].provider, 'pexels');
  __setPexelsKeyForTest('');
  calls.length = 0;
  const keyless = await searchPhotos('salmon', { limit: 3 }, fetcher);
  assert.ok(!calls.some((u) => u.includes('pexels')), 'no pexels call without a key');
  assert.ok(keyless.candidates.some((c) => c.provider === 'openverse'));
  const empty = await searchPhotos('salmon', { kind: 'video' }, fetcher); // video needs pexels
  assert.equal(empty.candidates.length, 0);
  assert.ok(empty.notes.some((n) => n.includes('Pexels key')), 'honest note about the video gap');
});

// ---------------- the tool: hook gate, word budget, scaffold flow ----------------

const toolCtx = (dir: string): any => ({ repoDir: dir, signal: new AbortController().signal, addCost: () => {}, session: {}, mode: 'chat' });

test('motion tool: throat-clearing scene-1 narration is rejected before any TTS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-hook-'));
  const out = await renderMotionVideoTool.run(
    { scenes: [{ title: 'Intro', narration: 'Welcome to this video about cholesterol', scaffold: { id: 'hook-question', slots: { question: 'What is LDL?' } } }] },
    toolCtx(dir),
  );
  assert.match(out, /throat-clearing/);
  assert.match(out, /THE HOOK/);
  assert.ok(!fs.existsSync(path.join(dir, 'videos')), 'nothing rendered on a rejected hook');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('motion tool: narration overshoot vs target_seconds is caught before synthesis', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-budget-'));
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
  const out = await renderMotionVideoTool.run(
    {
      target_seconds: 15,
      scenes: [
        { title: 'Hook', narration: 'Why does this fail?', scaffold: { id: 'hook-question', slots: { question: 'Why does this fail?' } } },
        { title: 'Body', narration: long, scaffold: { id: 'quote-punch', slots: { lines: ['A line'] } } },
      ],
    },
    toolCtx(dir),
  );
  assert.match(out, /words? TOTAL|word budget|budget ≈/i);
  assert.match(out, /15s target/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('motion tool: scaffold slot problems are returned verbatim, nothing written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-slots-'));
  const out = await renderMotionVideoTool.run(
    {
      scenes: [
        { title: 'Hook', narration: 'Why do budgets fail?', scaffold: { id: 'hook-question', slots: {} } }, // missing question
      ],
    },
    toolCtx(dir),
  );
  assert.match(out, /scaffold slot problems/);
  assert.match(out, /"question" is required/);
  assert.ok(!fs.existsSync(path.join(dir, 'videos')), 'no files on bad slots');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('motion tool: a silent scaffold punch beat renders end-to-end (real capture+encode) and passes the motion audit', { timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-e2e-'));
  const out = await renderMotionVideoTool.run(
    {
      scenes: [
        {
          title: 'Punch',
          narration: '',
          min_ms: 3400,
          scaffold: { id: 'end-punch', slots: { line: 'Start with breakfast tomorrow', sub: 'One bowl. That is it.' } },
        },
      ],
      aspect_ratio: '16:9',
      style: 'clean',
    },
    toolCtx(dir),
  );
  assert.match(out, /Motion video assembled/, out.slice(0, 400));
  assert.match(out, /✓/);
  const sceneHtml = fs.readdirSync(path.join(dir, 'videos')).flatMap((d) => fs.readdirSync(path.join(dir, 'videos', d)));
  assert.ok(sceneHtml.includes('scene-1.html'), 'scaffold scene was written into the video dir');
  const html = fs.readFileSync(path.join(dir, 'videos', fs.readdirSync(path.join(dir, 'videos'))[0], 'scene-1.html'), 'utf8');
  assert.match(html, /mg-exit-scale|mg-exit-up/);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'videos', fs.readdirSync(path.join(dir, 'videos'))[0], 'manifest.json'), 'utf8'));
  assert.equal(m.scenes[0].status, 'ok');
  assert.ok(fs.existsSync(path.join(dir, m.stitched)), 'final mp4 exists');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------- doctrine + kit locks ----------------

test('polish doctrine locks: kit v2 classes, MOTION.md hook/pacing/transitions, tool description', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  for (const cls of ['.mg-exit-up', '.mg-exit-fade', '.mg-mask', '.mg-rise', '.mg-words', '.mg-key', '.mg-mark', '.mg-lag', '.mg-squash', '.mg-stress', '.mg-cam-in', '.mg-cam-out', '.mg-cam-drift', '.mg-depth-bg', '.mg-vignette', '.mg-contact', '.mg-prop-hero', '.mg-ground-floor', '.mg-plate-scrim'])
    assert.ok(css.includes(cls), `motion.css v2 has ${cls}`);
  assert.match(css, /--mg-ease-out: cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  const js = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.js'), 'utf8');
  assert.match(js, /splitWords/);
  assert.match(js, /mg-words/);
  const md = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/MOTION.md'), 'utf8');
  for (const section of ['THE HOOK', 'SCRIPT DOCTRINE', 'PACING & RHYTHM', 'TRANSITIONS', 'SCAFFOLDS FIRST', 'KINETIC TYPE'])
    assert.ok(md.includes(section), `MOTION.md documents ${section}`);
  assert.match(md, /BUT or THEREFORE/);
  assert.match(md, /peak-end|Peak-end/i);
  const desc = renderMotionVideoTool.description;
  assert.match(desc, /SCAFFOLDS FIRST/);
  assert.match(desc, /target_seconds/);
  assert.match(desc, /HOOK/);
  const params: any = renderMotionVideoTool.parameters;
  assert.ok(params.properties.scenes.items.properties.scaffold, 'scenes accept scaffold specs');
  assert.deepEqual(params.properties.scenes.items.properties.transition.enum, ['cut', 'dip', 'dip-white', 'dissolve', 'wipe', 'slide', 'circle']);
});

// ---------------- narration-sync + ending fixes (operator 2026-07-05 #2) ----------------

import { fadeOutCmd } from '../src/agent/videoStitch';

test('ending: fade-out command ramps video+audio; scored videos get a MUSIC OUTRO', () => {
  const cmd = fadeOutCmd('/v.mp4', '/out.mp4', 73.4, 0.9);
  assert.match(cmd, /fade=t=out:st=72\.500:d=0\.900/);
  assert.match(cmd, /afade=t=out:st=72\.500:d=0\.900/);
  const tool = fs.readFileSync(path.join(__dirname, '../src/agent/tools/motionVideo.ts'), 'utf8');
  assert.match(tool, /finishWithFade/);
  assert.match(tool, /extraTailMs: i === list\.length - 1 \? \(args\.music \? 2600 : 800\)/,
    'with a music bed the final scene holds long enough for the duck to release — the bed carries the ending');
  assert.match(tool, /finishWithFade\(scored, repoDir, m\.id, signal, 1\.8\)/,
    'the scored fade is longer and lands as the MUSIC resolving, never a clipped voice');
});

test('narration sync: scaffold secondary reveals are PROPORTIONAL to the scene duration', () => {
  const stat = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, ctx('clean', 1)).html!;
  assert.match(stat, /data-count-start-frac="0\.2"/, 'counter starts as a fraction of the narration');
  assert.match(stat, /calc\(var\(--scene-s, 8\) \* 0\.42s\)/, 'label lands mid-narration');
  const steps = materializeScaffold({ id: 'process-steps', slots: MINIMAL_SLOTS['process-steps'] }, ctx('clean', 1)).html!;
  assert.match(steps, /--stagger:calc\(var\(--scene-s, 8\) \* 0\.11s\)/, 'steps spread across the scene');
  const js = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.js'), 'utf8');
  assert.match(js, /data-count-start-frac/);
  assert.match(js, /data-tw-start-frac/);
  const md = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/MOTION.md'), 'utf8');
  assert.match(md, /THE ENDING LANDS/);
  assert.match(md, /PROPORTIONALLY across the scene/);
});

test('typography-as-set: kit primitives + scaffold compositions are not slide-like', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  for (const cls of ['.mg-giant', '.mg-outline', '.mg-echo', '.mg-vert', '.mg-rulelabel', '.mg-tilt-l'])
    assert.ok(css.includes(cls), `motion.css has ${cls}`);
  const hook = materializeScaffold({ id: 'hook-question', slots: { kicker: 'THE QUESTION', question: 'Pay off debt, or invest the difference?' } }, ctx('vox', 0)).html!;
  assert.match(hook, /mg-vert/, 'vertical kicker rail');
  assert.match(hook, /mg-echo mg-outline/, 'outlined background echo word');
  const sizes = [...hook.matchAll(/font-size:(?:min\()?(\d+(?:\.\d+)?)vh/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...sizes) / Math.min(...sizes.filter((s) => s > 1)) >= 3, `scale contrast ≥3x (${sizes.join(',')})`);
  const stat = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, ctx('clean', 1)).html!;
  assert.match(stat, /font-size:min\(34vh, 39\.1vw\)/, 'the stat is enormous and width-bounded (landscape)');
  assert.match(stat, /mg-echo mg-outline/);
  const md = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/MOTION.md'), 'utf8');
  assert.match(md, /TYPOGRAPHY IS THE SET/);
});


test('nordic pack: grounds, grid, numerals, kinetic-type devices, catalog entry', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  for (const cls of ['.mg-ground-paper', '.mg-ground-night', '.mg-grid12', '.mg-kick-rule', '.mg-numeral', '.mg-hairline', '.kt-stamp', '.kt-swap', '.kt-track-in', '.kt-rail-wipe', '.kt-drop', '.kt-caret'])
    assert.ok(css.includes(cls), `motion.css has ${cls}`);
  const md = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/MOTION.md'), 'utf8');
  assert.match(md, /`nordic` — Swiss\/Scandinavian grid editorial/);
  assert.match(md, /ONE device per scene/);
  assert.equal(groundClass('nordic', undefined, 1), 'mg-ground-paper');
  assert.equal(groundClass('nordic', 'night', 0), 'mg-ground-night');
});

// ---------------- render semaphore (ops lesson: 2 concurrent renders = droplet outage) ----------------

import { withRenderSlot } from '../src/agent/tools/motionVideo';

test('render semaphore: concurrent renders serialize FIFO, never overlap, always release', async () => {
  const events: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const job = (name: string, ms: number) =>
    withRenderSlot(async (queuedMs) => {
      events.push(`${name}-start${queuedMs > 5 ? ':queued' : ''}`);
      await sleep(ms);
      events.push(`${name}-end`);
      return name;
    });
  const [a, b, c] = await Promise.all([job('a', 40), job('b', 20), job('c', 10)]);
  assert.deepEqual([a, b, c], ['a', 'b', 'c']);
  assert.deepEqual(events, ['a-start', 'a-end', 'b-start:queued', 'b-end', 'c-start:queued', 'c-end'], 'strict FIFO, no overlap');
  // a failing render releases the slot for the next one
  await assert.rejects(() => withRenderSlot(async () => { throw new Error('boom'); }), /boom/);
  const after = await withRenderSlot(async () => 'recovered');
  assert.equal(after, 'recovered');
});

// ---------------- geometry gate + portrait + pack fidelity (operator audit 2026-07-05) ----------------

import { auditSceneGeometry } from '../src/agent/motion/capture';

test('geometry gate: clipped labels and structural meta-words are caught in the DOM', { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-geom-'));
  fs.mkdirSync(path.join(dir, 'motion-kit'), { recursive: true });
  for (const f of ['motion.css', 'motion.js']) fs.copyFileSync(path.join(__dirname, '../assets/motion-kit', f), path.join(dir, 'motion-kit', f));
  fs.writeFileSync(
    path.join(dir, 'bad.html'),
    `<!doctype html><html><head><link rel="stylesheet" href="motion-kit/motion.css"></head><body>
     <div class="mg-scene"><div class="mg-breathe" style="position:absolute;left:92%;top:20%;width:300px;font-size:30px;">CLIPS OFF THE EDGE</div>
     <div style="position:absolute;left:10%;top:60%;font-size:24px;">HOOK</div>
     <div style="position:absolute;left:10%;top:70%;font-size:24px;">It *borrows* energy</div>
     <div class="mg-echo mg-outline" style="right:-5vw;bottom:-5vh;font-size:200px;">echo ok</div></div>
     <script src="motion-kit/motion.js"></script></body></html>`,
  );
  const offenders = await auditSceneGeometry(path.join(dir, 'bad.html'), { width: 1080, height: 1920, durationMs: 4000 }, new AbortController().signal);
  assert.ok(offenders.some((o) => o.includes('CLIPS OFF THE EDGE')), `clip caught: ${offenders.join(' | ')}`);
  assert.ok(offenders.some((o) => o.includes('meta-word')), 'HOOK label caught');
  assert.ok(offenders.some((o) => o.includes('asterisk')), 'literal *emphasis* markup caught');
  assert.ok(!offenders.some((o) => o.includes('echo ok')), 'sanctioned echo bleed is allowed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('portrait scaffolds: full-height stacked composition + width-bounded display sizes', () => {
  const p = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, { ...ctx('clean', 1), portrait: true }).html!;
  assert.match(p, /mg-portrait/);
  assert.match(p, /min\(30vh, 34\.5vw\)/, 'stat is width-bounded in portrait');
  const sc = materializeScaffold({ id: 'split-compare', slots: MINIMAL_SLOTS['split-compare'] }, { ...ctx('clean', 1), portrait: true }).html!;
  assert.match(sc, /flex-direction:column/, 'compare stacks vertically in portrait');
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  assert.match(css, /\.mg-portrait \.mg-split \{ grid-template-columns: 1fr/);
});

test('pack fidelity: character-beat is nutshell-only, vox never gets an accent ground, slot text is normalized', () => {
  const bird = materializeScaffold({ id: 'character-beat', slots: MINIMAL_SLOTS['character-beat'] }, ctx('vox', 1));
  assert.ok(bird.problems.some((p) => p.includes('NUTSHELL-only')), bird.problems.join());
  assert.equal(groundClass('vox', 'accent', 0), 'mg-ground-dark', 'vox yellow can never be a full ground');
  assert.equal(groundClass('vox', undefined, 2), 'mg-ground-dark');
  const fixed = materializeScaffold({ id: 'end-punch', slots: { line: 'Real science.Use with care' } }, ctx('clean', 3)).html!;
  assert.match(fixed, /science\. Use/, 'sentence spacing restored');
  const meta = materializeScaffold({ id: 'hook-question', slots: { question: 'hook' } }, ctx('clean', 0));
  assert.ok(meta.problems.some((p) => p.includes('structural word')), meta.problems.join());
  const nordicCallout = materializeScaffold({ id: 'callout', slots: MINIMAL_SLOTS['callout'] }, ctx('nordic', 1)).html!;
  assert.match(nordicCallout, /mg-label-vox ink/, 'nordic callouts are ink labels, never broadcast yellow');
});

// ---------------- format system + pack identity + living frame (operator 2026-07-05:
// "focus on the design part for each, fix it for any size, dynamic movement within frames") ----------------

import { formatOf } from '../src/agent/motion/scaffolds';

test('format system: landscape/square/tall derived from real dimensions, portrait stays a tall alias', () => {
  assert.equal(formatOf({ width: 1920, height: 1080 } as any), 'landscape');
  assert.equal(formatOf({ width: 1080, height: 1080 } as any), 'square');
  assert.equal(formatOf({ width: 1080, height: 1350 } as any), 'square', '4:5 is square-treated, not 9:16-treated');
  assert.equal(formatOf({ width: 1080, height: 1920 } as any), 'tall');
  assert.equal(formatOf({ portrait: true } as any), 'tall', 'legacy portrait flag maps to tall');
  const sq = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, { ...ctx('clean', 1), width: 1080, height: 1080 }).html!;
  assert.match(sq, /mg-fmt-sq/, 'square scenes carry the square format class');
  assert.doesNotMatch(sq, /mg-portrait/, 'square is NOT portrait-treated');
  const tall = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, { ...ctx('clean', 1), width: 1080, height: 1920 }).html!;
  assert.match(tall, /mg-portrait mg-fmt-tall/);
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  assert.match(css, /\.mg-fmt-sq \.mg-safe/, 'square override block exists');
});

test('pack identity: every scene carries mg-style-<pack>, accents baked into the kit, agent accent still wins inline', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  for (const s of ['clean', 'nutshell', 'broadcast', 'vox', 'nordic']) assert.ok(css.includes(`.mg-style-${s}`), `pack block .mg-style-${s}`);
  assert.match(css, /\.mg-style-nutshell \{ --mg-accent: #e30050/);
  assert.match(css, /\.mg-style-vox\.mg-ground-dark \{ --mg-accent: #ffe600/, 'vox full yellow only on dark grounds');
  const scene = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, ctx('broadcast', 1)).html!;
  assert.match(scene, /mg-style-broadcast/);
  assert.match(scene, /style="--mg-accent:#0a7d5b;"/, 'agent-passed accent is INLINE on the scene element (beats pack class tokens)');
  const noAccent = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, { ...ctx('nutshell', 1), accent: undefined }).html!;
  assert.doesNotMatch(noAccent, /mg-scene[^>]*style=/, 'no inline theme when no accent passed — the pack DNA rules');
  // per-pack card DNA exists
  for (const sel of ['.mg-style-broadcast .mg-card', '.mg-style-nordic .mg-card', '.mg-style-nutshell .mg-card']) assert.ok(css.includes(sel), sel);
});

test('living frame: perpetual ambients baked into scaffolds, weak-motion advisory in QC', async () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  assert.match(css, /\.mg-drift \{ animation: mgDriftXY/, 'perpetual drift wrapper');
  assert.match(css, /\.mg-runline/, 'travelling accent hairline');
  const stat = materializeScaffold({ id: 'hero-stat', slots: MINIMAL_SLOTS['hero-stat'] }, ctx('clean', 1)).html!;
  assert.match(stat, /mg-drift/, 'the echo drifts perpetually');
  assert.match(stat, /mg-runline/, 'a living baseline band fills the lower frame');
  const compare = materializeScaffold(
    {
      id: 'split-compare',
      slots: {
        left: { title: 'Pay debt', lines: ['guaranteed 7%'], icon: 'assets/icon.svg' },
        right: { title: 'Invest', lines: ['average 7%'], icon: 'assets/icon.svg' },
      },
    },
    ctx('clean', 1),
  ).html!;
  assert.match(compare, /mg-card/, 'compare uses the pack-skinned card, not a ghost band');
  assert.match(compare, /mg-bob/, 'icons idle with phase offsets');
  // callout: the big number is a hero stat ABOVE the label, never concatenated inside it
  const call = materializeScaffold({ id: 'callout', slots: MINIMAL_SLOTS['callout'] }, ctx('broadcast', 1)).html!;
  assert.match(call, /mg-stat mg-pop/, 'big number rendered as a stat block');
  assert.doesNotMatch(call, /<span class="big">/, 'number never concatenated inside the callout box');
  const md = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/MOTION.md'), 'utf8');
  assert.match(md, /LIVING FRAME/);
  assert.match(md, /## FORMATS/);
  assert.match(md, /PACK DNA IS IN THE ENGINE/);
});

// ---------------- STUDIO LOOK (operator 2026-07-05: "real photos, cut outs, typography") ----------------

test('studio material: cutout/duotone/collage kit + pack display faces + guaranteed fonts', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  for (const cls of ['.mg-cutout', '.mg-cutout.sticker', '.mg-cutout.ink', '.mg-duotone', '.mg-archival', '.mg-halftone', '.mg-tape', '.mg-torn', '.mg-polaroid', '.mg-crop-circle', '.mg-crop-arch', '.mg-photo-grain'])
    assert.ok(css.includes(cls), `motion.css has ${cls}`);
  // pack display voices come from the bundled font set, not everything-Inter
  assert.match(css, /\.mg-style-clean \{[^}]*'Fraunces'/);
  assert.match(css, /\.mg-style-nutshell \{[^}]*'Bricolage Grotesque'/);
  assert.match(css, /\.mg-style-broadcast \{[^}]*'Space Grotesk'/);
  // the tool guarantees fonts/ in the workspace (scenes silently fell back to system fonts)
  const tool = fs.readFileSync(path.join(__dirname, '../src/agent/tools/motionVideo.ts'), 'utf8');
  assert.match(tool, /report-fonts/, 'ensureMotionKit installs the bundled fonts');
  // search_photos produces cutouts via the product-ad isolation step
  const assets = fs.readFileSync(path.join(__dirname, '../src/agent/tools/assets.ts'), 'utf8');
  assert.match(assets, /cutout/);
  assert.match(assets, /isolateProduct/);
});

test('studio scaffolds: photo-hero/cutout-stat/collage-compare across packs + formats, pack edge treatments', () => {
  // sticker outline on the playful packs, ink outline on nordic, plain shadow on clean
  const nut = materializeScaffold({ id: 'cutout-stat', slots: MINIMAL_SLOTS['cutout-stat'] }, ctx('nutshell', 1)).html!;
  assert.match(nut, /mg-cutout sticker/);
  const nor = materializeScaffold({ id: 'cutout-stat', slots: MINIMAL_SLOTS['cutout-stat'] }, ctx('nordic', 1)).html!;
  assert.match(nor, /mg-cutout ink/);
  const cln = materializeScaffold({ id: 'cutout-stat', slots: MINIMAL_SLOTS['cutout-stat'] }, ctx('clean', 1)).html!;
  assert.match(cln, /class="mg-pop mg-cutout"/);
  // photo-hero treats the plate (duotone default) and grains it — never a raw rectangle
  const hero = materializeScaffold({ id: 'photo-hero', slots: MINIMAL_SLOTS['photo-hero'] }, ctx('vox', 0)).html!;
  assert.match(hero, /mg-duotone/);
  assert.match(hero, /mg-photo-grain/);
  assert.match(hero, /mg-plate-scrim/);
  // tall format stacks the collage compare
  const tallC = materializeScaffold({ id: 'collage-compare', slots: MINIMAL_SLOTS['collage-compare'] }, { ...ctx('broadcast', 1), width: 1080, height: 1920 }).html!;
  assert.match(tallC, /flex-direction:column/);
  // bad paths fail with guidance
  const bad = materializeScaffold({ id: 'cutout-stat', slots: { ...MINIMAL_SLOTS['cutout-stat'], cutout: 'assets/icon.svg' } }, ctx('clean', 1));
  assert.ok(bad.problems.some((p) => p.includes('photo path')), bad.problems.join());
  // annotated-plate takes a studio treatment
  const plate = materializeScaffold({ id: 'annotated-plate', slots: { ...MINIMAL_SLOTS['annotated-plate'], treatment: 'archival' } }, ctx('vox', 1)).html!;
  assert.match(plate, /mg-archival/);
  // geometry gate sanctions cutout/duotone bleed
  const cap = fs.readFileSync(path.join(__dirname, '../src/agent/motion/capture.ts'), 'utf8');
  assert.match(cap, /'mg-cutout','mg-duotone','mg-tape'/);
  const md = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/MOTION.md'), 'utf8');
  assert.match(md, /STUDIO MATERIAL/);
});

// ---------------- craft arc (research 2026-07-05: animated data, emphasis, shot grammar) ----------------

test('craft: animated charts from data slots — hero-series discipline, counting labels, draw-on lines, donut sync', () => {
  const bar = materializeScaffold({ id: 'bar-chart', slots: MINIMAL_SLOTS['bar-chart'] }, ctx('vox', 1)).html!;
  assert.match(bar, /mgc-row hot/, 'exactly one hero bar');
  assert.equal((bar.match(/mgc-row hot/g) ?? []).length, 1);
  assert.match(bar, /data-count-to="38"/, 'value labels count');
  assert.match(bar, /mgc-source/, 'credibility source line');
  const line = materializeScaffold({ id: 'line-chart', slots: MINIMAL_SLOTS['line-chart'] }, ctx('nordic', 1)).html!;
  assert.match(line, /pathLength="1000"/, 'line draws without measuring');
  assert.match(line, /mgc-dot/, 'end dot pops');
  assert.match(line, /data-count-to="155"/, 'end value counts');
  const donut = materializeScaffold({ id: 'donut-stat', slots: MINIMAL_SLOTS['donut-stat'] }, ctx('clean', 1)).html!;
  assert.match(donut, /--off:27\.0/, 'donut sweep = value');
  assert.match(donut, /data-count-to="73"/);
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  assert.match(css, /--mg-ease-chart/, 'chart easing token');
  assert.match(css, /\.mgc-donut-fill/);
});

test('craft: *emphasis* markup, draw-on icons, damped shake, new archetypes, variety advisory', () => {
  // emphasis renders in the pack treatment, word count ignores the asterisks
  const stat = materializeScaffold({ id: 'hero-stat', slots: { value: 5, suffix: 'h', label: 'caffeine *half-life* in you' } }, ctx('vox', 1)).html!;
  assert.match(stat, /<span class="mg-emph"[^>]*>half-life<\/span>/);
  const css = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/motion.css'), 'utf8');
  assert.match(css, /\.mg-style-vox \.mg-emph/, 'vox highlighter emphasis');
  assert.match(css, /\.mg-style-nordic \.mg-emph/, 'nordic rule emphasis');
  // stroke icons draw on
  const call = materializeScaffold({ id: 'callout', slots: { subject: 'assets/icon.svg', text: 'heat kills', tone: 'danger' } }, {
    ...ctx('broadcast', 1),
    readAsset: () => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M0 0h24"/></svg>',
  }).html!;
  assert.match(call, /mg-draw/, 'stroke icon draws on');
  assert.match(call, /mg-shake/, 'danger tone gets the damped shake');
  // new archetypes exist and behave
  const ch = materializeScaffold({ id: 'chapter-card', slots: MINIMAL_SLOTS['chapter-card'] }, ctx('nordic', 2)).html!;
  assert.match(ch, /02/);
  const tl = materializeScaffold({ id: 'timeline', slots: MINIMAL_SLOTS.timeline }, { ...ctx('clean', 1), width: 1080, height: 1920 }).html!;
  assert.match(tl, /mg-bar-v/, 'tall timeline uses the vertical rail');
  const br = materializeScaffold({ id: 'breath', slots: MINIMAL_SLOTS.breath }, ctx('vox', 3)).html!;
  assert.doesNotMatch(br, /mg-title/, 'the breath stays quiet');
  // same-scaffold neighbours get flagged (advisory) in the tool
  const tool = fs.readFileSync(path.join(__dirname, '../src/agent/tools/motionVideo.ts'), 'utf8');
  assert.match(tool, /same scaffold \(/, 'shot-grammar variety advisory');
  const md = fs.readFileSync(path.join(__dirname, '../assets/motion-kit/MOTION.md'), 'utf8');
  assert.match(md, /## ANIMATED DATA/);
  assert.match(md, /## EMPHASIS/);
  assert.match(md, /## SHOT GRAMMAR/);
});
