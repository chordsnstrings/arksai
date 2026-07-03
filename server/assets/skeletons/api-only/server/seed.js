// Idempotent seed: creates the first API key ONCE and prints it (the only time it's shown).
import { nanoid } from 'nanoid';
import { db, initSchema } from './db.js';

initSchema();
if (!db.prepare('SELECT 1 FROM api_keys LIMIT 1').get()) {
  const key = 'ak_' + nanoid(32);
  db.prepare('INSERT INTO api_keys (id, name, key, revoked, created_at) VALUES (?, ?, ?, 0, ?)')
    .run('k_' + nanoid(12), 'default', key, Date.now());
  console.log('Created the first API key (store it now — it is not shown again):');
  console.log('  ' + key);
} else {
  console.log('Seed: api_keys already present — nothing to do.');
}
