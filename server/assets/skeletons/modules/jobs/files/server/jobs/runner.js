// Dep-free in-process scheduler: register jobs with an interval; every run is logged to the
// job_runs table (visible at GET /api/jobs). Define jobs in this file's REGISTRY.
import { db } from '../db.js';
import { nanoid } from 'nanoid';

const REGISTRY = [
  // { name: 'cleanup', everyMs: 3600e3, run: async () => { … } },
];

export function startJobs() {
  for (const job of REGISTRY) {
    setInterval(async () => {
      const started = Date.now();
      try {
        await job.run();
        db.prepare('INSERT INTO job_runs (id, name, ok, detail, ran_at, ms) VALUES (?, ?, 1, ?, ?, ?)').run('j_' + nanoid(10), job.name, '', started, Date.now() - started);
      } catch (e) {
        db.prepare('INSERT INTO job_runs (id, name, ok, detail, ran_at, ms) VALUES (?, ?, 0, ?, ?, ?)').run('j_' + nanoid(10), job.name, String(e?.message || e).slice(0, 300), started, Date.now() - started);
      }
    }, job.everyMs).unref?.();
  }
}
