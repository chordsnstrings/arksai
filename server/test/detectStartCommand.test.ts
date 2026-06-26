import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectStartCommand, needsExternalDb } from '../src/agent/verify';

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-start-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test('detectStartCommand: a LIBRARY (index.js that only exports) is NOT bootable', () => {
  // The p-limit case: an index.js that exports a function must NOT trigger the runtime boot gate.
  const dir = tmp({
    'package.json': JSON.stringify({ name: 'p-limit', main: 'index.js', scripts: { test: 'ava' } }),
    'index.js': 'export default function pLimit(concurrency) { return () => {}; }',
  });
  assert.equal(detectStartCommand(dir), null);
});

test('detectStartCommand: a real server (index.js that listens) IS bootable', () => {
  const dir = tmp({
    'package.json': JSON.stringify({ name: 'app', main: 'index.js' }),
    'index.js': 'const http = require("http"); http.createServer((q,s)=>s.end("hi")).listen(process.env.PORT||4000);',
  });
  assert.equal(detectStartCommand(dir), 'node index.js');
});

test('detectStartCommand: an explicit start script is always trusted', () => {
  const dir = tmp({ 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }) });
  assert.equal(detectStartCommand(dir), 'npm start');
});

test('detectStartCommand: a Flask app.py IS bootable, a plain script is not', () => {
  const server = tmp({ 'app.py': 'from flask import Flask\napp = Flask(__name__)\napp.run()' });
  assert.equal(detectStartCommand(server), 'python3 app.py');
  const lib = tmp({ 'app.py': 'def add(a, b):\n    return a + b' });
  assert.equal(detectStartCommand(lib), null);
});

test('detectStartCommand: a STATIC client app.js with app.run()/.listen() is NOT a server (the publish regression)', () => {
  // app.run() is a super-common client-side method name, and history.listen()/store.listen() are
  // standard client idioms — none of these must make a static site get booted as a Node server.
  const clientRun = tmp({ 'package.json': '{}', 'app.js': 'const app = { run(){ document.body.innerHTML = "hi"; } }; app.run();' });
  assert.equal(detectStartCommand(clientRun), null);
  const clientListen = tmp({ 'package.json': '{}', 'index.js': 'history.listen(loc => render(loc)); store.listen(update);' });
  assert.equal(detectStartCommand(clientListen), null);
});

test('needsExternalDb: a Prisma/Postgres app is flagged, a plain app is not', () => {
  const dbApp = tmp({ 'package.json': JSON.stringify({ dependencies: { next: '^14', '@prisma/client': '^5' }, scripts: { start: 'next start' } }) });
  assert.equal(needsExternalDb(dbApp), true);
  const plain = tmp({ 'package.json': JSON.stringify({ dependencies: { express: '^4' }, scripts: { start: 'node server.js' } }) });
  assert.equal(needsExternalDb(plain), false);
});
