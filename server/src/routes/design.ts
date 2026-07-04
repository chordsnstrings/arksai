import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DIRECTIONS } from '../agent/directions';
import { MOTION_STYLES } from '../agent/motion/styles';
import { repoRoot } from '../config';

/**
 * Design + motion-style catalogs — read-only, served from the ONE source of truth so no
 * client duplicates them (the directions-menu pattern). Auth: the global gate.
 */
export function registerDesignRoutes(app: FastifyInstance) {
  app.get('/api/design/directions', async () => ({
    directions: DIRECTIONS.map((d) => ({
      id: d.id,
      group: d.group,
      name: d.name,
      mood: d.mood,
      accent: d.accent,
      dark: d.dark,
      display: d.display,
      body: d.body,
      signature: d.signature,
    })),
  }));

  // Motion style packs for the video Style Picker — previews are REAL engine-rendered
  // frames (server/assets/motion-kit/previews/<id>.jpg), so the card can never drift
  // from what the engine actually produces.
  app.get('/api/motion/styles', async () => ({
    styles: MOTION_STYLES.filter((s) => s.available).map((s) => ({
      ...s,
      previewUrl: `/api/motion/styles/${s.id}/preview.jpg`,
    })),
  }));

  app.get<{ Params: { id: string } }>('/api/motion/styles/:id/preview.jpg', async (req, reply) => {
    const id = String(req.params.id).replace(/[^a-z-]/g, '');
    if (!MOTION_STYLES.some((s) => s.id === id)) return reply.code(404).send({ error: 'Unknown style' });
    const abs = path.join(repoRoot, 'server', 'assets', 'motion-kit', 'previews', `${id}.jpg`);
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'Preview not rendered' });
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.type('image/jpeg').send(fs.createReadStream(abs));
  });
}
