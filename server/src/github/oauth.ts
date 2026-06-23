import { config } from '../config';

/**
 * GitHub OAuth App integration: connect a user's GitHub account and push generated code to a
 * repo they choose. OAuth App (not a GitHub App) → one `repo` grant covering the user's repos
 * (documented trade-off; a GitHub App would scope to chosen repos). Pure URL/parse helpers are
 * exported for tests; the async fns do the network I/O. Tokens are encrypted at rest by the
 * caller (github/store) and never exposed to the model/UI.
 */

export const GITHUB_SCOPES = 'repo read:user';

export function githubConfigured(): boolean {
  return !!config.githubOauthClientId && !!config.githubOauthClientSecret && !!config.connectorEncKey;
}

export function callbackUrl(): string {
  return `${config.publicBaseUrl}/api/github/callback`;
}

/** The consent URL to redirect the user to. Pure. */
export function buildAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.githubOauthClientId,
    redirect_uri: callbackUrl(),
    scope: GITHUB_SCOPES,
    state,
    allow_signup: 'false',
  });
  return `https://github.com/login/oauth/authorize?${p.toString()}`;
}

/** Parse GitHub's token-exchange response body. Pure. Returns null on an error payload. */
export function parseTokenResponse(body: any): { accessToken: string; scopes: string | null } | null {
  if (!body || typeof body !== 'object' || body.error || !body.access_token) return null;
  return { accessToken: String(body.access_token), scopes: body.scope ? String(body.scope) : null };
}

export interface GithubIdentity {
  login: string;
  id: string;
  avatarUrl: string | null;
}

/** Normalize GET /user. Pure. */
export function parseIdentity(body: any): GithubIdentity | null {
  if (!body || !body.login) return null;
  return { login: String(body.login), id: String(body.id ?? ''), avatarUrl: body.avatar_url ? String(body.avatar_url) : null };
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  cloneUrl: string;
}

/** Normalize a /user/repos array → token-free repo rows the picker shows. Pure. */
export function normalizeRepos(arr: any): RepoInfo[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r) => r && r.full_name && r.permissions?.push !== false)
    .map((r) => ({
      fullName: String(r.full_name),
      private: !!r.private,
      defaultBranch: String(r.default_branch || 'main'),
      pushedAt: r.pushed_at ? String(r.pushed_at) : null,
      cloneUrl: String(r.clone_url || `https://github.com/${r.full_name}.git`),
    }));
}

const API = 'https://api.github.com';
const ua = { 'User-Agent': 'ArksAI', Accept: 'application/vnd.github+json' };

/** Exchange the OAuth `code` for an access token. */
export async function exchangeCode(code: string, signal?: AbortSignal): Promise<{ accessToken: string; scopes: string | null }> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal,
    body: JSON.stringify({
      client_id: config.githubOauthClientId,
      client_secret: config.githubOauthClientSecret,
      code,
      redirect_uri: callbackUrl(),
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  const parsed = parseTokenResponse(body);
  if (!parsed) throw new Error(`token exchange failed: ${JSON.stringify(body).slice(0, 200)}`);
  return parsed;
}

export async function getIdentity(token: string, signal?: AbortSignal): Promise<GithubIdentity> {
  const res = await fetch(`${API}/user`, { headers: { ...ua, Authorization: `Bearer ${token}` }, signal });
  const body: any = await res.json().catch(() => ({}));
  const id = parseIdentity(body);
  if (!id) throw new Error(`could not read GitHub identity (HTTP ${res.status})`);
  return id;
}

/** Repos the user can push to (owner + collaborator + org member), most-recent first. */
export async function listRepos(token: string, query: string, signal?: AbortSignal): Promise<RepoInfo[]> {
  const p = new URLSearchParams({ affiliation: 'owner,collaborator,organization_member', sort: 'pushed', per_page: '100' });
  const res = await fetch(`${API}/user/repos?${p.toString()}`, { headers: { ...ua, Authorization: `Bearer ${token}` }, signal });
  if (!res.ok) throw new Error(`could not list repos (HTTP ${res.status})`);
  let repos = normalizeRepos(await res.json().catch(() => []));
  const qy = query.trim().toLowerCase();
  if (qy) repos = repos.filter((r) => r.fullName.toLowerCase().includes(qy));
  return repos.slice(0, 100);
}

/** Create a repo under the user (or an org). Returns the new repo. */
export async function createRepo(
  token: string,
  opts: { name: string; private?: boolean; org?: string; description?: string },
  signal?: AbortSignal,
): Promise<RepoInfo> {
  const url = opts.org ? `${API}/orgs/${encodeURIComponent(opts.org)}/repos` : `${API}/user/repos`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...ua, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ name: opts.name, private: opts.private !== false, description: opts.description || 'Created with ArksAI', auto_init: true }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`could not create repo: ${body?.message || `HTTP ${res.status}`}`);
  const r = normalizeRepos([{ ...body, permissions: { push: true } }])[0];
  if (!r) throw new Error('repo created but the response was unreadable');
  return r;
}
