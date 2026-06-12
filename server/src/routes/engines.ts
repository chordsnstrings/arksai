import type { FastifyInstance } from 'fastify';
import { listEngines } from '../engines/registry';

export function registerEngineRoutes(app: FastifyInstance) {
  app.get('/api/engines', async () => ({ engines: listEngines() }));
}
