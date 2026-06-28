import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config';
import { PALETTES } from './palettes';

const RUNTIME_DIR = path.join(repoRoot, 'server', 'assets', 'artifact-runtime');
let _react = '';
let _reactDom = '';
let _guard = '';
function runtime(): { react: string; reactDom: string; guard: string } {
  if (!_react) _react = fs.readFileSync(path.join(RUNTIME_DIR, 'react.min.js'), 'utf8');
  if (!_reactDom) _reactDom = fs.readFileSync(path.join(RUNTIME_DIR, 'react-dom.min.js'), 'utf8');
  // The contrast guard lives in its OWN file (not inside the template literal below) so its regex
  // backslashes (\(, \), \b) survive verbatim — inlining JS-with-regex into a backtick string
  // strips them and silently corrupts the regex.
  if (!_guard) _guard = fs.readFileSync(path.join(RUNTIME_DIR, 'contrast-guard.js'), 'utf8');
  return { react: _react, reactDom: _reactDom, guard: _guard };
}

// Core self-hosted type set, EMBEDDED (base64) so an artifact is one elegant, uniform file —
// no CDN, no relative fonts.css to lose. A cohesive trio + a data face: Inter (body/UI/numbers),
// Space Grotesk (modern geometric display — headings + big numerals), Source Serif 4 (editorial
// serif option), IBM Plex Mono (tabular figures — timers, prices, stats). Without this the
// artifact referenced 'Inter'/'Source Serif 4' but loaded NOTHING, so every device fell back to a
// different system font (the "not elegant / not uniform" bug).
const FONT_DIR = path.join(repoRoot, 'server', 'assets', 'report-fonts');
const ARTIFACT_FONTS: { family: string; weight: number; file: string }[] = [
  { family: 'Inter', weight: 400, file: 'inter-400.woff2' },
  { family: 'Inter', weight: 500, file: 'inter-500.woff2' },
  { family: 'Inter', weight: 600, file: 'inter-600.woff2' },
  { family: 'Inter', weight: 700, file: 'inter-700.woff2' },
  { family: 'Source Serif 4', weight: 600, file: 'source-serif-600.woff2' },
  { family: 'Space Grotesk', weight: 500, file: 'space-grotesk-500.woff2' },
  { family: 'Space Grotesk', weight: 700, file: 'space-grotesk-700.woff2' },
  { family: 'IBM Plex Mono', weight: 500, file: 'ibmplexmono-500.woff2' },
];
let _fontCss = '';
function fontFaceCss(): string {
  if (_fontCss) return _fontCss;
  _fontCss = ARTIFACT_FONTS.map((f) => {
    const b64 = fs.readFileSync(path.join(FONT_DIR, f.file)).toString('base64');
    return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join('');
  return _fontCss;
}

/** Resolve a palette by name → its token block; default to a confident emerald if unknown. */
function paletteTokens(name?: string): string {
  const p = PALETTES.find((x) => x.name === (name || '').toLowerCase()) || PALETTES.find((x) => x.name === 'emerald')!;
  return `--accent:${p.accent};--accent-2:${p.accent2};--accent-deep:${p.accentDeep};--accent-tint:${p.accentTint};--accent-ink:${p.accentInk};`;
}

/**
 * Transform a self-contained React component (JSX/TSX, no imports) to plain JS that
 * references the React global. Throws a clean Error on a syntax problem so the tool can
 * hand the message back to the agent.
 */
export async function compileComponent(src: string): Promise<string> {
  // Strip module syntax — the component runs inline in a <script>, not a module. (Imports are
  // not supported: the runtime gives React + hooks as globals; everything else must be inline.)
  let code = src.replace(/^\s*export\s+default\s+/gm, '').replace(/^\s*export\s+/gm, '');
  if (/^\s*import\s.+from\s/m.test(code)) {
    throw new Error('Artifacts can not use `import`. Use the React global + provided hooks (useState, useEffect, …) and keep everything else inline (no npm imports).');
  }
  const esbuild: any = await import('esbuild');
  const out = esbuild.transformSync(code, {
    loader: 'tsx',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    target: 'es2018',
  });
  return out.code as string;
}

/**
 * Assemble a self-contained, single-file HTML artifact: the vendored React runtime (no CDN),
 * the design tokens + chosen palette, and the compiled component mounted to #root. It renders
 * instantly in a browser with NO build step — so the Canvas previews it in ~1s and it can be
 * published as-is (a static file).
 *
 * CONTRAST is guaranteed two ways: (1) `theme:'dark'` flips the whole token set to a coherent
 * dark surface + LIGHT ink (so a dark aesthetic is legible by construction); (2) an always-on
 * runtime guard measures the background actually painted behind the content and flips the ink
 * tokens light/dark to match — so even a component that hard-codes a dark background without
 * declaring the theme can never render dark-on-dark text (the bug this fixes).
 */
export function buildArtifactHtml(compiledJs: string, opts: { title: string; palette?: string; theme?: 'light' | 'dark' }): string {
  const { react, reactDom, guard } = runtime();
  const title = (opts.title || 'Artifact').replace(/[<>]/g, '');
  const htmlClass = opts.theme === 'dark' ? ' class="artifact-dark"' : '';
  return `<!doctype html>
<html lang="en"${htmlClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  ${fontFaceCss()}
  :root{ color-scheme: light;
    --bg:#fbfbfa; --surface:#ffffff; --surface-2:#f3f4f2; --elevated:#ffffff;
    --ink:#16181d; --ink-soft:#3a3d44; --muted:#5b616e; --line:#e8e8e4; --line-strong:#d8d8d2;
    ${paletteTokens(opts.palette)}
    --radius:12px; --radius-sm:8px;
    --font-sans:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
    --font-display:'Space Grotesk','Inter',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
    --font-serif:'Source Serif 4',Georgia,'Times New Roman',serif;
    --font-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,'Cascadia Mono',monospace;
    --shadow:0 1px 2px rgba(16,18,29,.05),0 8px 24px rgba(16,18,29,.06);
  }
  /* Dark theme — a coherent dark surface set with LIGHT ink. Applied either by theme:'dark'
     (build-time class on <html>) or by the runtime contrast guard when a dark background is
     detected. Ink/muted/surface/line all flip so text is always legible on the dark surface. */
  html.artifact-dark{ color-scheme: dark;
    --bg:#0f1216; --surface:#171b21; --surface-2:#1f242b; --elevated:#1c2128;
    --ink:#f2f4f7; --ink-soft:#cbd1da; --muted:#99a1ad; --line:#2a2f38; --line-strong:#3a414c;
    --accent-tint:color-mix(in srgb, var(--accent) 26%, #14181e);
    --shadow:0 1px 2px rgba(0,0,0,.45),0 10px 30px rgba(0,0,0,.55);
  }
  html.artifact-dark a{ color:color-mix(in srgb, var(--accent) 58%, #ffffff); }
  *{box-sizing:border-box} html,body{margin:0}
  body{background:var(--bg);color:var(--ink);font-family:var(--font-sans);line-height:1.55;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  /* Designed-by-default type: headings + big figures get the display face and tight tracking,
     so an artifact reads intentional even if the component sets no fonts of its own. */
  h1,h2,h3,h4{font-family:var(--font-display);font-weight:700;letter-spacing:-0.018em;line-height:1.12;margin:0 0 .4em}
  #root{min-height:100vh}
  a{color:var(--accent)} button,input,select,textarea{font-family:inherit;font-size:inherit}
  .artifact-error{margin:24px;padding:16px 18px;border:1px solid #f3c0bd;background:#fdecea;color:#9e2722;border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:pre-wrap}
</style>
</head>
<body>
<div id="root"></div>
<script>${react}</script>
<script>${reactDom}</script>
<script>${guard}</script>
<script>
(function(){
  var React=window.React, ReactDOM=window.ReactDOM;
  var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef,useMemo=React.useMemo,
      useCallback=React.useCallback,useReducer=React.useReducer,useContext=React.useContext,
      useLayoutEffect=React.useLayoutEffect,Fragment=React.Fragment;
  try{
${compiledJs}
    var Comp = (typeof App!=='undefined'&&App) || (typeof Component!=='undefined'&&Component) || null;
    if(!Comp) throw new Error('Define a component named App (or Component) that returns JSX.');
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Comp));
  }catch(e){
    document.getElementById('root').innerHTML='<div class="artifact-error">Artifact failed to run: '+((e&&e.message)?e.message:e)+'</div>';
    if(window.console)console.error(e);
  }
})();
</script>
</body>
</html>`;
}
