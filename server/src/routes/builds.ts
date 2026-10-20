import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';
import { scopeOf } from '../auth';
import {
  createBuild,
  getBuild,
  listBuildsForSession,
  updateBuild,
  latestBuildByPlatform,
} from '../build/store';
import {
  startAndroidBuild,
  isBuildConfigured,
  sourceTarPath,
  apkPath,
} from '../build/androidBuild';
import { setBuildToken, setSnapshotId, doToken, snapshotId } from '../build/runtime';
import {
  setByteplusKey,
  clearByteplusKey,
  byteplusConfigured,
  byteplusKey,
  byteplusKeySource,
  byteplusEnvKeyAvailable,
} from '../agent/byteplusRuntime';
import { setMetaAppSecret, metaSecretConfigured } from '../connectors/metaRuntime';
import { providerAvailable } from '../connectors';
import { setPexelsKey, pexelsKey } from '../agent/assets/photos';
import { ttsAvailable } from '../engines/speech';
import { endpointFor, scrubKey } from '../engines/modelark';
import { VIDEO_MODELS } from '../engines/seedance';
import { ASR_MODEL } from '../robots/voice';
import { compareAltModel } from '../robots/reply';
import { Semaphore } from '../lib/semaphore';
import { startBake } from '../build/bake';
import { config } from '../config';

function tokenOk(want: string, got: unknown): boolean {
  if (typeof got !== 'string' || !got) return false;
  // Compare hashes so length differences don't leak + the compare is constant-time.
  const a = createHash('sha256').update(want).digest();
  const b = createHash('sha256').update(got).digest();
  return timingSafeEqual(a, b);
}

/** A ModelArk key: "ark-" then printable ASCII only (no whitespace, control or zero-width chars —
 *  they'd be rejected as a header value with the key quoted in the error). Mirrored in KeysPanel. */
export const ARK_KEY_RE = /^ark-[\x21-\x7e]+$/;

export function registerBuildRoutes(app: FastifyInstance) {
  // The build droplet uploads the raw APK (octet-stream) and a plain-text log tail.
  // Pass the binary body through untouched (we stream it to disk); buffer the log as text.
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
  }
  if (!app.hasContentTypeParser('text/plain')) {
    app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body));
  }

  // ---- Operator only: configure the DO token, bake the build machine, check status ----

  app.post('/api/admin/build/configure', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const body = (req.body as any) || {};
    const token = String(body.doToken || '').trim();
    const snap = String(body.snapshotId || '').trim();
    if (token) {
      if (!token.startsWith('dop_v1_')) return reply.code(400).send({ error: 'Provide a DigitalOcean API token (dop_v1_…).' });
      await setBuildToken(token);
    }
    // Set/recover the baked snapshot id directly (e.g. activate with an existing snapshot).
    if (snap) {
      if (!/^\d+$/.test(snap)) return reply.code(400).send({ error: 'snapshotId must be a numeric DO image id.' });
      await setSnapshotId(snap);
    }
    if (!token && !snap) return reply.code(400).send({ error: 'Provide doToken and/or snapshotId.' });
    return { ok: true, hasToken: !!doToken(), snapshotId: snapshotId() || null, configured: isBuildConfigured() };
  });

  // Operator only: store the ModelArk ark key (encrypted at rest, no SSH/redeploy). ModelArk is
  // the single model provider, so this turns EVERY model lane + capability on at once.
  app.post('/api/admin/providers/byteplus', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const key = String((req.body as any)?.key || '').trim();
    if (!key.startsWith('ark-')) return reply.code(400).send({ error: 'Provide the ArksAI model key (ark-…).' });
    // Printable ASCII only: an embedded CR/LF/NUL/zero-width char survives trim(), is stored as
    // "configured", then makes every fetch throw an undici TypeError that ECHOES the raw key.
    if (!ARK_KEY_RE.test(key)) return reply.code(400).send({ error: 'That key contains invalid characters — paste it again.' });
    await setByteplusKey(key);
    return { ok: true, configured: byteplusConfigured(), source: byteplusKeySource() };
  });

  // Operator only: drop the admin-set ModelArk key and fall back to ARK_API_KEY from the server
  // environment (an admin-set key otherwise wins forever). Refused when there is no env key to
  // fall back to — clearing would switch every model off; rotate the key instead.
  app.delete('/api/admin/providers/byteplus', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    if (!byteplusEnvKeyAvailable()) {
      return reply.code(409).send({ error: 'There is no server-environment model key to fall back to — rotate the key instead.' });
    }
    await clearByteplusKey();
    return { ok: true, configured: byteplusConfigured(), source: byteplusKeySource() };
  });

  // Operator only: entitlement check of the droplet's own ModelArk key against every model the
  // platform is configured to call. chat + embeddings make a REAL minimal call (1 output token /
  // one tiny text — fractions of a cent): only a 2xx counts as access. Images + video send a
  // deliberately INVALID request (rejected in validation, nothing generates or bills): NotFound =
  // no access, InvalidParameter = access is fine. Bounded: ≤4 in flight, 15 s each.
  app.post('/api/admin/providers/modelark/verify', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    if (!byteplusConfigured()) return reply.code(400).send({ error: 'No model key is configured yet — set it under Admin → Keys first.' });
    return verifyModelarkAccess();
  });


  // Operator only: activate Pexels stock photography/footage for search_photos (encrypted
  // at rest, no SSH/redeploy). Keyless CC fallbacks work without it; Pexels is the quality source.
  app.post('/api/admin/providers/pexels', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const key = String((req.body as any)?.key || '').trim();
    if (key.length < 20) return reply.code(400).send({ error: 'Provide a Pexels API key (free at pexels.com/api).' });
    await setPexelsKey(key);
    return { ok: true, configured: !!pexelsKey() };
  });

  // Operator only: rotate the DigitalOcean API token (encrypted at rest, no SSH/redeploy). Used by
  // the build orchestrator; the master ArksAI droplet is hard-protected from any destructive op.
  app.post('/api/admin/providers/do', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const t = String((req.body as any)?.token || '').trim();
    if (!t.startsWith('dop_v1_')) return reply.code(400).send({ error: 'Provide a DigitalOcean API token (dop_v1_…).' });
    await setBuildToken(t);
    return { ok: true, configured: !!doToken() };
  });

  // Operator only: store the Meta app SECRET (encrypted at rest, no SSH/redeploy) to activate the
  // Meta ads connector. The app_id + Facebook-Login-for-Business config_id are non-secret and baked
  // in config; only the secret lands here. providerAvailable also needs the connector encryption key
  // (falls back to APP_PASSWORD), so this flips the connector fully on.
  app.post('/api/admin/providers/meta', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const secret = String((req.body as any)?.appSecret || '').trim();
    if (!/^[a-f0-9]{16,}$/i.test(secret)) return reply.code(400).send({ error: 'Provide the Meta app secret (hex string from App Dashboard → Settings → Basic).' });
    await setMetaAppSecret(secret);
    return { ok: true, configured: metaSecretConfigured(), available: providerAvailable('meta') };
  });

  // Operator only: read the configured-status of platform provider keys (NO secret values) +
  // the protected master droplet, so the admin UI can show what's set and what's locked.
  app.get('/api/admin/providers', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    return {
      // `byteplus` stays the key-status field the admin Keys panel reads; `modelark` adds what it unlocks.
      // `envKey` = whether ARK_API_KEY is set in the server environment (a boolean, never the value),
      // so the panel can offer "use the server key instead" when an admin-set key overrides it.
      byteplus: {
        label: 'ArksAI model key',
        configured: byteplusConfigured(),
        source: byteplusKeySource(),
        envKey: byteplusEnvKeyAvailable(),
      },
      modelark: {
        label: 'ArksAI models',
        configured: byteplusConfigured(),
        capabilities: {
          chat: byteplusConfigured(),
          vision: byteplusConfigured(),
          images: byteplusConfigured(),
          video: byteplusConfigured(),
          embeddings: byteplusConfigured(),
          // No speech model on ModelArk — follows engines/speech.ts, so it lights up if one is added.
          tts: ttsAvailable(),
        },
      },
      digitalocean: { label: 'DigitalOcean API', configured: !!doToken() },
      pexels: { label: 'Pexels stock photos/footage', configured: !!pexelsKey() },
      meta: { label: 'Meta ads connector (app secret)', configured: metaSecretConfigured(), available: providerAvailable('meta') },
      protected: { masterDropletId: config.masterDropletId, masterDropletName: config.masterDropletName },
    };
  });

  app.post('/api/admin/build/bake', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    if (!doToken()) return reply.code(400).send({ error: 'Configure the DO token first (POST /api/admin/build/configure).' });
    const { id } = await startBake();
    return reply.code(201).send({ id });
  });

  app.get('/api/admin/build/state', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const bake = await latestBuildByPlatform('bake');
    return {
      configured: isBuildConfigured(),
      hasToken: !!doToken(),
      snapshotId: snapshotId() || null,
      bake: bake ? { id: bake.id, status: bake.status, phase: bake.phase, error: bake.error, updatedAt: bake.updated_at } : null,
    };
  });

  // ---- Authenticated (the app user): start a build, poll it, download the APK ----

  app.post('/api/sessions/:id/build-apk', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await store.getSession(id, scopeOf(req));
    if (!session) return reply.code(404).send({ error: 'Not found' });
    if (!isBuildConfigured()) {
      return reply.code(503).send({
        error: 'Android APK builds are not configured on this server yet. The web/PWA build is available now; the native APK builder needs the one-time build-machine setup (see BUILD_BAKE.md).',
      });
    }
    const appName = String((req.body as any)?.name || session.title || 'ArksAI App').slice(0, 60);
    const build = await createBuild({ sessionId: id, orgId: session.orgId ?? null, appName });
    // Fire-and-forget; the client polls GET /api/builds/:id.
    void startAndroidBuild(build, id);
    return reply.code(201).send({ id: build.id, status: build.status });
  });

  app.get('/api/sessions/:id/builds', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id, scopeOf(req)))) return reply.code(404).send({ error: 'Not found' });
    const builds = await listBuildsForSession(id);
    return { builds: builds.map(pub) };
  });

  app.get('/api/builds/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !b.session_id || !(await store.getSession(b.session_id, scopeOf(req)))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return pub(b);
  });

  app.get('/api/builds/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !b.session_id || !(await store.getSession(b.session_id, scopeOf(req)))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (b.status !== 'success' || !b.artifact_path || !fs.existsSync(b.artifact_path)) {
      return reply.code(409).send({ error: 'APK not ready' });
    }
    const safe = b.app_name.replace(/[^a-zA-Z0-9._-]/g, '-') || 'app';
    reply.header('Content-Type', 'application/vnd.android.package-archive');
    reply.header('Content-Disposition', `attachment; filename="${safe}.apk"`);
    return reply.send(fs.createReadStream(b.artifact_path));
  });

  // ---- Open + token-gated (the ephemeral build droplet calls these over HTTPS) ----
  // These paths are allowlisted in auth.ts; each verifies the per-build one-time token.

  app.get('/api/builds/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    const p = sourceTarPath(id);
    if (!fs.existsSync(p)) return reply.code(404).send('no source');
    reply.header('Content-Type', 'application/gzip');
    return reply.send(fs.createReadStream(p));
  });

  app.post('/api/builds/:id/artifact', { bodyLimit: 256 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    const dest = apkPath(id);
    const body = req.body as NodeJS.ReadableStream | undefined;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      const stream = (body && typeof (body as any).pipe === 'function' ? body : (req.raw as NodeJS.ReadableStream));
      stream.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject);
      (stream as any).on('error', reject);
    });
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (size < 1024) {
      await updateBuild(id, { status: 'error', phase: 'upload failed', error: 'The uploaded APK was empty.' });
      return reply.code(400).send('empty');
    }
    await updateBuild(id, { status: 'success', phase: 'done', artifact_path: dest, size_bytes: size });
    return { ok: true };
  });

  // Neutral log sink for the bake droplet (does NOT change status — runBake owns that;
  // it polls this log for the RESULT=OK/FAIL marker). Distinct from /fail, which is for
  // an APK build that genuinely failed.
  app.post('/api/builds/:id/bakelog', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    let log = '';
    try {
      log = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
    } catch { /* ignore */ }
    await updateBuild(id, { error: log.slice(-6000).trim() }); // store log only; keep status
    return { ok: true };
  });

  app.post('/api/builds/:id/fail', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    let log = '';
    try {
      log = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
    } catch { /* ignore */ }
    const tail = log.slice(-6000).trim();
    await updateBuild(id, { status: 'error', phase: 'build failed', error: tail || 'The build failed on the build machine.' });
    return { ok: true };
  });
}

/** Public view (never leak the one-time token or absolute filesystem path). */
function pub(b: Awaited<ReturnType<typeof getBuild>>) {
  if (!b) return null;
  return {
    id: b.id,
    platform: b.platform,
    appName: b.app_name,
    status: b.status,
    phase: b.phase,
    sizeBytes: b.size_bytes,
    cost: b.cost,
    error: b.error,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    downloadUrl: b.status === 'success' ? `/api/builds/${b.id}/download` : null,
  };
}

// ---------------------------------------------------------------- ModelArk entitlement probes
// "Can this key actually call that model on that endpoint?" checks, run with the droplet's key.
//  • chat + embeddings: a REAL minimal call (1 output token / one tiny text) — fractions of a cent,
//    and the only way to catch a model the coding plan won't SERVE: a validation-only probe passes
//    those (verified 2026-10-20: Seed 2.1 Turbo validates on the plan, then a real call returns
//    "UnsupportedModel").
//    Only a 2xx counts as access; any other rejection (e.g. the endpoint refusing max_tokens or the
//    thinking flag) is an error with the API's detail.
//  • images + video: a deliberately INVALID request (rejected in validation, never generated or
//    billed — the ModelArk CLI's `models --verify` trick): NotFound = no access, InvalidParameter = ok.

export type ProbeKind = 'chat' | 'image' | 'embedding' | 'video';
export type ProbeAccess = 'ok' | 'no_access' | 'error';
export interface ProbeResult {
  model: string;
  /** Which endpoint + path was probed, e.g. "coding /chat/completions". */
  endpoint: string;
  access: ProbeAccess;
  detail: string;
  kind: ProbeKind;
  /** The branded lanes / capabilities that call this model. */
  usedBy: string[];
}
export interface ProbeTarget {
  model: string;
  kind: ProbeKind;
  base: string;
  endpoint: string;
  usedBy: string[];
}

const PROBE_PATH: Record<ProbeKind, string> = {
  chat: '/chat/completions',
  image: '/images/generations',
  embedding: '/embeddings/multimodal',
  video: '/contents/generations/tasks',
};
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_CONCURRENCY = 4;

/** The probe body per kind. chat/embedding = a real minimal call (proves the endpoint SERVES the
 *  model); image/video = deliberately invalid (rejected in validation, never generated). PURE. */
export function probeBody(kind: ProbeKind, model: string): Record<string, unknown> {
  switch (kind) {
    case 'chat':
      return { model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 1, thinking: { type: 'disabled' } };
    case 'image':
      return { model, prompt: 'probe', size: '10x10' }; // far below Seedream's minimum pixel count
    case 'embedding':
      return { model, input: [{ type: 'text', text: 'ok' }] };
    case 'video':
      return { model, content: [] };
  }
}

/** Every distinct (kind, model, endpoint) the platform is configured to call, with who calls it:
 *  each branded lane in config.modelarkModels (on its own endpoint), the vision/text/coder one-shot
 *  models, the robot voice-note ASR model, Seedream, the Skylark embedder and every Seedance api
 *  id. PURE over config. */
export function modelarkProbeTargets(): ProbeTarget[] {
  const coding = config.byteplusBaseUrl.replace(/\/$/, '');
  const general = config.byteplusVideoBaseUrl.replace(/\/$/, '');
  const label = (b: string) => (b === coding ? 'coding' : b === general ? 'general' : b);
  const chatBase = (model: string) => (endpointFor(model) === 'general' ? general : coding);
  const out = new Map<string, ProbeTarget>();
  const add = (kind: ProbeKind, model: string, base: string, usedBy: string) => {
    if (!model) return;
    const b = base.replace(/\/$/, '');
    const key = `${kind}|${model}|${b}`;
    const t = out.get(key);
    if (t) {
      if (!t.usedBy.includes(usedBy)) t.usedBy.push(usedBy);
      return;
    }
    out.set(key, { model, kind, base: b, endpoint: `${label(b)} ${PROBE_PATH[kind]}`, usedBy: [usedBy] });
  };
  // Agent-loop lanes stream from their `base` override or the coding plan (as the runner does).
  for (const [id, lane] of Object.entries(config.modelarkModels)) add('chat', lane.model, lane.base || coding, id);
  add('chat', config.arkVisionModel, chatBase(config.arkVisionModel), 'vision');
  add('chat', config.arkTextModel, chatBase(config.arkTextModel), 'one-shot text');
  add('chat', config.arkCoderModel, chatBase(config.arkCoderModel), 'code / SVG authoring');
  // Robot voice notes: an input_audio chat call on the GENERAL endpoint (robots/voice.ts).
  add('chat', ASR_MODEL, general, 'voice-note transcription');
  // Robot reply "Compare" runs a second model family (GLM-5.2 unless ARK_REPLY_ALT_MODEL overrides).
  add('chat', compareAltModel(), chatBase(compareAltModel()), 'robot reply compare');
  add('image', config.arkImageModel, general, 'image generation');
  add('embedding', config.arkEmbedModel, coding, 'embeddings');
  for (const [id, v] of Object.entries(VIDEO_MODELS)) add('video', v.api, general, id);
  return [...out.values()];
}

/** Classify one probe response. PURE (unit-testable). chat/embedding probes are REAL calls, so only
 *  a 2xx proves access; image/video probes are meant to fail validation, so a validation rejection
 *  (InvalidParameter / a non-auth 400) is the expected "access is fine" answer. */
export function classifyProbe(kind: ProbeKind, status: number, data: any, fallback = ''): { access: ProbeAccess; detail: string } {
  const code = String(data?.error?.code ?? '');
  const msg = String(data?.error?.message ?? '').slice(0, 240);
  const detail = [code, msg].filter(Boolean).join(': ') || fallback || `HTTP ${status}`;
  const realCall = kind === 'chat' || kind === 'embedding';
  if (status >= 200 && status < 300) {
    return {
      access: 'ok',
      detail: realCall ? 'served — a real minimal call succeeded on this endpoint' : 'accepted — this key can call the model',
    };
  }
  // Not entitled / not activated for this account / not served on this endpoint.
  if (/NotFound|InvalidEndpointOrModel|UnsupportedModel|ModelNotOpen/i.test(code)) return { access: 'no_access', detail };
  // A real call that came back non-2xx did NOT prove access — e.g. the endpoint rejected the
  // thinking flag or max_tokens, which the lane itself would hit too.
  if (realCall) return { access: 'error', detail: status === 400 ? `the real call was rejected — ${detail}` : detail };
  // Rejected in VALIDATION → the model was found and this key may call it.
  if (/InvalidParameter|MissingParameter/i.test(code) || (status === 400 && !/Auth|Unauthorized|Forbidden|AccessDenied|Quota|RateLimit|Overdue|Balance/i.test(code))) {
    return { access: 'ok', detail: `rejected in validation as intended — ${detail}` };
  }
  return { access: 'error', detail };
}

async function runProbe(t: ProbeTarget): Promise<ProbeResult> {
  const base = { model: t.model, endpoint: t.endpoint, kind: t.kind, usedBy: t.usedBy };
  const headers = { Authorization: `Bearer ${byteplusKey()}`, 'Content-Type': 'application/json' };
  const ac = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  // Raced as well as aborted: an abort doesn't reliably reject an undici fetch awaiting headers.
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      ac.abort();
      rej(new Error(`timed out after ${PROBE_TIMEOUT_MS / 1000}s`));
    }, PROBE_TIMEOUT_MS);
  });
  deadline.catch(() => {});
  try {
    const res = await Promise.race([
      fetch(`${t.base}${PROBE_PATH[t.kind]}`, { method: 'POST', headers, body: JSON.stringify(probeBody(t.kind, t.model)), signal: ac.signal }),
      deadline,
    ]);
    const raw = await Promise.race([res.text(), deadline]);
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {
      /* non-JSON — classified by status */
    }
    // A probe must never leave work running: should a video task somehow be ACCEPTED, cancel it.
    if (res.ok && t.kind === 'video' && data?.id) {
      fetch(`${t.base}${PROBE_PATH.video}/${encodeURIComponent(String(data.id))}`, { method: 'DELETE', headers }).catch(() => {});
    }
    return { ...base, ...classifyProbe(t.kind, res.status, data, raw ? `HTTP ${res.status}: ${raw.slice(0, 160)}` : '') };
  } catch (e: any) {
    return { ...base, access: 'error', detail: scrubKey(String(e?.message ?? e)) };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe every configured model with the droplet's own key (≤4 in flight, 15 s each). */
export async function verifyModelarkAccess(): Promise<ProbeResult[]> {
  const limiter = new Semaphore(PROBE_CONCURRENCY);
  return Promise.all(
    modelarkProbeTargets().map(async (t) => {
      const release = await limiter.acquire();
      try {
        return await runProbe(t);
      } finally {
        release();
      }
    }),
  );
}
