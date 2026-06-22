/**
 * Tiny DigitalOcean API client — only the droplet lifecycle the Android build
 * orchestrator needs (create from snapshot, poll, destroy, list-by-tag for the
 * orphan reaper). Plain fetch against the v2 API with the configured token.
 *
 * Stays dormant unless config.doApiToken is set; every call throws a clear error
 * if the token is missing so the orchestrator can degrade gracefully.
 */
import { config } from '../config';

const API = 'https://api.digitalocean.com/v2';

function token(): string {
  if (!config.doApiToken) throw new Error('DO_API_TOKEN is not configured');
  return config.doApiToken;
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
