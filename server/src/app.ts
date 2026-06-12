import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { cookieSecret, registerAuth } from './auth';
import { registerSessionRoutes } from './routes/sessions';
import { registerEventRoutes } from './routes/events';
import { registerUploadRoutes } from './routes/upload';
import { registerFileRoutes } from './routes/files';

export async function buildApp() {
  const app = Fastify({ logger: { level: config.isProd ? 'warn' : 'info' } });

  await app.register(fastifyCookie, { secret: cookieSecret() });
  await app.register(fastifyMultipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });
  registerAuth(app);

  app.get('/healthz', async () => ({ ok: true }));
  registerSessionRoutes(app);
  registerEventRoutes(app);
  registerUploadRoutes(app);
  registerFileRoutes(app);

  // Serve the built SPA with an index.html fallback for client-side routes.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.get('/', async () => ({
      arksai: 'server running',
      note: 'client/dist not found — run `npm run build -w client` or use the Vite dev server',
    }));
  }

  return app;
}
