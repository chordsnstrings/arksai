// Local SQLite store — the EXEMPLAR data layer. Clone the table + functions per real
// entity (rename "items" throughout). Works fully offline; migrations run once.
import * as SQLite from 'expo-sqlite';

export interface Item { id: string; title: string; notes: string; done: number; createdAt: number }

let db: SQLite.SQLiteDatabase | null = null;
async function open(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('app.db');
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT "", done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)',
  );
  return db;
}

const rid = () => 'i_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const shape = (r: any): Item => ({ id: r.id, title: r.title, notes: r.notes, done: r.done, createdAt: r.created_at });

export async function listItems(): Promise<Item[]> {
  const d = await open();
  const rows = await d.getAllAsync('SELECT * FROM items ORDER BY created_at DESC');
  return rows.map(shape);
}
export async function getItem(id: string): Promise<Item | null> {
  const d = await open();
  const r = await d.getFirstAsync('SELECT * FROM items WHERE id = ?', id);
  return r ? shape(r) : null;
}
export async function createItem(title: string, notes = ''): Promise<Item> {
  const d = await open();
  const item: Item = { id: rid(), title: title.trim(), notes, done: 0, createdAt: Date.now() };
  await d.runAsync('INSERT INTO items (id, title, notes, done, created_at) VALUES (?, ?, ?, ?, ?)', item.id, item.title, item.notes, item.done, item.createdAt);
  return item;
}
export async function updateItem(id: string, patch: Partial<Pick<Item, 'title' | 'notes' | 'done'>>): Promise<void> {
  const d = await open();
  const cur = await getItem(id);
  if (!cur) return;
  await d.runAsync('UPDATE items SET title = ?, notes = ?, done = ? WHERE id = ?',
    patch.title ?? cur.title, patch.notes ?? cur.notes, patch.done ?? cur.done, id);
}
export async function deleteItem(id: string): Promise<void> {
  const d = await open();
  await d.runAsync('DELETE FROM items WHERE id = ?', id);
}
