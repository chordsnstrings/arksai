import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExpoAppTool, listExpoModules, resolveExpoModules } from '../src/agent/tools/expo-app';
import { auditProductionSeams } from '../src/agent/webHygiene';

const ctx = (dir: string) => ({ repoDir: dir, addCost: () => {}, signal: new AbortController().signal, session: { id: 't', title: 'T' } }) as any;

test('expo modules: library parses, deps resolve (crud pulls tabs)', () => {
  const mods = listExpoModules();
  assert.ok(mods.includes('tabs') && mods.includes('auth') && mods.includes('crud') && mods.includes('scanner'), mods.join(','));
  assert.deepEqual(resolveExpoModules(['crud']).order, ['tabs', 'crud']);
  assert.deepEqual(resolveExpoModules(['nope']).unknown, ['nope']);
});

test('create_expo_app: full composition — files, dep pins, removals, contract, manifest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-scaf-'));
  try {
    const out = await createExpoAppTool.run({ name: 'Snap QR', accent: '#e23744', modules: ['crud', 'auth', 'scanner'] }, ctx(dir));
    assert.match(String(out), /modules: tabs, crud, auth, scanner/);

    // tabs replaced the root index screen (no route clash with (tabs)/index).
    assert.ok(!fs.existsSync(path.join(dir, 'app', 'index.tsx')), 'root index must be removed by tabs');
    for (const f of [
      'app/(tabs)/_layout.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/settings.tsx', 'app/(tabs)/items.tsx',
      'app/item/[id].tsx', 'app/sign-in.tsx', 'app/scan.tsx',
      'src/lib/db.ts', 'src/lib/api.ts', 'src/lib/auth.tsx', 'src/ui/components.tsx',
    ]) assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);

    // Native deps merged with SDK-matched pins; package.json still valid JSON.
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies['expo-sqlite'] && pkg.dependencies['expo-camera'] && pkg.dependencies['@react-native-async-storage/async-storage']);

    // Contract + manifest declare the pre-APK gate.
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.arksai', 'verify.json'), 'utf8'));
    assert.equal(manifest.kind, 'expo');
    assert.deepEqual(manifest.checks, ['tsc', 'expo-export']);
    assert.match(fs.readFileSync(path.join(dir, '.arksai', 'CONTRACT.md'), 'utf8'), /PRE-APK GATE/);

    // Accent applied; kit's premium layer present.
    assert.match(fs.readFileSync(path.join(dir, 'app', '_layout.tsx'), 'utf8'), /#e23744/);
    const kit = fs.readFileSync(path.join(dir, 'src', 'ui', 'components.tsx'), 'utf8');
    for (const c of ['ListRow', 'SearchBar', 'SettingRow', 'FAB', 'Sheet', 'ToastHost']) assert.match(kit, new RegExp(`export function ${c}|export const ${c}`));

    // The untouched scaffold home tab is a demo-grade seam — the gate flags it until the
    // real home is built (same doctrine as the web scaffold).
    const seams = auditProductionSeams(dir);
    assert.ok(seams.some((d) => /scaffold home-page placeholder/.test(d)), seams.join(' | '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
