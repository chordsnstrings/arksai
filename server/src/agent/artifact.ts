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
    ${paletteTokens(opts.palette)}
    /* BESPOKE TINTED NEUTRALS — derived from the accent so bg/surface/ink/hairlines all share ONE
       undertone (warm accent → warm ivory, cool accent → cool slate). Dead grey-on-grey is what
       reads "cheap"; a faintly-tinted neutral ramp is the single biggest polish tell. Tints are
       small (felt, not seen) and keep AA (the dark side stays ~87% ink, the light side ~96% paper). */
    --bg:color-mix(in srgb, var(--accent) 4%, #fbfbf8);
    --surface:color-mix(in srgb, var(--accent) 2%, #ffffff);
    --surface-2:color-mix(in srgb, var(--accent) 5.5%, #f3f3f0);
    --elevated:color-mix(in srgb, var(--accent) 2%, #ffffff);
    --ink:color-mix(in srgb, var(--accent) 12%, #15161b);
    --ink-soft:color-mix(in srgb, var(--accent) 12%, #3b3e45);
    --muted:color-mix(in srgb, var(--accent) 11%, #5d636f);
    --line:color-mix(in srgb, var(--accent) 9%, #e8e7e2);
    --line-strong:color-mix(in srgb, var(--accent) 11%, #d8d6d0);
    /* RADIUS + ELEVATION SCALES — the right value per role, not one flat token. Shadows are soft,
       large-blur, low-opacity AND accent-tinted (lifted paper, not a 2010 drop shadow). */
    --r-sm:8px; --r-md:12px; --r-lg:16px; --r-xl:22px; --radius:12px; --radius-sm:8px;
    --shadow-xs:0 1px 1.5px color-mix(in srgb, var(--accent) 13%, rgba(18,19,24,.05));
    --shadow-sm:0 1px 2px rgba(18,19,24,.04), 0 3px 9px color-mix(in srgb, var(--accent) 12%, rgba(18,19,24,.05));
    --shadow-md:0 2px 4px rgba(18,19,24,.04), 0 10px 26px color-mix(in srgb, var(--accent) 15%, rgba(18,19,24,.07));
    --shadow-lg:0 4px 10px rgba(18,19,24,.05), 0 22px 54px color-mix(in srgb, var(--accent) 18%, rgba(18,19,24,.10));
    --shadow:var(--shadow-md);
    /* OPTICAL TYPE SCALE + tracking — refined metrics so text reads designed at every size. */
    --text-xs:.75rem; --text-sm:.875rem; --text-base:1rem; --text-lg:1.125rem; --text-xl:1.375rem;
    --text-2xl:1.75rem; --text-3xl:2.25rem; --text-4xl:3rem; --text-5xl:4rem;
    --tracking-tight:-0.021em; --tracking-snug:-0.012em; --tracking-normal:0; --tracking-wide:.04em; --tracking-caps:.085em;
    --measure:68ch;
    --font-sans:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
    --font-display:'Space Grotesk','Inter',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
    --font-serif:'Source Serif 4',Georgia,'Times New Roman',serif;
    --font-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,'Cascadia Mono',monospace;
  }
  /* Dark theme — a coherent, ACCENT-TINTED dark surface set with LIGHT ink (deep navy-charcoal for
     a cobalt brand, warm graphite for amber, etc. — not flat #111). Applied by theme:'dark' or the
     runtime contrast guard. Ink/muted/surface/line all flip so text stays legible on the surface. */
  html.artifact-dark{ color-scheme: dark;
    --bg:color-mix(in srgb, var(--accent) 8%, #0e1014);
    --surface:color-mix(in srgb, var(--accent) 10%, #15191f);
    --surface-2:color-mix(in srgb, var(--accent) 12%, #1d222a);
    --elevated:color-mix(in srgb, var(--accent) 10%, #1a1f26);
    --ink:color-mix(in srgb, var(--accent) 5%, #f3f5f8);
    --ink-soft:color-mix(in srgb, var(--accent) 7%, #cbd1da);
    --muted:color-mix(in srgb, var(--accent) 10%, #97a0ac);
    --line:color-mix(in srgb, var(--accent) 16%, #272c34);
    --line-strong:color-mix(in srgb, var(--accent) 18%, #39404a);
    --accent-tint:color-mix(in srgb, var(--accent) 26%, #14181e);
    /* On dark, the EMPHASIS ramp (used as foreground text/icons, e.g. on an accent-tint chip)
       must read BRIGHT, not the light-mode dark shade — otherwise it's accent-on-dark = invisible.
       The solid fill --accent + its --accent-ink are left untouched so accent buttons keep working. */
    --accent-deep:color-mix(in srgb, var(--accent) 58%, #ffffff);
    --accent-2:color-mix(in srgb, var(--accent) 40%, #ffffff);
    --shadow-sm:0 1px 2px rgba(0,0,0,.4), 0 3px 10px rgba(0,0,0,.4);
    --shadow-md:0 2px 6px rgba(0,0,0,.45), 0 12px 32px rgba(0,0,0,.5);
    --shadow-lg:0 6px 16px rgba(0,0,0,.5), 0 26px 60px rgba(0,0,0,.6);
  }
  html.artifact-dark a{ color:color-mix(in srgb, var(--accent) 60%, #ffffff); }
  *{box-sizing:border-box} html,body{margin:0} html{-webkit-text-size-adjust:100%}
  body{background:var(--bg);color:var(--ink);font-family:var(--font-sans);line-height:1.55;
       font-feature-settings:'kern' 1,'liga' 1,'calt' 1;-webkit-font-smoothing:antialiased;
       -moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
  #root{min-height:100vh}
  /* OPTICAL TYPE DEFAULTS — display face + per-size tracking + tuned line-height, so headings and
     figures read intentional even when the component sets no type of its own. */
  h1,h2,h3,h4{font-family:var(--font-display);color:var(--ink);margin:0 0 .5em;text-wrap:balance}
  h1{font-size:clamp(1.95rem,1.4rem+1.9vw,2.6rem);font-weight:700;letter-spacing:var(--tracking-tight);line-height:1.07}
  h2{font-size:var(--text-2xl);font-weight:700;letter-spacing:-0.016em;line-height:1.15}
  h3{font-size:var(--text-xl);font-weight:600;letter-spacing:var(--tracking-snug);line-height:1.22}
  h4{font-size:var(--text-lg);font-weight:600;letter-spacing:-0.006em;line-height:1.3}
  p{margin:0 0 1em} small{font-size:var(--text-sm)}
  a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:2px}
  ::selection{background:color-mix(in srgb, var(--accent) 22%, transparent)}
  /* Refined, 0-SPECIFICITY defaults (:where) — smooth transitions, a tasteful focus ring, and a
     crafted look for an UNSTYLED control. Any inline style or class the component sets always wins. */
  :where(button,a,input,select,textarea,summary,[role=button],[tabindex]):focus-visible{outline:2px solid color-mix(in srgb, var(--accent) 52%, transparent);outline-offset:2px;border-radius:var(--r-sm)}
  :where(button,a,input,select,[role=button]){transition:background-color .18s ease,color .18s ease,border-color .18s ease,box-shadow .2s ease,transform .18s ease}
  :where(button){font:inherit;font-weight:600;letter-spacing:-0.003em;color:var(--ink);background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);padding:.55rem .95rem;cursor:pointer}
  :where(button):hover{border-color:color-mix(in srgb, var(--accent) 32%, var(--line-strong));box-shadow:var(--shadow-sm)}
  :where(input,select,textarea){font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);padding:.5rem .7rem}
  :where(input,select,textarea):focus-visible{border-color:color-mix(in srgb, var(--accent) 45%, var(--line-strong))}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
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
