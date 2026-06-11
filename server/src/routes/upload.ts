import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TimelineItem } from '../../../shared/types';
import * as store from '../sessions/store';
import { repoDir } from '../sessions/workspace';
import { bus } from '../events/bus';

function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'file').replace(/[^\w.\- ()]/g, '_');
  return (base || 'file').slice(0, 100);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function registerUploadRoutes(app: FastifyInstance) {
  app.post('/api/sessions/:id/upload', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getSession(id)) return reply.code(404).send({ error: 'Not found' });

    const uploadsDir = path.join(repoDir(id), 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const saved: { name: string; size: number }[] = [];
    for await (const part of req.files()) {
      const safe = sanitizeFilename(part.filename);
      let dest = path.join(uploadsDir, safe);
      if (fs.existsSync(dest)) dest = path.join(uploadsDir, `${Date.now()}-${safe}`);
      await pipeline(part.file, fs.createWriteStream(dest));
      if (part.file.truncated) {
        fs.rmSync(dest, { force: true });
        return reply.code(413).send({ error: `${safe} exceeds the 25 MB upload limit` });
      }
      saved.push({ name: path.relative(repoDir(id), dest), size: fs.statSync(dest).size });
    }
    if (saved.length === 0) return reply.code(400).send({ error: 'No files received' });

    for (const file of saved) {
      const item: TimelineItem = {
        kind: 'system',
        id: randomUUID(),
        level: 'info',
        text: `📎 Uploaded ${file.name} (${fmtBytes(file.size)})`,
        ts: Date.now(),
      };
      store.appendTimeline(id, item);
      bus.emit(id, { type: 'timeline_item', item });
    }
    store.updateSession(id, {});
    return { ok: true, files: saved };
  });
}
