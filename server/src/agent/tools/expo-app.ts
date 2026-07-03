import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const TEMPLATE_DIR = path.join(repoRoot, 'server', 'assets', 'expo-app-template');
const MOBILE_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'mobile-ui-kit');
const EXPO_MODULES_DIR = path.join(repoRoot, 'server', 'assets', 'expo-modules');

interface ExpoModuleMeta {
  name: string;
  label: string;
  deps: string[];
  extraDeps?: Record<string, string>;
  remove?: string[];
  note?: string;
}

export function listExpoModules(): string[] {
  try {
    return fs.readdirSync(EXPO_MODULES_DIR).filter((d) => fs.existsSync(path.join(EXPO_MODULES_DIR, d, 'module.json')));
  } catch {
    return [];
  }
}
export function readExpoModule(name: string): ExpoModuleMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(EXPO_MODULES_DIR, name, 'module.json'), 'utf8'));
  } catch {
    return null;
  }
}
/** Requested modules + declared deps → deduped install order (pure). */
export function resolveExpoModules(requested: string[]): { order: string[]; unknown: string[] } {
  const unknown: string[] = [];
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const meta = readExpoModule(name);
    if (!meta) { unknown.push(name); return; }
    for (const d of meta.deps || []) visit(d);
    order.push(name);
  };
  for (const m of requested) visit(String(m).trim());
  return { order, unknown };
}

function copyTree(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'arksai-app'
  );
}

function patch(file: string, edits: Array<[string | RegExp, string]>) {
  if (!fs.existsSync(file)) return;
  let s = fs.readFileSync(file, 'utf8');
  for (const [find, repl] of edits) s = s.replace(find, repl);
  fs.writeFileSync(file, s);
}

/**
 * Scaffold a complete, runnable Expo / React Native app — already wired for crash safety
 * (AppErrorBoundary) + the ArksAI mobile design system (ThemeProvider + the UI kit) +
 * expo-router file-based routing + a sample home screen. Drops the mobile UI kit into
 * src/ui/ too, so the app is composable from the kit immediately. The mobile counterpart
 * of starting a web build.
 */
export const createExpoAppTool: ToolDef = {
  name: 'create_expo_app',
  description:
    'Scaffold a complete, runnable Expo (React Native) app: package.json (expo ~52, expo-router, ' +
    'safe-area), app.json (scheme, Android package, web single-page output for the Canvas preview), ' +
    'tsconfig/babel, app/_layout.tsx (AppErrorBoundary → SafeAreaProvider → ThemeProvider → Stack) and ' +
    'a sample app/index.tsx home screen composed from the kit — AND drops the mobile UI kit into src/ui/. ' +
    'ALWAYS start an Android/mobile app with this (never hand-roll an Expo project). Then add screens as ' +
    'files in app/ (expo-router) composed from the kit, run `npm run web` for the in-Canvas preview, add ' +
    'a backend with add_app_backend when accounts/data are needed, and build the APK on request.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'App display name (e.g. "Snap QR", "Sparkmatch").' },
      accent: { type: 'string', description: 'Brand accent hex (e.g. "#e23744"). Used sparingly (~5–10%).' },
      modules: {
        type: 'array', items: { type: 'string' },
        description: 'Capability modules (deps auto-added): tabs (bottom tab bar — the structure for ANY multi-surface app), auth (typed API client + provider + sign-in screen wired to the add_app_backend contract), crud (exemplar entity: local SQLite list/detail/edit to CLONE per real entity), scanner (camera + QR/barcode with the full permission flow). NEVER hand-roll these.',
      },
      dest: { type: 'string', description: 'Workspace subfolder to scaffold into (default the workspace root ".").' },
    },
  },
  modes: ['code'],
  summarize: (a) => `scaffold Expo app${a?.name ? ` "${a.name}"` : ''}`,
  async run(args, ctx) {
    if (!fs.existsSync(TEMPLATE_DIR)) return 'Error: the bundled Expo app template is missing from this build.';
    const destRel = String(args.dest ?? '.').replace(/[^a-zA-Z0-9._/-]/g, '-') || '.';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    const { order, unknown } = resolveExpoModules(Array.isArray(args.modules) ? args.modules.map(String) : []);
    if (unknown.length) {
      return `Error: unknown module(s): ${unknown.join(', ')}. Available: ${listExpoModules().join(', ')}. Fix the list and call again.`;
    }
    const mods = order.map((n) => readExpoModule(n)!).filter(Boolean) as ExpoModuleMeta[];
    try {
      copyTree(TEMPLATE_DIR, destAbs);
      copyTree(MOBILE_KIT_DIR, path.join(destAbs, 'src', 'ui'));
      // Module overlays: removals first (e.g. tabs replaces the root index screen), then files,
      // then their pinned native deps merged into package.json (SDK-52-matched versions).
      for (const m of mods) {
        for (const rel of m.remove || []) fs.rmSync(path.join(destAbs, rel), { force: true });
        copyTree(path.join(EXPO_MODULES_DIR, m.name, 'files'), destAbs);
      }
      if (mods.some((m) => m.extraDeps && Object.keys(m.extraDeps).length)) {
        const pkgPath = path.join(destAbs, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        for (const m of mods) Object.assign(pkg.dependencies, m.extraDeps || {});
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      }
    } catch (e: any) {
      return `Error: could not scaffold the Expo app — ${e?.message ?? e}`;
    }

    // Personalize: app name + slug + Android package + accent.
    const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : '';
    const accent = typeof args.accent === 'string' && /^#?[0-9a-fA-F]{6}$/.test(args.accent.trim())
      ? (args.accent.trim().startsWith('#') ? args.accent.trim() : `#${args.accent.trim()}`)
      : '';
    if (name) {
      const slug = slugify(name);
      const pkg = `studio.arksai.${slug.replace(/-/g, '')}`.slice(0, 60);
      patch(path.join(destAbs, 'app.json'), [
        ['"ArksAI App"', `"${name.replace(/"/g, '')}"`],
        ['"arksai-app"', `"${slug}"`],
        ['"studio.arksai.app"', `"${pkg}"`],
      ]);
      patch(path.join(destAbs, 'package.json'), [['"arksai-app"', `"${slug}"`]]);
    }
    if (accent) patch(path.join(destAbs, 'app', '_layout.tsx'), [["brandTheme('#3a5a78')", `brandTheme('${accent}')`]]);

    // The binding contract + verify manifest — same doctrine as the web scaffold: the
    // skeleton declares its conventions and how it is checked; every later step obeys them.
    const arks = path.join(destAbs, '.arksai');
    fs.mkdirSync(arks, { recursive: true });
    fs.writeFileSync(
      path.join(arks, 'verify.json'),
      JSON.stringify(
        {
          kind: 'expo',
          checks: ['tsc', 'expo-export'],
          modules: mods.map((m) => m.name),
          note: 'Before any APK build: `npx tsc --noEmit` must pass and `npx expo export --platform android` must bundle cleanly (build_apk runs both and refuses droplet spend on failure).',
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(arks, 'CONTRACT.md'),
      `# BUILD CONTRACT — ${name || 'Expo app'} (mobile; BINDING for every later step/session)\n\n` +
        `- COMPOSE from the kit (src/ui): Screen/AppText/Button/Card/Field/ListRow/Header/SearchBar/Chip/SettingRow/SectionHeader/Divider/Avatar/Banner/FAB/ProgressBar/Sheet/EmptyState/Loading + ToastHost/useToast — NEVER raw default RN styling. One accent, 8pt grid, light+dark from the theme.\n` +
        `- SCREENS are files in app/ (expo-router). Tabs live in app/(tabs)/ — add a tab = a file + one Tabs.Screen entry. Every data view ships loading + empty + error states.\n` +
        `- ENTITIES: clone the crud exemplar (src/lib/db.ts + app/(tabs)/items.tsx + app/item/[id].tsx) and RENAME per real entity — a generic "Items" tab is demo-grade, never delivered.\n` +
        `- BACKEND (when accounts/synced data): add_app_backend + the auth module's src/lib/api.ts — set API_BASE to the PUBLISHED backend URL; flat camelCase JSON; { error } envelope.\n` +
        `- PRE-APK GATE: npx tsc --noEmit + npx expo export --platform android must pass BEFORE build_apk (it enforces this — a broken bundle never reaches the build droplet).\n` +
        `${mods.length ? `- MODULES INSTALLED: ${mods.map((m) => m.name).join(', ')}.\n` : ''}`,
    );

    const at = destRel === '.' ? 'the workspace root' : `${destRel}/`;
    return (
      `Scaffolded a runnable Expo app at ${at}: app/_layout.tsx (crash-safe root: AppErrorBoundary → ` +
      `SafeAreaProvider → ThemeProvider${accent ? ` accent ${accent}` : ''} → Stack), app/index.tsx (sample ` +
      `home), src/ui/ (the mobile UI kit, 23 components)${mods.length ? `, modules: ${mods.map((m) => m.name).join(', ')}` : ''}, app.json${name ? ` (name "${name}")` : ''}, package.json, tsconfig, babel. BINDING conventions in .arksai/CONTRACT.md.\n` +
      `NEXT: npm install, then \`npm run web\` for the in-Canvas preview (web.output is single-page). ` +
      `ADD SCREENS as files in app/ (expo-router: app/profile.tsx → /profile; <Link href> / router.push to navigate; ` +
      `group tabs with app/(tabs)/_layout.tsx) — compose every screen from the kit (Screen/AppText/Button/Card/Field/` +
      `EmptyState/Loading), never raw default RN. WIRE device features with Expo modules (expo-camera for QR/photo, ` +
      `expo-location, expo-notifications, etc.) and add them to package.json. If the app needs accounts/data, run ` +
      `add_app_backend, publish it, and call it from a typed client with the JWT. Build the APK on request (our ` +
      `infra: expo prebuild + Gradle; never EAS for Android).`
    );
  },
};
