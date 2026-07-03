// Content management (signed-in): full CRUD + publish toggle. Slugs are stable URLs —
// validated, unique, never auto-changed on edit unless explicitly set.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';

const r = Router();
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const shape = (p) => ({ id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, bodyMd: p.body_md, published: !!p.published, createdAt: p.created_at, updatedAt: p.updated_at });
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

r.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM posts ORDER BY updated_at DESC LIMIT 500').all().map(shape));
});

r.post('/', (req, res) => {
  const { title, slug, excerpt, bodyMd } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  const s = slug ? String(slug).trim() : slugify(title);
  if (!SLUG_RE.test(s)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers and hyphens' });
  if (db.prepare('SELECT 1 FROM posts WHERE slug = ?').get(s)) return res.status(409).json({ error: 'a post with that slug already exists' });
  const now = Date.now();
  const p = { id: 'c_' + nanoid(12), slug: s, title: String(title).trim().slice(0, 200), excerpt: String(excerpt || '').slice(0, 500), body_md: String(bodyMd || '').slice(0, 100_000), published: 0, created_at: now, updated_at: now };
  db.prepare('INSERT INTO posts (id, slug, title, excerpt, body_md, published, created_at, updated_at) VALUES (@id, @slug, @title, @excerpt, @body_md, @published, @created_at, @updated_at)').run(p);
  res.json(shape(p));
});

r.patch('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  let slug = p.slug;
  if (b.slug !== undefined) {
    slug = String(b.slug).trim();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers and hyphens' });
    if (slug !== p.slug && db.prepare('SELECT 1 FROM posts WHERE slug = ?').get(slug)) return res.status(409).json({ error: 'a post with that slug already exists' });
  }
  const next = {
    slug,
    title: b.title !== undefined ? String(b.title).trim().slice(0, 200) : p.title,
    excerpt: b.excerpt !== undefined ? String(b.excerpt).slice(0, 500) : p.excerpt,
    body_md: b.bodyMd !== undefined ? String(b.bodyMd).slice(0, 100_000) : p.body_md,
    published: b.published !== undefined ? (b.published ? 1 : 0) : p.published,
  };
  if (!next.title) return res.status(400).json({ error: 'title is required' });
  db.prepare('UPDATE posts SET slug=@slug, title=@title, excerpt=@excerpt, body_md=@body_md, published=@published, updated_at=@updated_at WHERE id=@id')
    .run({ ...next, updated_at: Date.now(), id: p.id });
  res.json(shape({ ...p, ...next, updated_at: Date.now() }));
});

r.delete('/:id', (req, res) => {
  const done = db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  if (!done.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default r;
