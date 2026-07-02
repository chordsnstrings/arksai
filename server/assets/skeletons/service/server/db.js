// SQLite in data/ (survives republish) with an idempotent migration runner: every file in
// server/migrations/*.sql runs once, recorded in _migrations. DATABASE_URL is intentionally
// not read here — the platform provisions Postgres at publish time when an app opts in.
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, ran_at INTEGER)');
  const dir = path.join(__dirname, 'migrations');
  const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations (name, ran_at) VALUES (?, ?)').run(f, Date.now());
  }
}
