import { db } from '../db.js';
import { nanoid } from 'nanoid';

export function seed() {
  const demo = db.prepare("SELECT id FROM users WHERE email LIKE 'demo@%'").get();
  if (!demo || db.prepare('SELECT 1 FROM items WHERE user_id = ?').get(demo.id)) return;
  const ins = db.prepare('INSERT INTO items (id, user_id, title, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const rows = [
    ['Kick-off checklist', 'Everything needed for day one.', 'done'],
    ['Draft the announcement', 'One page, plain language.', 'open'],
    ['Review the numbers', 'Compare against last month.', 'open'],
  ];
  rows.forEach(([t, n, s], i) => ins.run('i_' + nanoid(12), demo.id, t, n, s, Date.now() - i * 3600e3));
}
