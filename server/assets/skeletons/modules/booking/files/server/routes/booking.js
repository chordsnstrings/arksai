// Booking: resources → per-day slot availability → conflict-safe reservations.
// The booking INSERT re-checks conflicts inside a transaction, so two clients racing for
// the same slot can never both win.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { slotsForDay, overlaps } from '../lib/slots.js';

const r = Router();
const shapeRes = (x) => ({ id: x.id, name: x.name, description: x.description, openMin: x.open_min, closeMin: x.close_min, slotMinutes: x.slot_minutes, active: !!x.active });
const shapeBkg = (b) => ({ id: b.id, resourceId: b.resource_id, userId: b.user_id, day: b.day, startMin: b.start_min, endMin: b.end_min, note: b.note, status: b.status, createdAt: b.created_at });
const todayEpochDay = () => Math.floor(Date.now() / 86400000);

r.get('/resources', (_req, res) => {
  res.json(db.prepare('SELECT * FROM resources WHERE active = 1 ORDER BY name').all().map(shapeRes));
});

r.post('/resources', (req, res) => {
  const { name, description, openMin, closeMin, slotMinutes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const open = Number.isFinite(Number(openMin)) ? Math.round(Number(openMin)) : 540;
  const close = Number.isFinite(Number(closeMin)) ? Math.round(Number(closeMin)) : 1020;
  const slot = Number.isFinite(Number(slotMinutes)) ? Math.round(Number(slotMinutes)) : 60;
  if (open < 0 || close > 1440 || open >= close) return res.status(400).json({ error: 'opening hours must be within the day and open before close' });
  if (slot < 5 || slot > close - open) return res.status(400).json({ error: 'slot length must fit inside the opening hours' });
  const x = { id: 'r_' + nanoid(12), name: String(name).trim().slice(0, 120), description: String(description || '').slice(0, 1000), open_min: open, close_min: close, slot_minutes: slot, active: 1, created_at: Date.now() };
  db.prepare('INSERT INTO resources (id, name, description, open_min, close_min, slot_minutes, active, created_at) VALUES (@id, @name, @description, @open_min, @close_min, @slot_minutes, @active, @created_at)').run(x);
  res.json(shapeRes(x));
});

// Availability for one resource on one day (?day=epochDay, default today).
r.get('/resources/:id/slots', (req, res) => {
  const resource = db.prepare('SELECT * FROM resources WHERE id = ? AND active = 1').get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'not_found' });
  const day = Number.isFinite(Number(req.query.day)) ? Math.round(Number(req.query.day)) : todayEpochDay();
  const taken = db.prepare('SELECT * FROM reservations WHERE resource_id = ? AND day = ?').all(resource.id, day);
  res.json({ day, slots: slotsForDay(resource, taken) });
});

// The signed-in user's upcoming reservations (admins see everything via ?all=1).
r.get('/reservations', (req, res) => {
  const today = todayEpochDay();
  const rows = req.query.all
    ? db.prepare('SELECT * FROM reservations WHERE day >= ? ORDER BY day, start_min LIMIT 500').all(today)
    : db.prepare('SELECT * FROM reservations WHERE user_id = ? AND day >= ? ORDER BY day, start_min LIMIT 200').all(req.user.id, today);
  res.json(rows.map(shapeBkg));
});

r.post('/reservations', (req, res) => {
  const { resourceId, day, startMin, note } = req.body || {};
  const resource = db.prepare('SELECT * FROM resources WHERE id = ? AND active = 1').get(String(resourceId || ''));
  if (!resource) return res.status(400).json({ error: 'pick a resource to book' });
  const d = Math.round(Number(day));
  const s = Math.round(Number(startMin));
  if (!Number.isFinite(d) || d < todayEpochDay()) return res.status(400).json({ error: 'pick a day from today onward' });
  if (!Number.isFinite(s)) return res.status(400).json({ error: 'pick a time slot' });
  const e = s + resource.slot_minutes;
  if (s < resource.open_min || e > resource.close_min || (s - resource.open_min) % resource.slot_minutes !== 0)
    return res.status(400).json({ error: 'that time is outside the bookable slots' });

  let created = null;
  const tx = db.transaction(() => {
    const taken = db.prepare("SELECT * FROM reservations WHERE resource_id = ? AND day = ? AND status = 'booked'").all(resource.id, d);
    if (taken.some((b) => overlaps(s, e, b.start_min, b.end_min))) return; // conflict → created stays null
    created = { id: 'b_' + nanoid(12), resource_id: resource.id, user_id: req.user.id, day: d, start_min: s, end_min: e, note: String(note || '').slice(0, 500), status: 'booked', created_at: Date.now() };
    db.prepare('INSERT INTO reservations (id, resource_id, user_id, day, start_min, end_min, note, status, created_at) VALUES (@id, @resource_id, @user_id, @day, @start_min, @end_min, @note, @status, @created_at)').run(created);
  });
  tx();
  if (!created) return res.status(409).json({ error: 'that slot was just taken — pick another' });
  res.json(shapeBkg(created));
});

// Cancel your own reservation (frees the slot).
r.delete('/reservations/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!b) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(b.id);
  res.json({ ok: true });
});

export default r;
