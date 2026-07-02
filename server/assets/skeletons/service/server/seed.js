// Idempotent seed: runs every file in server/seed/*.js (sorted) — each seeds ONLY when its
// data is absent, so re-running (or a republish) never wipes or duplicates anything.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initSchema } from './db.js';

initSchema();
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed');
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
  const mod = await import('./seed/' + f);
  await mod.seed?.();
  console.log('seeded:', f);
}
