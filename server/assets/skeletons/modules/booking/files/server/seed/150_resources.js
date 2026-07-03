import { db } from '../db.js';
import { nanoid } from 'nanoid';

// EXEMPLAR seed — replace with the app's REAL bookable resources (rooms, chairs, courts…).
export function seed() {
  if (db.prepare('SELECT 1 FROM resources LIMIT 1').get()) return;
  const ins = db.prepare('INSERT INTO resources (id, name, description, open_min, close_min, slot_minutes, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  ins.run('r_' + nanoid(12), 'Room A', 'The larger room — seats eight.', 540, 1020, 60, Date.now());
  ins.run('r_' + nanoid(12), 'Room B', 'The quiet room — seats four.', 540, 1020, 30, Date.now());
}
