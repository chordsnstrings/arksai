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
import { registerModelRoutes } from './routes/models';
import { registerCommandRoutes } from './routes/commands';
import { registerPreviewRoutes } from './routes/preview';
import { registerMemoryRoutes } from './routes/memory';
import { registerEngineRoutes } from './routes/engines';
import { registerProjectRoutes } from './routes/projects';
import { registerDeploymentRoutes } from './routes/deployments';
import { registerDocviewRoutes } from './routes/docview';
import { registerLeadRoutes } from './routes/leads';
import { registerScheduleRoutes } from './routes/schedules';
import { registerOrgRoutes } from './routes/orgs';
import { registerAnalyticsRoutes } from './routes/analytics';
import { registerEmailRoutes } from './routes/email';
import { registerRobotRoutes } from './routes/robots';
import { registerConnectorRoutes } from './routes/connectors';
import { registerIncidentRoutes } from './routes/incidents';
import { registerBuildRoutes } from './routes/builds';
import { isMarketingRoute, renderMarketingHtml } from './seo/marketingMeta';

export async function buildApp() {
  const app = Fastify({ logger: { level: config.isProd ? 'warn' : 'info' } });

  // Tolerate empty JSON bodies (e.g. DELETE/POST with no payload) instead of
  // returning 400 — the default parser errors on an empty body. Malformed JSON
  // is a CLIENT error → return 400 (a bad request), not a 500 (looks like we broke).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const s = (body as string).trim();
    if (!s) return done(null, undefined);
    try {
      done(null, JSON.parse(s));
    } catch {
      const err = new Error('Malformed JSON in request body.') as Error & { statusCode?: number };
      err.statusCode = 400;
      done(err);
    }
  });

  // One place for thrown/uncaught errors. The client reads the `error` field, so put a
  // calm, actionable message there: surface a deliberate 4xx message (validation, bad
  // request) since it tells the user what to fix, but NEVER leak an internal 5xx detail
  // (a DB/filesystem error) — that's logged server-side and shown as a friendly generic
  // line. (Intentional `reply.code().send({error})` responses don't reach here.)
  app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
    const raw = err.statusCode;
    const status = typeof raw === 'number' && raw >= 400 && raw < 600 ? raw : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    const error =
      status < 500
        ? err.message || 'Bad request.'
        : 'Something went wrong on our end. Please try again in a moment.';
    reply.code(status).send({ error });
  });

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
  registerModelRoutes(app);
  registerCommandRoutes(app);
  registerPreviewRoutes(app);
  registerMemoryRoutes(app);
  registerEngineRoutes(app);
  registerProjectRoutes(app);
  registerDeploymentRoutes(app);
  registerDocviewRoutes(app);
  registerLeadRoutes(app);
  registerScheduleRoutes(app);
  registerOrgRoutes(app);
  registerAnalyticsRoutes(app);
  registerEmailRoutes(app);
  registerRobotRoutes(app);
  registerConnectorRoutes(app);
  registerIncidentRoutes(app);
  registerBuildRoutes(app);

  // Serve the built SPA with an index.html fallback for client-side routes.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        // For public MARKETING routes, inject per-route <title>/description/OpenGraph
        // so a shared link (Reddit, X, WhatsApp, Slack, Google) previews correctly —
        // crawlers don't run the SPA's JS. App routes fall through to the plain shell.
        if (isMarketingRoute(req.url)) {
          const html = renderMarketingHtml(req.url);
          if (html) return reply.type('text/html').send(html);
        }
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
