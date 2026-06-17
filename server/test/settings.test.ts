import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB, set BEFORE any config read / dynamic import. Runs the REAL upsert
// SQL against SQLite so it catches portability bugs the pure tests can't (the settings
// upsert uses excluded.value precisely because reusing $N under-supplies params on SQLite).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-set-'));
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let orgs: typeof import('../src/orgs/store');

before(async () => {
  db = await import('../src/db');
  orgs = await import('../src/orgs/store');
  await db.initDb();
});

test('settings KV: get is null when unset, set then get round-trips, and updates in place', async () => {
  assert.equal(await db.getSetting('operator.display_name'), null);
  await db.setSetting('operator.display_name', 'Kamran');
  assert.equal(await db.getSetting('operator.display_name'), 'Kamran');
  // upsert (ON CONFLICT … excluded.value) overwrites, doesn't insert a second row
  await db.setSetting('operator.display_name', 'Sam');
  assert.equal(await db.getSetting('operator.display_name'), 'Sam');
  const rows = await db.q('SELECT COUNT(*) AS n FROM app_settings WHERE key = $1', ['operator.display_name']);
  assert.equal(Number(rows[0].n), 1);
});

test('updateUserName changes a user row and clears to null', async () => {
  const u = await orgs.createUser({ email: 'm@example.com', name: 'Original' });
  await orgs.updateUserName(u.id, 'Renamed');
  assert.equal((await orgs.getUser(u.id))?.name, 'Renamed');
  await orgs.updateUserName(u.id, null);
  assert.equal((await orgs.getUser(u.id))?.name, null);
});
