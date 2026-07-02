import { db } from '../db.js';

/** The demo workspace the gate's isolation check uses. Idempotent. */
export function seed() {
  if (db.prepare("SELECT 1 FROM orgs WHERE slug = 'demo'").get()) return;
  const demo = db.prepare("SELECT id FROM users WHERE email LIKE 'demo@%'").get();
  if (!demo) return;
  db.prepare('INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run('o_demo00000001', 'demo', 'Demo Workspace', Date.now());
  db.prepare('INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run('o_demo00000001', demo.id, 'owner', Date.now());
  db.prepare('INSERT INTO invites (code, org_id, uses_left, created_at) VALUES (?, ?, ?, ?)').run('INV-DEMO2024', 'o_demo00000001', 25, Date.now());
}
