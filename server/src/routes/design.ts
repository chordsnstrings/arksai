import type { FastifyInstance } from 'fastify';
import { DIRECTIONS } from '../agent/directions';

/**
 * Design studio API — read-only summaries of the tested direction library so the client's
 * style picker renders from the ONE catalog (server/src/agent/directions.ts) instead of
 * duplicating it. Auth: the global gate (not in the public allowlist).
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
}
