// GENERATED MOUNT POINT — scaffold_app rewrites this file when modules are added.
// Every module router mounts here; keep /api/auth first.
import authRouter from './routes/auth.js';
/*__MODULE_IMPORTS__*/

export function mountApi(app) {
  app.use('/api/auth', authRouter);
  /*__MODULE_MOUNTS__*/
}
