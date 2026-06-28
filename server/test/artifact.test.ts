import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileComponent, buildArtifactHtml } from '../src/agent/artifact';

test('compileComponent: transforms JSX/TSX, strips export/types, rejects imports', async () => {
  const js = await compileComponent(
    `export default function App(){ const [n,setN]=useState<number>(0); return <button onClick={()=>setN(n+1)}>Count {n}</button>; }`,
  );
  assert.match(js, /React\.createElement/);
  assert.doesNotMatch(js, /export\s+default/);
  assert.doesNotMatch(js, /:\s*number/); // TS types stripped
  await assert.rejects(
    () => compileComponent(`import x from 'foo'; function App(){return <div/>;}`),
    /can not use .import./i,
  );
});

test('buildArtifactHtml: self-contained (inline React, no CDN), palette tokens baked in', async () => {
  const js = await compileComponent(`function App(){ return <h1 className="t">Hello</h1>; }`);
  const html = buildArtifactHtml(js, { title: 'Demo', palette: 'cobalt' });
  // self-contained: the React runtime is inlined, nothing fetched from a CDN
  assert.match(html, /react\.production|React/);
  assert.doesNotMatch(html, /https?:\/\/[^"']*(unpkg|jsdelivr|cdn|esm\.sh)/i);
  assert.match(html, /id="root"/);
  assert.match(html, /ReactDOM\.createRoot/);
  // the chosen palette's accent is present
  assert.match(html, /--accent:#2456c8/);
  assert.match(html, /color-scheme: light/); // light is the default base
  // fonts are EMBEDDED (base64 woff2 @font-face) so the artifact is elegant + uniform on every
  // device — not falling back to a different system font each time
  assert.match(html, /@font-face\{font-family:'Inter'/);
  assert.match(html, /src:url\(data:font\/woff2;base64,/);
  assert.match(html, /@font-face\{font-family:'Space Grotesk'/);
  // the display + mono tokens exist so headings/figures read intentional
  assert.match(html, /--font-display:'Space Grotesk'/);
  assert.match(html, /--font-mono:'IBM Plex Mono'/);
  // the runtime contrast guard ships so dark-on-dark can never render
  assert.match(html, /artifact-dark/);
  assert.match(html, /elementFromPoint/);
});

test('buildArtifactHtml: theme:dark flips to a dark surface with LIGHT ink (contrast-safe)', async () => {
  const js = await compileComponent(`function App(){ return <h1>Night</h1>; }`);
  const html = buildArtifactHtml(js, { title: 'Dark', theme: 'dark' });
  // the <html> opts into the dark token set at build time
  assert.match(html, /<html lang="en" class="artifact-dark"/);
  // the dark token block uses a dark bg and a LIGHT ink so text is legible
  assert.match(html, /html\.artifact-dark\{[^}]*--bg:#0f1216/);
  assert.match(html, /html\.artifact-dark\{[^}]*--ink:#f2f4f7/);
});

test('buildArtifactHtml: light is the default (no dark class) but the guard is always present', async () => {
  const js = await compileComponent(`function App(){ return <h1>Day</h1>; }`);
  const html = buildArtifactHtml(js, { title: 'Light' });
  assert.doesNotMatch(html, /<html lang="en" class="artifact-dark"/);
  assert.match(html, /classList\.toggle\('artifact-dark'/); // guard can still flip it at runtime
});

test('createArtifact tool: writes a runnable html and rejects a broken component', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createArtifactTool } = await import('../src/agent/tools/artifact');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-art-'));
  const ctx: any = { repoDir: d, mode: 'code', signal: new AbortController().signal, addCost: () => {}, session: {} };
  const ok = await createArtifactTool.run({ component: `function App(){ return <div>hi</div>; }`, title: 'T', palette: 'grape' }, ctx);
  assert.match(ok, /Created index\.html/);
  const html = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
  assert.match(html, /id="root"/);
  const bad = await createArtifactTool.run({ component: `function App(){ return <div> }` }, ctx); // unbalanced JSX
  assert.match(bad, /didn't compile/i);
});
