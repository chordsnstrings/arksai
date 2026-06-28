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
  assert.match(html, /color-scheme: light/); // pinned — no half-baked dark flip
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
