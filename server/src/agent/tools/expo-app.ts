import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const TEMPLATE_DIR = path.join(repoRoot, 'server', 'assets', 'expo-app-template');
const MOBILE_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'mobile-ui-kit');

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
    try {
      copyTree(TEMPLATE_DIR, destAbs);
      copyTree(MOBILE_KIT_DIR, path.join(destAbs, 'src', 'ui'));
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

    const at = destRel === '.' ? 'the workspace root' : `${destRel}/`;
    return (
      `Scaffolded a runnable Expo app at ${at}: app/_layout.tsx (crash-safe root: AppErrorBoundary → ` +
      `SafeAreaProvider → ThemeProvider${accent ? ` accent ${accent}` : ''} → Stack), app/index.tsx (sample ` +
      `home), src/ui/ (the mobile UI kit), app.json${name ? ` (name "${name}")` : ''}, package.json, tsconfig, babel.\n` +
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
