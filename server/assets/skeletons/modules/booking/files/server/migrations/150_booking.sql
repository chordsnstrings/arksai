CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  open_min INTEGER NOT NULL DEFAULT 540,   -- 09:00, minutes from midnight
  close_min INTEGER NOT NULL DEFAULT 1020, -- 17:00
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  day INTEGER NOT NULL,        -- epoch day (floor(ms / 86400000)) — no date SQL
  start_min INTEGER NOT NULL,  -- minutes from midnight
  end_min INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'booked',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_res_day ON reservations (resource_id, day);
