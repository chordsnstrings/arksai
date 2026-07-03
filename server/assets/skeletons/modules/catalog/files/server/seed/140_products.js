import { db } from '../db.js';
import { nanoid } from 'nanoid';

// EXEMPLAR seed — replace with the app's REAL products (names, prices, categories).
export function seed() {
  if (db.prepare('SELECT 1 FROM products LIMIT 1').get()) return;
  const ins = db.prepare('INSERT INTO products (id, name, description, category, price_cents, image_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  const rows = [
    ['Starter kit', 'Everything a first order needs, boxed and ready.', 'Kits', 4900],
    ['Monthly refill', 'The standing refill, delivered on your schedule.', 'Refills', 1900],
    ['Gift card', 'A prepaid balance they can spend on anything here.', 'Gifts', 2500],
  ];
  rows.forEach(([n, d, c, price], i) => ins.run('p_' + nanoid(12), n, d, c, price, '', Date.now() - i * 3600e3));
}
