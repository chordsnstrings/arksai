import type { FastifyInstance } from 'fastify';
import { listModels } from '../agent/models';

export function registerModelRoutes(app: FastifyInstance) {
  app.get('/api/models', async () => {
    return { models: await listModels() };
  });
}
