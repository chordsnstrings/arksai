/**
 * Tiny DigitalOcean API client — only the droplet lifecycle the Android build
 * orchestrator needs (create from snapshot, poll, destroy, list-by-tag for the
 * orphan reaper). Plain fetch against the v2 API with the configured token.
 *
 * Stays dormant unless config.doApiToken is set; every call throws a clear error
 * if the token is missing so the orchestrator can degrade gracefully.
 */
import { doToken } from './runtime';
import { config } from '../config';

const API = 'https://api.digitalocean.com/v2';

/**
 * MASTER-INFRA PROTECTION. The automated DO client must NEVER destroy or modify the production
 * ArksAI droplet or the baked snapshot — a bug or a future AI-driven tool passing the wrong id
 * could otherwise take the whole app down. This guard hard-refuses by id AND by name, so it's
 * belt-and-suspenders even if the id ever changes. THIS is "what the AI must not touch."
 */
export function isProtectedResource(id: number | string): boolean {
  const s = String(id);
  return s === String(config.masterDropletId) || (!!config.androidSnapshotId && s === String(config.androidSnapshotId));
}
function assertDestroyable(id: number | string): void {
  if (isProtectedResource(id)) {
    throw new Error(
      `REFUSED: ${id} is a PROTECTED production resource (the master ArksAI droplet/snapshot). ` +
        `Automated operations must never destroy or modify it — only build droplets (a distinct tag) are disposable.`,
    );
  }
}

function token(): string {
  const t = doToken();
  if (!t) throw new Error('DO_API_TOKEN is not configured');
  return t;
}

async function doFetch(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = body?.message || body?.id || `HTTP ${res.status}`;
      throw new Error(`DO API ${init.method || 'GET'} ${path}: ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

export interface DoDroplet {
  id: number;
  name: string;
  status: string; // new | active | off | archive
  networks?: { v4?: Array<{ ip_address: string; type: string }> };
}

export async function createDroplet(opts: {
  name: string;
  region: string;
  size: string;
  snapshotId: string;
  tags: string[];
  userData?: string;
  sshKeyIds?: string[];
}): Promise<DoDroplet> {
  const body: any = {
    name: opts.name,
    region: opts.region,
    size: opts.size,
    image: /^\d+$/.test(opts.snapshotId) ? Number(opts.snapshotId) : opts.snapshotId,
    tags: opts.tags,
    backups: false,
    ipv6: false,
    monitoring: false,
  };
  if (opts.userData) body.user_data = opts.userData;
  if (opts.sshKeyIds && opts.sshKeyIds.length) body.ssh_keys = opts.sshKeyIds.map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  const r = await doFetch('/droplets', { method: 'POST', body: JSON.stringify(body) });
  return r.droplet as DoDroplet;
}

export async function getDroplet(id: number | string): Promise<DoDroplet | null> {
  try {
    const r = await doFetch(`/droplets/${id}`);
    return r.droplet as DoDroplet;
  } catch (e: any) {
    if (/HTTP 404|not_found/i.test(String(e?.message))) return null;
    throw e;
  }
}

export function publicIp(d: DoDroplet | null): string | null {
  const n = d?.networks?.v4?.find((x) => x.type === 'public');
  return n?.ip_address ?? null;
}

export async function destroyDroplet(id: number | string): Promise<void> {
  // Layer 1: refuse a known-protected id outright (fast, primary).
  assertDestroyable(id);
  // Layer 2 (defense-in-depth): confirm this isn't the master by NAME/tag before deleting —
  // catches the case where the master id ever changes but its name/tag stay stable. A fetch
  // failure doesn't block a legit build-droplet cleanup (layer 1 already cleared the master id).
  try {
    const d = await getDroplet(id);
    if (d) {
      const tags = (d as any).tags as string[] | undefined;
      const isMaster = d.name === config.masterDropletName || (Array.isArray(tags) && tags.includes(config.masterDropletName) && !tags.includes('arksai-build'));
      if (isMaster) {
        throw new Error(`REFUSED: droplet ${id} ("${d.name}") is the master ArksAI production droplet — never destroyed by automation.`);
      }
    }
  } catch (e: any) {
    if (/REFUSED:/.test(String(e?.message))) throw e; // a real refusal must propagate
    /* a transient lookup failure is non-fatal: the id guard above already protects the master */
  }
  try {
    await doFetch(`/droplets/${id}`, { method: 'DELETE' });
  } catch (e: any) {
    // A 404 means it's already gone — that's the desired end state.
    if (!/HTTP 404|not_found/i.test(String(e?.message))) throw e;
  }
}

export async function listDropletsByTag(tag: string): Promise<DoDroplet[]> {
  const r = await doFetch(`/droplets?tag_name=${encodeURIComponent(tag)}&per_page=200`);
  return (r.droplets || []) as DoDroplet[];
}

export interface DoAction {
  id: number;
  status: string; // in-progress | completed | errored
  type: string;
}

/** Take a snapshot of a (powered-off) droplet. Returns the action to poll. */
export async function snapshotDroplet(id: number | string, name: string): Promise<DoAction> {
  const r = await doFetch(`/droplets/${id}/actions`, {
    method: 'POST',
    body: JSON.stringify({ type: 'snapshot', name }),
  });
  return r.action as DoAction;
}

export async function getAction(id: number | string): Promise<DoAction> {
  const r = await doFetch(`/actions/${id}`);
  return r.action as DoAction;
}

/** Snapshot ids attached to a droplet (newest snapshot is what we just took). */
export async function listDropletSnapshots(id: number | string): Promise<Array<{ id: number; name: string; created_at: string }>> {
  const r = await doFetch(`/droplets/${id}/snapshots?per_page=200`);
  return (r.snapshots || []) as Array<{ id: number; name: string; created_at: string }>;
}
