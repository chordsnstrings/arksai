/**
 * ArksAI App Backend Kit — SQLite data layer (better-sqlite3).
 *
 * Dev/default storage. migrate() is idempotent (safe to call on every boot). For larger
 * apps swap to Postgres later behind the same query helpers — keep schema in migrations.
 * DB file lives in the app's working dir by construction. Override only with the dedicated
 * APP_DATA_DIR (a persistent disk on an external host) — never the generic DATA_DIR, which
 * the hosting platform sets for its OWN storage and would otherwise hijack the app's DB path.
 */
const path = require('node:path');
const Database = require('better-sqlite3');

const file = process.env.DB_FILE || path.join(process.env.APP_DATA_DIR || '.', 'app.db');
const db = new Database(file);
db.pragma('journal_mode = WAL'); // safe concurrent reads
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
  `);
}

module.exports = { db, migrate };
