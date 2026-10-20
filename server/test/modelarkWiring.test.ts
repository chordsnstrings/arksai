import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setByteplusKeyForTest, byteplusKey } from '../src/agent/byteplusRuntime';
import { listEngines } from '../src/engines/registry';
import { ttsAvailable } from '../src/engines/speech';
import { getToolsForMode, ALL_TOOLS } from '../src/agent/tools/index';
import { buildSystemPrompt } from '../src/agent/prompts';
import { listModels, isValidModel } from '../src/agent/models';
import { config } from '../src/config';
import { AUTO_MODEL, MAX_MODEL, FAST_MODEL, SWIFT_MODEL } from '../../shared/types';

// ModelArk is the ONLY model provider: the registry, toolsets, prompts and model lineup must be
// wired to it, gated on its key — and nothing may still name the retired provider.

const STALE = /MiniMax|\bM3\b|Hailuo/i;
const MODES = ['chat', 'plan', 'code', 'report'] as const;
const session = (mode: string) => ({ id: 's', mode, task: null, model: 'arksai-auto', orgId: null, projectId: null }) as any;

/** Run fn with the in-memory ModelArk key set to `key`, restoring the original afterwards. */
async function withKey<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = byteplusKey();
  __setByteplusKeyForTest(key);
  try {
    return await fn();
  } finally {
    __setByteplusKeyForTest(prev);
  }
}

// ---------------------------------------------------------------- engine registry

test('registry lists a modelark engine and no minimax engine', async () => {
  await withKey('ark-test', () => {
    const engines = listEngines();
    const ark = engines.find((e) => e.id === 'modelark');
    assert.ok(ark, 'modelark engine listed');
    assert.equal(ark!.provider, 'modelark');
    assert.equal(ark!.available, true);
    for (const e of engines) {
      assert.doesNotMatch(`${e.id} ${e.provider} ${e.label} ${e.capability}`, STALE, `stale engine entry ${e.id}`);
    }
  });
  await withKey('', () => {
    assert.equal(listEngines().find((e) => e.id === 'modelark')!.available, false);
  });
});

// ---------------------------------------------------------------- toolsets

test('ttsAvailable() is false — ModelArk has no speech model', () => {
  assert.equal(ttsAvailable(), false);
});

test('with the key: see_image / generate_image / generate_video are exposed; text_to_speech never is', async () => {
  await withKey('ark-test', () => {
    for (const mode of ['chat', 'code'] as const) {
      const names = getToolsForMode(mode).map;
      assert.ok(names.has('see_image'), `${mode}: see_image`);
      assert.ok(names.has('generate_image'), `${mode}: generate_image`);
      assert.ok(names.has('generate_video'), `${mode}: generate_video`);
    }
    for (const mode of MODES) {
      const names = getToolsForMode(mode).map;
      assert.ok(!names.has('text_to_speech'), `${mode}: text_to_speech hidden while ttsAvailable() is false`);
      assert.ok(!names.has('render_motion_video'), `${mode}: narrated motion video hidden without TTS`);
      assert.ok(!names.has('render_animated_explainer'), `${mode}: animated explainer hidden without TTS`);
    }
  });
});

test('text_to_speech is still DEFINED (wiring kept) but gated on ttsAvailable', () => {
  const tts = ALL_TOOLS.find((t) => t.name === 'text_to_speech');
  assert.ok(tts, 'text_to_speech tool definition kept for a future speech provider');
  assert.equal(tts!.available?.(), false);
});

test('without the key: vision + video tools drop out of every toolset', async () => {
  await withKey('', () => {
    for (const mode of MODES) {
      const names = getToolsForMode(mode).map;
      assert.ok(!names.has('see_image'), `${mode}: see_image needs the key`);
      assert.ok(!names.has('generate_video'), `${mode}: generate_video needs the key`);
      assert.ok(!names.has('text_to_speech'), `${mode}: text_to_speech`);
    }
  });
});

test('no tool description or schema names the retired provider', () => {
  for (const t of ALL_TOOLS) {
    assert.doesNotMatch(`${t.description} ${JSON.stringify(t.parameters)}`, STALE, `stale wording in ${t.name}`);
  }
});

// ---------------------------------------------------------------- system prompt steering

test('prompt capability steering: generate_video yes; TTS-only tools never while TTS is unavailable', async () => {
  await withKey('ark-test', () => {
    for (const mode of ['code', 'report'] as const) {
      const p = buildSystemPrompt(session(mode), '/tmp', '');
      assert.match(p, /generate_video/, `${mode}: video steering present`);
      assert.match(p, /see_image/, `${mode}: vision steering present`);
      // narration comes from Seedance native audio — there is no voiceover tool to steer to
      assert.match(p, /NO separate voiceover tool/, `${mode}: native-audio steer`);
      assert.match(p, /never promise a separate voice-over track/, `${mode}: no TTS voice-over promise`);
      // narration → generate_video_story's dialogue (voiced natively, scene by scene) or ONE clip's dialogue
      assert.match(p, /generate_video_story's dialogue field[^]*?scene by scene/, `${mode}: story narration via dialogue`);
      assert.match(p, /ONE clip put the spoken\s+line in generate_video's dialogue field/, `${mode}: one-clip dialogue`);
      assert.match(p, /"double quotes"/, `${mode}: spoken lines in quotes`);
    }
    for (const mode of MODES) {
      const p = buildSystemPrompt(session(mode), '/tmp', '');
      assert.doesNotMatch(p, /text_to_speech/, `${mode}: no text_to_speech steering`);
      assert.doesNotMatch(p, /render_motion_video/, `${mode}: no render_motion_video steering`);
      assert.doesNotMatch(p, /render_animated_explainer/, `${mode}: no render_animated_explainer steering`);
    }
  });
});

test('system prompt never names MiniMax / M3 / Hailuo (keyed or not, every mode)', async () => {
  for (const key of ['ark-test', '']) {
    await withKey(key, () => {
      for (const mode of MODES) {
        const p = buildSystemPrompt(session(mode), '/tmp', '');
        assert.doesNotMatch(p, STALE, `${mode} (key=${key ? 'on' : 'off'})`);
      }
    });
  }
});

test('without the key the ModelArk capability slice is not steered (no paid-generation lines)', async () => {
  await withKey('', () => {
    const p = buildSystemPrompt(session('code'), '/tmp', '');
    assert.doesNotMatch(p, /generate_video — ONE continuous video clip/);
  });
});

// ---------------------------------------------------------------- model lineup

test('listModels: [auto] without a key; [auto, max, flash] with one (Swift = same lane as Flash, not offered twice)', async () => {
  await withKey('', async () => {
    const ids = (await listModels()).map((m) => m.id);
    assert.deepEqual(ids, [AUTO_MODEL]);
  });
  await withKey('ark-test', async () => {
    const models = await listModels();
    assert.deepEqual(
      models.map((m) => m.id),
      [AUTO_MODEL, MAX_MODEL, FAST_MODEL],
    );
    // Swift stays a valid id (old rows / router) even though it isn't listed.
    assert.equal(await isValidModel(SWIFT_MODEL), true);
    for (const m of models) {
      assert.ok(m.label && m.label !== m.id, `${m.id} has a branded label`);
      assert.doesNotMatch(m.label, STALE);
    }
  });
});

test('isValidModel: every config.modelarkModels id with a key; only auto without one', async () => {
  const ids = Object.keys(config.modelarkModels);
  assert.ok(ids.includes(MAX_MODEL) && ids.includes(FAST_MODEL) && ids.includes(SWIFT_MODEL));
  await withKey('ark-test', async () => {
    for (const id of ids) assert.equal(await isValidModel(id), true, id);
    assert.equal(await isValidModel(AUTO_MODEL), true);
    assert.equal(await isValidModel('MiniMax-M3'), false);
    assert.equal(await isValidModel('nope'), false);
    assert.equal(await isValidModel(''), false);
  });
  await withKey('', async () => {
    assert.equal(await isValidModel(AUTO_MODEL), true);
    for (const id of ids) assert.equal(await isValidModel(id), false, `${id} needs the key`);
  });
});
