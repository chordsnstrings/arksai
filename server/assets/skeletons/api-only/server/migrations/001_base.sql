CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- EXEMPLAR resource — clone per real entity (same shapes/guards/validation).
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
