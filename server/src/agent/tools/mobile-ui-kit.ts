import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const MOBILE_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'mobile-ui-kit');

function copyDirInto(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, f));
  }
}

/**
 * Install the ArksAI MOBILE UI kit (React Native / Expo) into an app workspace so every
 * generated Android app starts from a minimal, modern, typography-first foundation with
 * crash safety built in — the agent composes screens from it instead of hand-rolling
 * default-looking RN. The mobile counterpart of add_ui_kit.
 */
export const addMobileUiKitTool: ToolDef = {
  name: 'add_mobile_ui_kit',
  description:
    'Install the ArksAI MOBILE UI kit (React Native / Expo) into an app: design tokens (light+dark + ' +
    'brandTheme(accent), 8pt spacing, modular type scale, radius/shadow/motion), core components ' +
    '(ThemeProvider, Screen [safe-area], AppText, Button, Card, Field, EmptyState, Loading) and ' +
    'AppErrorBoundary (root-level crash safety). ALWAYS use this for an Android/Expo app, then compose ' +
    'screens from the kit — never raw default RN. Pairs with a clean, typed Fastify backend.',
  parameters: {
    type: 'object',
    properties: {
      dest: { type: 'string', description: 'Workspace subfolder to install into (default "src/ui").' },
    },
  },
  modes: ['code'],
  summarize: () => 'install mobile UI kit',
  async run(args, ctx) {
    if (!fs.existsSync(MOBILE_KIT_DIR)) return 'Error: the bundled mobile UI kit is missing from this build.';
    const destRel = String(args.dest ?? 'src/ui').replace(/[^a-zA-Z0-9._/-]/g, '-') || 'src/ui';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      copyDirInto(MOBILE_KIT_DIR, destAbs);
    } catch (e: any) {
      return `Error: could not install the mobile UI kit — ${e?.message ?? e}`;
    }
    return (
      `Installed the mobile UI kit into ${destRel}/ (tokens.ts, components.tsx, ErrorBoundary.tsx, README.md).\n` +
      `WIRE THE ROOT (App entry):\n` +
      `  import { AppErrorBoundary } from './${destRel}/ErrorBoundary';\n` +
      `  import { ThemeProvider } from './${destRel}/components';\n` +
      `  import { brandTheme } from './${destRel}/tokens';\n` +
      `  // <AppErrorBoundary><ThemeProvider theme={brandTheme('#<accent>')}>…app…</ThemeProvider></AppErrorBoundary>\n` +
      `BUILD SCREENS from the kit — Screen (safe-area scaffold) + AppText (variant: display/title/heading/body/` +
      `label/caption) + Button (primary/ghost, has pressed/disabled/loading) + Card + Field + EmptyState + Loading. ` +
      `Never raw <View>/<Text> styled ad-hoc.\n` +
      `RULES: accent used sparingly (~5–10%); every list/data view ships loading + empty + error states; respect ` +
      `the safe area + the 8pt grid; legible body/secondary text; tasteful motion only. ` +
      `Needs react-native-safe-area-context (Expo includes it). See ${destRel}/README.md for the full quality bar.`
    );
  },
};
