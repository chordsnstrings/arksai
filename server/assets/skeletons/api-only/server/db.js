// SQLite at data/app.db (WAL). Migrations in server/migrations/*.sql run once each.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
export const db = new Database(path.join(root, 'data', 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const dir = path.join(root, 'server', 'migrations');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(f)) continue;
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
  }
}
