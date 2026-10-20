import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dependentScenes,
  buildScenePrompt,
  compositePage,
  mergeScenes,
  saveManifest,
  loadManifest,
  latestStoryId,
  storyDirName,
  executeStory,
  continuityAdvisories,
  continuityPairs,
  CONTINUITY_MIN_COSINE,
  STYLE_DRIFT_MIN_COSINE,
  splitNarration,
  narrationSentences,
  extendInputClipUsd,
  skylarkFrameEmbedder,
  planAndInitStory,
  FRAME_EXTRACT_CONCURRENCY,
  NARRATION_MAX_WORDS_PER_S,
  overPackedScenes,
  type StoryManifest,
  type FramePos,
} from '../src/agent/videoStoryExec';
import { estimateStory, EXTEND_INPUT_KTOK_480P } from '../src/agent/videoStory';
import { videoCostEstimate, type VideoSpec } from '../src/engines/seedance';
import { config } from '../src/config';
import { execFileSync } from 'node:child_process';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';
import { normalizeStoryPlan } from '../src/agent/videoStory';
import { generateVideoStoryTool } from '../src/agent/tools/videoStoryTool';
import { ALL_TOOLS } from '../src/agent/tools';

const plan4 = () =>
  normalizeStoryPlan({
    scenes: [
      { what: 'walk', prompt: 'a man walks the desert', mechanism: 't2v', durationS: 6, audioDirection: 'wind' },
      { what: 'phone', prompt: 'close on the phone', mechanism: 'i2v-composited', compositeHtml: '<div>Pick up by ecosine</div>', durationS: 4, audioDirection: 'tap' },
      { what: 'car drop', prompt: 'a helicopter lowers a car', mechanism: 'frame-chain', durationS: 6, audioDirection: 'rotor' },
      { what: 'driver', prompt: 'a suited driver opens the door', mechanism: 'extend', durationS: 5, audioDirection: 'door' },
    ],
  });

// ── pure helpers ──────────────────────────────────────────────────────────────

test('dependentScenes: a retake re-chains the contiguous dependent run', () => {
  const plan = plan4();
  // scene 2 is composited (independent) → retaking 1 pulls only 1... but 3 chains off 2, not 1.
  assert.deepEqual(dependentScenes(plan, 1), [1]);
  // retaking 2 pulls 3 (frame-chain) and 4 (extend) — the whole downstream chain.
  assert.deepEqual(dependentScenes(plan, 2), [2, 3, 4]);
  assert.deepEqual(dependentScenes(plan, 4), [4]);
  assert.deepEqual(dependentScenes(plan, 99), [99]);
});

test('buildScenePrompt: scene + shared style + audio compile through the video compiler', () => {
  const p = buildScenePrompt(plan4().scenes[0], 'Style: cinematic photoreal, warm light.', undefined);
  assert.match(p, /a man walks the desert/);
  assert.match(p, /cinematic photoreal/);
  assert.match(p, /Audio: wind/);
  const retake = buildScenePrompt(plan4().scenes[0], 'Style: x.', 'make him walk slower');
  assert.match(retake, /walk slower/);
});

test('compositePage: fragments get wrapped and sized; full documents pass through', () => {
  const w = compositePage('<div>BTN</div>', 720, 1280);
  assert.match(w, /width:720px;height:1280px/);
  assert.match(w, /BTN/);
  const full = compositePage('<html><body>x</body></html>', 100, 100);
  assert.ok(!full.includes('width:100px'), 'full documents are not re-wrapped');
});

test('mergeScenes: fresh results override by id, order restored', () => {
  const merged = mergeScenes(
    [
      { id: 1, what: 'a', mechanismPlanned: 't2v', mechanismUsed: 't2v', status: 'ok', file: 'old1' },
      { id: 2, what: 'b', mechanismPlanned: 't2v', mechanismUsed: 't2v', status: 'failed' },
    ],
    [{ id: 2, what: 'b', mechanismPlanned: 't2v', mechanismUsed: 't2v', status: 'ok', file: 'new2' }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[1].file, 'new2');
  assert.equal(merged[1].status, 'ok');
});

// ── manifest round-trip ───────────────────────────────────────────────────────

test('manifest: save/load/latest round-trip', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  const m: StoryManifest = {
    id: '1111',
    createdAt: 1,
    story: 's',
    aspect: '16:9',
    audio: true,
    transition: 'cut',
    plan: plan4(),
    pass: 'draft',
    scenes: [],
    totalTokens: 0,
    costUsd: 0,
  };
  saveManifest(repo, m);
  const loaded = loadManifest(repo, '1111');
  assert.equal(loaded?.plan.scenes.length, 4);
  const m2 = { ...m, id: '2222' };
  saveManifest(repo, m2);
  assert.equal(latestStoryId(repo), '2222');
  assert.equal(loadManifest(repo, 'nope'), null);
  assert.match(storyDirName('1111'), /^videos\/story-1111$/);
  fs.rmSync(repo, { recursive: true, force: true });
});

// ── tool registration + steering surface ─────────────────────────────────────

test('generate_video_story: registered, gated like generate_video, schema sane', () => {
  const tool = ALL_TOOLS.find((t) => t.name === 'generate_video_story');
  assert.ok(tool, 'registered in ALL_TOOLS');
  assert.deepEqual(tool!.modes, ['chat', 'code']);
  const props = (tool!.parameters as any).properties;
  for (const k of ['story', 'final', 'retake_scene', 'retake_note', 'story_id', 'cast_images', 'transition']) {
    assert.ok(props[k], `param ${k}`);
  }
  assert.match(tool!.description, /SEQUENCE/);
  assert.equal(generateVideoStoryTool.summarize({ retake_scene: 2 }), 'retake scene 2');
});

test('generate_video_story: follow-up without an existing story fails plainly', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  const out = await generateVideoStoryTool.run(
    { final: true },
    { repoDir: repo, signal: new AbortController().signal, addCost: () => {}, session: {} as any, mode: 'chat' } as any,
  );
  assert.match(out, /no existing story/i);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('style anchor (the Higgsfield style-key borrow): manifest carries it, exec anchors ONLY plain t2v scenes', () => {
  // manifest round-trip
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-anchor-'));
  const m: StoryManifest = {
    id: '3333', createdAt: 1, story: 's', aspect: '16:9', audio: true, transition: 'cut',
    plan: plan4(), pass: 'draft', scenes: [], totalTokens: 0, costUsd: 0,
    styleAnchor: 'images/style-key.jpg',
  };
  saveManifest(repo, m);
  assert.equal(loadManifest(repo, '3333')?.styleAnchor, 'images/style-key.jpg');
  fs.rmSync(repo, { recursive: true, force: true });
  // tool surface
  const tool = ALL_TOOLS.find((t) => t.name === 'generate_video_story')!;
  assert.ok((tool.parameters as any).properties.style_anchor, 'style_anchor param exposed');
  // exec semantics (source-locked — buildSpec is a closure): the anchor applies only to a
  // bare t2v scene, rides referenceUrls, prefixes a style-only instruction, and routes r2v.
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/videoStoryExec.ts'), 'utf8');
  assert.match(src, /mech === 't2v' && !useRefs && !openingFrameApplies/);
  // The suppression and the opening-frame application MUST share the same existence gate, or a
  // truthy-but-missing openingFrame leaves scene 1 un-anchored (review finding 2026-07-07).
  assert.match(src, /openingFrameApplies = !!openingFrameAbs && fs\.existsSync\(openingFrameAbs\)/);
  assert.match(src, /do NOT copy its content/);
  assert.match(src, /useRefs \|\| useStyleAnchor \? 'arksai-video-20-fast'/);
  assert.match(src, /else if \(useStyleAnchor\)/);
});

// ── Skylark continuity review (advisory) ─────────────────────────────────────

test('continuity floors: a cut must match tighter than two shots of one story', () => {
  assert.ok(CONTINUITY_MIN_COSINE > STYLE_DRIFT_MIN_COSINE);
  assert.ok(CONTINUITY_MIN_COSINE < 1 && STYLE_DRIFT_MIN_COSINE > 0);
});

test('continuityAdvisories: strictly-below-floor only, per kind, with a retake hint on cuts', () => {
  const eps = 0.001;
  assert.deepEqual(
    continuityAdvisories([
      { kind: 'cut', sceneId: 2, refSceneId: 1, cosine: CONTINUITY_MIN_COSINE }, // AT the floor → fine
      { kind: 'style', sceneId: 3, refSceneId: 1, cosine: STYLE_DRIFT_MIN_COSINE }, // AT the floor → fine
      { kind: 'style', sceneId: 4, refSceneId: 1, cosine: 0.99 },
    ]),
    [],
  );
  const cut = continuityAdvisories([{ kind: 'cut', sceneId: 3, refSceneId: 2, cosine: CONTINUITY_MIN_COSINE - eps }]);
  assert.equal(cut.length, 1);
  assert.match(cut[0], /scene 3 may not continue cleanly from scene 2/);
  assert.match(cut[0], /retake of scene 3/);
  const style = continuityAdvisories([{ kind: 'style', sceneId: 4, refSceneId: 1, cosine: STYLE_DRIFT_MIN_COSINE - eps }]);
  assert.equal(style.length, 1);
  assert.match(style[0], /scene 4's look may have drifted from scene 1 \(style similarity 0\.\d\d\)/);
  // A score between the two floors flags a CUT but not a style comparison.
  const mid = (CONTINUITY_MIN_COSINE + STYLE_DRIFT_MIN_COSINE) / 2;
  assert.equal(continuityAdvisories([{ kind: 'cut', sceneId: 2, refSceneId: 1, cosine: mid }]).length, 1);
  assert.equal(continuityAdvisories([{ kind: 'style', sceneId: 2, refSceneId: 1, cosine: mid }]).length, 0);
});

test('continuityPairs: cuts only where a scene CONTINUES the previous clip; style vs scene 1, composites skipped', () => {
  const pairs = continuityPairs([
    { id: 1, mechanismUsed: 't2v' },
    { id: 2, mechanismUsed: 'i2v-composited' },
    { id: 3, mechanismUsed: 'frame-chain' },
    { id: 4, mechanismUsed: 'extend' },
    { id: 5, mechanismUsed: 't2v' },
  ]);
  const cuts = pairs.filter((p) => p.kind === 'cut');
  assert.deepEqual(cuts, [
    { kind: 'cut', sceneId: 3, refSceneId: 2, at: 'first', refAt: 'last' },
    { kind: 'cut', sceneId: 4, refSceneId: 3, at: 'first', refAt: 'last' },
  ]);
  const styles = pairs.filter((p) => p.kind === 'style');
  assert.deepEqual(styles.map((p) => [p.sceneId, p.refSceneId, p.at, p.refAt]), [
    [3, 1, 'mid', 'mid'],
    [4, 1, 'mid', 'mid'],
    [5, 1, 'mid', 'mid'],
  ]);
  // The "previous clip" is the previous SUCCESSFUL one (failed scenes are filtered out upstream).
  assert.deepEqual(continuityPairs([{ id: 1, mechanismUsed: 't2v' }, { id: 3, mechanismUsed: 'frame-chain' }])[0], {
    kind: 'cut', sceneId: 3, refSceneId: 1, at: 'first', refAt: 'last',
  });
  assert.deepEqual(continuityPairs([{ id: 1, mechanismUsed: 't2v' }]), []);
});

// End-to-end through executeStory with both seams (generate + embedFrame): real tiny clips via
// ffmpeg, embeddings faked as fixed vectors. Skipped where ffmpeg isn't installed.
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function makeClip(abs: string): void {
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', abs,
  ]);
}

function chainManifest(id: string): StoryManifest {
  return {
    id, createdAt: 1, story: 'A lighthouse keeper at dusk', aspect: '16:9', audio: true, transition: 'cut',
    plan: normalizeStoryPlan({
      scenes: [
        { what: 'wide', prompt: 'a lighthouse on a cliff at dusk, wide establishing shot', mechanism: 't2v', durationS: 4, audioDirection: 'surf' },
        { what: 'keeper', prompt: 'the keeper climbs the spiral stairs, continuing the shot', mechanism: 'frame-chain', durationS: 4, audioDirection: 'steps' },
        { what: 'lamp', prompt: 'close on the great lamp igniting, warm glow', mechanism: 't2v', durationS: 4, audioDirection: 'hum' },
      ],
    }),
    pass: 'draft', scenes: [], totalTokens: 0, costUsd: 0,
  };
}

async function runChain(embed: ExecuteEmbed | undefined) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-continuity-'));
  const clipDir = path.join(repo, 'clips');
  fs.mkdirSync(clipDir, { recursive: true });
  const m = chainManifest(`c${Date.now()}`);
  const generated: number[] = [];
  const out = await executeStory(m, {
    repoDir: repo,
    signal: new AbortController().signal,
    addCost: () => {},
    generate: async (_spec, sceneId) => {
      generated.push(sceneId);
      const f = path.join(clipDir, `scene-${sceneId}.mp4`);
      makeClip(f);
      return { file: f };
    },
    embedFrame: embed,
  });
  return { repo, out, generated };
}
type ExecuteEmbed = (clipAbs: string, at: FramePos, durationS?: number) => Promise<number[] | null>;

const sceneOf = (clipAbs: string) => Number(/scene-(\d+)\.mp4$/.exec(clipAbs)![1]);

test('executeStory: the Skylark review scores the chained cut + style drift and records advisories', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  // Fixed unit vectors per (scene, frame): the cut 1→2 scores 0.6 (< cut floor), scene 2's look
  // matches scene 1 (0.9), scene 3 drifted (0.5 < style floor).
  const V: Record<string, number[]> = {
    '1:last': [1, 0], '2:first': [0.6, 0.8],
    '1:mid': [1, 0], '2:mid': [0.9, Math.sqrt(1 - 0.81)], '3:mid': [0.5, Math.sqrt(0.75)],
  };
  const calls: string[] = [];
  const { repo, out } = await runChain(async (clipAbs, at) => {
    const key = `${sceneOf(clipAbs)}:${at}`;
    calls.push(key);
    return V[key] ?? null;
  });
  try {
    assert.equal(out.scenes.filter((s) => s.status === 'ok').length, 3);
    assert.ok(out.stitched, 'the story still ships');
    assert.deepEqual([...calls].sort(), Object.keys(V).sort(), 'each (scene, frame) embedded exactly once');
    const byKey = Object.fromEntries((out.continuityScores ?? []).map((s) => [`${s.kind}:${s.sceneId}:${s.refSceneId}`, s.cosine]));
    assert.deepEqual(byKey, { 'cut:2:1': 0.6, 'style:2:1': 0.9, 'style:3:1': 0.5 });
    assert.equal(out.advisories?.length, 2);
    assert.match(out.advisories![0], /scene 2 may not continue cleanly from scene 1/);
    assert.match(out.advisories![1], /scene 3's look may have drifted/);
    // Persisted on the manifest (kept for threshold calibration).
    assert.deepEqual(loadManifest(repo, out.id)?.continuityScores, out.continuityScores);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('executeStory: a failing/throwing embedder leaves pairs unscored and NEVER fails the story', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  // Scene 1's mid frame throws, everything else is identical → only the cut is scorable.
  const { repo, out } = await runChain(async (clipAbs, at) => {
    if (sceneOf(clipAbs) === 1 && at === 'mid') throw new Error('embedding service down');
    return [1, 0];
  });
  try {
    assert.equal(out.scenes.filter((s) => s.status === 'ok').length, 3);
    assert.ok(out.stitched);
    assert.deepEqual(out.continuityScores, [{ kind: 'cut', sceneId: 2, refSceneId: 1, cosine: 1 }]);
    assert.equal(out.advisories, undefined, 'a clean cut produces no advisory');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  // Every embedding unavailable → no scores at all (not an empty-array artefact).
  const none = await runChain(async () => null);
  try {
    assert.equal(none.out.continuityScores, undefined);
    assert.equal(none.out.advisories, undefined);
    assert.ok(none.out.stitched);
  } finally {
    fs.rmSync(none.repo, { recursive: true, force: true });
  }
});

test('executeStory: under a faked generate the review stays OFF by default (no Skylark calls, even keyed)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    return new Response('{}', { status: 500 });
  }) as any;
  __setByteplusKeyForTest('ark-test');
  try {
    const { repo, out } = await runChain(undefined);
    try {
      assert.equal(out.continuityScores, undefined);
      assert.equal(fetched, 0, 'no embedding/vision request leaves the box for a faked render');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
});

// ── narration: Seedance native audio, no TTS (V10) ───────────────────────────

test('narrationSentences: sentence + line boundaries; a lowercase continuation stays whole', () => {
  assert.deepEqual(narrationSentences('Meet Ava. She runs the café! "Open yet?" she asks.\nTagline here'), [
    'Meet Ava.',
    'She runs the café!',
    '"Open yet?" she asks.',
    'Tagline here',
  ]);
  assert.deepEqual(narrationSentences('   '), []);
});

test('narrationSentences: abbreviations + initials never end a sentence (the reviewer cases, voiced across cuts)', () => {
  // "Say hi to Mr." | "Khan." after a cut was the bug.
  const mr = splitNarration('Say hi to Mr. Khan. He bakes.', [4, 4, 4]);
  assert.deepEqual(mr, ['Say hi to Mr. Khan.', 'He bakes.', '']);
  assert.ok(mr.every((p) => !/\bMr\.$/.test(p)), 'no part ends on the abbreviation');
  assert.deepEqual(splitNarration('Meet Dr. Smith.', [5, 5]), ['Meet Dr. Smith.', '']);
  assert.deepEqual(splitNarration('Open at 9 a.m. Sunday through Friday. Visit us.', [6, 6]), [
    'Open at 9 a.m. Sunday through Friday.',
    'Visit us.',
  ]);
  assert.deepEqual(narrationSentences('J. Smith founded it. He bakes.'), ['J. Smith founded it.', 'He bakes.']);
  // Every listed abbreviation keeps its sentence whole, even before a capitalised word.
  for (const abbr of ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'Prof.', 'Jr.', 'Sr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'a.m.', 'p.m.', 'U.S.', 'Inc.', 'Ltd.', 'Co.']) {
    assert.deepEqual(narrationSentences(`Ask about ${abbr} Brown today. Then go.`), [`Ask about ${abbr} Brown today.`, 'Then go.'], abbr);
  }
  // "No." abbreviates only before a number; a sentence-final "no." still ends the sentence.
  assert.deepEqual(narrationSentences('Gate No. 5 opens first. Go.'), ['Gate No. 5 opens first.', 'Go.']);
  assert.deepEqual(narrationSentences('Just say no. Then smile.'), ['Just say no.', 'Then smile.']);
  // Real sentence ends still split ("I." is a pronoun, not an initial; ! ? … and closing quotes too).
  assert.deepEqual(narrationSentences('Nobody bakes like I. Try it! Really? "Yes." Wait… Now.'), [
    'Nobody bakes like I.',
    'Try it!',
    'Really?',
    '"Yes."',
    'Wait…',
    'Now.',
  ]);
});

test('narrationSentences: a single newline is a soft wrap unless the line ends a sentence; a blank line is a hard break', () => {
  // A hard-wrapped sentence is ONE sentence — never "Our bakery opens before" | "sunrise …".
  assert.deepEqual(narrationSentences('Our bakery opens before\nSunrise Lane wakes up and\ncloses late. Come by\nany time.'), [
    'Our bakery opens before Sunrise Lane wakes up and closes late.',
    'Come by any time.',
  ]);
  assert.deepEqual(splitNarration('Say hi to\nMr. Khan, who bakes\nthe best bread in town.', [4, 4]), [
    'Say hi to Mr. Khan, who bakes the best bread in town.',
    '',
  ]);
  // A wrap right after an abbreviation is still soft.
  assert.deepEqual(narrationSentences('Say hi to Mr.\nKhan. He bakes.'), ['Say hi to Mr. Khan.', 'He bakes.']);
  // A line that ends a sentence is a hard break even before a lowercase line.
  assert.deepEqual(narrationSentences('We open early.\nand we close late.'), ['We open early.', 'and we close late.']);
  // Blank line (even with stray spaces / CRLF) = paragraph break; an unpunctuated title stays apart.
  assert.deepEqual(narrationSentences('Fresh every morning\r\n  \r\nThe Khan Bakery'), ['Fresh every morning', 'The Khan Bakery']);
});

test('narrationSentences: a soft wrap is judged against the next line\'s first word (V7)', () => {
  // A dialogue tag / "No. 5" wrapped onto the next line is still one sentence.
  assert.deepEqual(narrationSentences('"Ready?"\nshe asks. Then we go.'), ['"Ready?" she asks.', 'Then we go.']);
  assert.deepEqual(narrationSentences('Chanel No.\n5 is a classic. Try it.'), ['Chanel No. 5 is a classic.', 'Try it.']);
  assert.deepEqual(splitNarration('"Ready?"\nshe asks.', [4, 4]), ['"Ready?" she asks.', '']);
  // A blank line is still a hard break; a wrapped line ending on a bare full stop still ends it.
  assert.deepEqual(narrationSentences('"Stop!"\n\nshe said.'), ['"Stop!"', 'she said.']);
  assert.deepEqual(narrationSentences('We open early.\nand we close late.'), ['We open early.', 'and we close late.']);
});

test('narrationSentences: a trailing emoji/symbol run stays with its sentence — never a scene of its own (V8)', () => {
  assert.deepEqual(narrationSentences('Great job! 🎉🎉'), ['Great job! 🎉🎉']);
  assert.deepEqual(narrationSentences('Great job! 🎉🎉 Now rest.'), ['Great job! 🎉🎉', 'Now rest.']);
  assert.deepEqual(narrationSentences('We did it!\n🎉 ✨\nSee you soon.'), ['We did it! 🎉 ✨', 'See you soon.']);
  const parts = splitNarration('We baked it all. Great job! 🎉🎉', [4, 4, 4]);
  assert.deepEqual(parts, ['We baked it all.', 'Great job! 🎉🎉', '']);
  assert.ok(parts.every((p) => !p || /[\p{L}\p{N}]/u.test(p)), 'no emoji-only scene narration');
  // An emoji-only PARAGRAPH (blank-line separated — common in social copy) folds in too.
  assert.deepEqual(splitNarration('Great job!\n\n🎉🎉', [4, 4]), ['Great job! 🎉🎉', '']);
  assert.deepEqual(splitNarration('We baked it all.\n\n🎉🎉🎉\n\nSee you.', [4, 4, 4]), ['We baked it all. 🎉🎉🎉', 'See you.', '']);
  assert.deepEqual(narrationSentences('✨\n\nWelcome in.'), ['✨ Welcome in.'], 'a leading symbol paragraph joins the first line');
});

test('overPackedScenes: names a scene whose share of the voiceover outruns its duration', () => {
  const scenes = [
    { id: 1, durationS: 4 },
    { id: 2, durationS: 8 },
  ];
  const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
  assert.deepEqual(overPackedScenes([words(4 * NARRATION_MAX_WORDS_PER_S + 1), words(3)], scenes), [
    { id: 1, words: 4 * NARRATION_MAX_WORDS_PER_S + 1, durationS: 4 },
  ]);
  assert.deepEqual(overPackedScenes([words(4 * NARRATION_MAX_WORDS_PER_S), ''], scenes), [], 'exactly at the limit is fine');
  assert.deepEqual(overPackedScenes([], scenes), []);
});

test('splitNarration: whole sentences, in order, proportional to scene durations, never mid-sentence', () => {
  const line = 'The desert is silent. One tap changes everything. A helicopter drops the car. Your driver opens the door.';
  const sentences = narrationSentences(line);
  // Equal scenes, one sentence each.
  assert.deepEqual(splitNarration(line, [6, 6, 6, 6]), sentences);
  // Nothing is lost or reordered, and every part is made of WHOLE sentences.
  for (const durs of [[4, 4, 12], [12, 4], [4, 4, 4, 4, 4, 4], [15]]) {
    const parts = splitNarration(line, durs);
    assert.equal(parts.length, durs.length);
    assert.equal(parts.filter(Boolean).join(' '), sentences.join(' '), `order kept for ${durs}`);
    for (const p of parts.filter(Boolean)) assert.ok(narrationSentences(p).every((x) => sentences.includes(x)), `whole sentences: ${p}`);
  }
  // Proportional: a long last scene takes the bulk of the words.
  const long = splitNarration('A b c d e. F g h i j. K l m n o.', [4, 4, 12]);
  assert.deepEqual(long, ['A b c d e.', '', 'F g h i j. K l m n o.']);
  // A single line opens the story (earliest scene on a tie), never a mid-sentence fragment.
  assert.deepEqual(splitNarration('Pick up by ecosine — anywhere, anytime, on demand.', [4, 4, 4]), ['Pick up by ecosine — anywhere, anytime, on demand.', '', '']);
  // No voiceover / no scenes.
  assert.deepEqual(splitNarration(undefined, [6, 6]), ['', '']);
  assert.deepEqual(splitNarration('', [6]), ['']);
  assert.deepEqual(splitNarration('Hi.', []), []);
});

test('buildScenePrompt: a narration part is voiced natively — quoted, off-screen narrator, ambience kept underneath', () => {
  const scene = plan4().scenes[0];
  const p = buildScenePrompt(scene, 'Style: cinematic.', undefined, 'The desert is silent.');
  assert.match(p, /Audio: a clear narrator says "The desert is silent\." \(off-screen voiceover, spoken verbatim, unhurried\), with wind softly underneath\./);
  assert.doesNotMatch(p, /Audio: natural ambient/, 'the compiler must not add a second audio direction');
  assert.equal((p.match(/Audio:/g) || []).length, 1);
  // Inner double quotes can't break the quoted-speech signal.
  assert.match(buildScenePrompt(scene, 'x.', undefined, 'She said "go".'), /says "She said 'go'\."/);
  // No narration → the plain diegetic line, unchanged.
  assert.match(buildScenePrompt(scene, 'x.'), /Audio: wind\./);
  assert.doesNotMatch(buildScenePrompt(scene, 'x.'), /narrator/);
});

/** Run executeStory with a faked generate that records every spec (real 1 s clips under videos/). */
async function runCapture(m: StoryManifest, tokensFor?: (sceneId: number) => number | undefined) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-capture-'));
  const clipDir = path.join(repo, 'videos', 'clips');
  fs.mkdirSync(clipDir, { recursive: true });
  const specs = new Map<number, VideoSpec>();
  const costs: number[] = [];
  const out = await executeStory(m, {
    repoDir: repo,
    signal: new AbortController().signal,
    addCost: (u) => costs.push(u),
    generate: async (spec, sceneId) => {
      specs.set(sceneId, spec);
      const f = path.join(clipDir, `scene-${sceneId}.mp4`);
      makeClip(f);
      return { file: f, tokens: tokensFor?.(sceneId) };
    },
    embedFrame: async () => null,
  });
  return { repo, out, specs, costs };
}

test('executeStory: the voiceover is split across scenes and injected into each scene prompt; audio forced ON where narrated', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const m = chainManifest(`n${Date.now()}`);
  m.audio = false; // the user asked for a silent story — but narration can only be voiced natively
  m.dialogue = 'The keeper watches the sea. Tonight the lamp must burn.';
  const { repo, out, specs } = await runCapture(m);
  try {
    assert.ok(out.stitched);
    const p1 = specs.get(1)!;
    const p2 = specs.get(2)!;
    const p3 = specs.get(3)!;
    assert.match(p1.prompt, /a clear narrator says "The keeper watches the sea\."/);
    assert.match(p2.prompt, /a clear narrator says "Tonight the lamp must burn\."/);
    assert.doesNotMatch(p3.prompt, /narrator/, 'fewer sentences than scenes → the last scene carries none');
    assert.equal(p1.audio, true, 'narrated scene renders native audio even on a silent story');
    assert.equal(p2.audio, true);
    assert.equal(p3.audio, false, 'un-narrated scenes keep the story setting');
    // Each sentence voiced exactly once across the story (no double voice).
    const all = [...specs.values()].map((s) => s.prompt).join('\n');
    assert.equal((all.match(/The keeper watches the sea\./g) || []).length, 1);
    assert.equal((all.match(/Tonight the lamp must burn\./g) || []).length, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('executeStory: a retake re-voices exactly the same part of the line in the same scene', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const m = chainManifest(`r${Date.now()}`);
  m.dialogue = 'First line here. Second line here. Third line here.';
  const first = await runCapture(m);
  try {
    const parts = [1, 2, 3].map((id) => /narrator says "([^"]+)"/.exec(first.specs.get(id)!.prompt)?.[1]);
    const specs = new Map<number, VideoSpec>();
    await executeStory(first.out, {
      repoDir: first.repo,
      signal: new AbortController().signal,
      addCost: () => {},
      onlyScenes: [3],
      retakeNote: 'warmer glow',
      generate: async (spec, sceneId) => {
        specs.set(sceneId, spec);
        const f = path.join(first.repo, 'videos', 'clips', `scene-${sceneId}.mp4`);
        makeClip(f);
        return { file: f };
      },
      embedFrame: async () => null,
    });
    assert.deepEqual([...specs.keys()], [3]);
    assert.equal(/narrator says "([^"]+)"/.exec(specs.get(3)!.prompt)?.[1], parts[2]);
  } finally {
    fs.rmSync(first.repo, { recursive: true, force: true });
  }
});

// ── extension billing includes the input clip (V5) ───────────────────────────

test('extendInputClipUsd: token-based when usage is reported (total − the output share), else the planning constant', () => {
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const r = config.seedanceCostPerKTok;
  // Probe §8.8: a 6 s 480p extension reported 141 k tokens; ~10.15 k/s of that is the output.
  assert.ok(close(extendInputClipUsd(141_000, '480p', 6), (141 - 10.15 * 6) * r));
  // No usage → the same 90 k constant estimateStory quotes (scaled by frame area above 480p).
  assert.ok(close(extendInputClipUsd(undefined, '480p', 6), EXTEND_INPUT_KTOK_480P * r));
  assert.ok(close(extendInputClipUsd(undefined, '1080p', 6), EXTEND_INPUT_KTOK_480P * 5.0625 * r));
  // Never negative.
  assert.equal(extendInputClipUsd(1000, '480p', 6), 0);
});

function extendManifest(id: string): StoryManifest {
  return {
    id, createdAt: 1, story: 'A paper boat', aspect: '16:9', audio: true, transition: 'cut',
    plan: normalizeStoryPlan({
      scenes: [
        { what: 'launch', prompt: 'a paper boat is set on a rain gutter stream, macro', mechanism: 't2v', durationS: 4, audioDirection: 'rain' },
        { what: 'drift', prompt: 'the same paper boat drifts on down the gutter', mechanism: 'extend', durationS: 4, audioDirection: 'rain' },
        // (a third clip keeps the stitched 1 s test clips above the stitcher's minimum output size)
        { what: 'drain', prompt: 'close on a storm drain swallowing the stream', mechanism: 't2v', durationS: 4, audioDirection: 'gurgle' },
      ],
    }),
    pass: 'draft', scenes: [], totalTokens: 0, costUsd: 0,
  };
}

test('executeStory: an extension is billed output-per-second PLUS its input clip (tokens when reported, else 90 k)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  for (const tokens of [141_000, undefined]) {
    const { repo, out, specs, costs } = await runCapture(extendManifest(`e${Date.now()}${tokens ?? 'x'}`), (id) => (id === 2 ? tokens : undefined));
    try {
      assert.equal(specs.get(2)!.model, 'arksai-video-20-fast');
      assert.ok(specs.get(2)!.videoUrl, 'rendered as a real extension');
      const [s1, s2, s3] = out.scenes;
      assert.equal(s2.mechanismUsed, 'extend');
      const expected =
        videoCostEstimate('arksai-video-15', '480p', s1.durationS!) +
        videoCostEstimate('arksai-video-20-fast', '480p', s2.durationS!) +
        extendInputClipUsd(tokens, '480p', s2.durationS!) +
        videoCostEstimate('arksai-video-15', '480p', s3.durationS!);
      assert.ok(close(out.costUsd, expected), `tokens=${tokens}: ${out.costUsd} vs ${expected}`);
      assert.ok(extendInputClipUsd(tokens, '480p', s2.durationS!) > 0, 'the input clip is actually billed');
      assert.ok(close(costs.reduce((a, b) => a + b, 0), expected), 'the session cost bar sees the same total');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

// ── continuity review: bounded ffmpeg fan-out (V4) ───────────────────────────

test('skylarkFrameEmbedder: ffmpeg extractions are bounded (FRAME_EXTRACT_CONCURRENCY) while every frame still embeds', async () => {
  assert.ok(FRAME_EXTRACT_CONCURRENCY >= 2 && FRAME_EXTRACT_CONCURRENCY <= 3);
  let active = 0;
  let peak = 0;
  let extracted = 0;
  const costs: number[] = [];
  const embedder = skylarkFrameEmbedder(
    os.tmpdir(),
    { signal: new AbortController().signal, addCost: (u) => costs.push(u) },
    {
      extract: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        extracted++;
      },
      embed: async () => ({ ok: true, vector: [1, 0] }),
    },
  );
  const vecs = await Promise.all(
    Array.from({ length: 8 }, (_, i) => embedder(`/x/videos/scene-${i}.mp4`, (['first', 'mid', 'last'] as FramePos[])[i % 3], 4)),
  );
  assert.equal(extracted, 8);
  assert.ok(peak <= FRAME_EXTRACT_CONCURRENCY, `peak ${peak} concurrent ffmpeg extractions`);
  assert.ok(peak >= 2, 'still parallel, just bounded');
  assert.deepEqual(vecs, Array(8).fill([1, 0]));
  assert.equal(costs.length, 8);
  // An extraction failure is fail-soft (null) and releases its slot.
  const failing = skylarkFrameEmbedder(os.tmpdir(), { signal: new AbortController().signal, addCost: () => {} }, {
    extract: async () => {
      throw new Error('ffmpeg exploded');
    },
    embed: async () => ({ ok: true, vector: [1] }),
  });
  assert.deepEqual(await Promise.all([1, 2, 3, 4].map(() => failing('/x/videos/a.mp4', 'first'))), [null, null, null, null]);
});

// ── planAndInitStory re-prices once the story-level anchors are known (V2) ────

test('planAndInitStory: a resolving style anchor re-prices plain t2v scenes on 2.0-fast; a long voiceover is flagged', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'story-init-'));
  try {
    fs.mkdirSync(path.join(repo, 'images'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'images', 'key.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const fixture = JSON.stringify({
      styleLine: 'Style: warm film.',
      scenes: [
        { what: 'a', prompt: 'a lighthouse on a cliff at dusk, wide shot', mechanism: 't2v', durationS: 6, audioDirection: 'surf' },
        { what: 'b', prompt: 'the keeper climbs the spiral stairs inside', mechanism: 'frame-chain', durationS: 6, audioDirection: 'steps' },
      ],
    });
    const base = await planAndInitStory('a lighthouse story', { repoDir: repo, llm: async () => fixture });
    const anchored = await planAndInitStory('a lighthouse story', { repoDir: repo, styleAnchor: 'images/key.jpg', llm: async () => fixture });
    const missing = await planAndInitStory('a lighthouse story', { repoDir: repo, styleAnchor: 'images/nope.jpg', llm: async () => fixture });
    assert.equal(anchored.plan.estUsd, estimateStory(anchored.plan.scenes, { styleAnchor: true }).estUsd);
    assert.ok(anchored.plan.estUsd > base.plan.estUsd, 'the anchored t2v scene is quoted at the 2.0-fast rate');
    assert.equal(missing.plan.estUsd, base.plan.estUsd, 'an anchor that does not resolve changes nothing (same gate as the executor)');
    // A voiceover far longer than the story can carry is flagged up front.
    const words = Array.from({ length: Math.ceil(NARRATION_MAX_WORDS_PER_S * 12) + 10 }, () => 'word').join(' ') + '.';
    const long = await planAndInitStory('a lighthouse story', { repoDir: repo, dialogue: words, llm: async () => fixture });
    assert.ok(long.plan.notes.some((n) => /voiceover .* is long/.test(n)));
    assert.ok(!base.plan.notes.some((n) => /voiceover/.test(n)));
    // Globally fine, but one long sentence lands in a short scene → that scene is named.
    const shortLong = JSON.stringify({
      styleLine: 'Style: warm film.',
      scenes: [
        { what: 'a', prompt: 'a lighthouse on a cliff at dusk, wide shot', mechanism: 't2v', durationS: 4, audioDirection: 'surf' },
        { what: 'b', prompt: 'the keeper climbs the spiral stairs inside', mechanism: 'frame-chain', durationS: 4, audioDirection: 'steps' },
      ],
    });
    const crammed = 'The keeper has climbed these stairs every single night for forty long years without fail. Light.';
    assert.ok(crammed.split(/\s+/).length <= NARRATION_MAX_WORDS_PER_S * 8, 'precondition: the global guard passes');
    const packed = await planAndInitStory('a lighthouse story', { repoDir: repo, dialogue: crammed, llm: async () => shortLong });
    assert.ok(!packed.plan.notes.some((n) => /voiceover .* is long/.test(n)), 'the global guard stays quiet');
    const note = packed.plan.notes.find((n) => /over-packed/.test(n));
    assert.ok(note, 'the per-scene guard fires');
    assert.match(note!, /scene 1 \(~15 words in 4s/);
    assert.doesNotMatch(note!, /scene 2/);
    assert.match(note!, /shorter sentences or lengthen that scene/);
    assert.ok(!base.plan.notes.some((n) => /over-packed/.test(n)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
