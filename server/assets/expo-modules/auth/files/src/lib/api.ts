// The one API client — wired to the add_app_backend contract: flat camelCase JSON,
// { error } envelope, Authorization: Bearer <jwt>. SET API_BASE to the PUBLISHED
// backend URL (https://…/apps/<slug>) before shipping.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE = 'https://example.invalid'; // ← the published backend URL

const TOKEN_KEY = 'auth.token';
export const getToken = () => AsyncStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? AsyncStorage.setItem(TOKEN_KEY, t) : AsyncStorage.removeItem(TOKEN_KEY));

async function request(path: string, opts: { method?: string; body?: unknown } = {}) {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`);
  return data;
}

export const api = {
  get: (p: string) => request(p),
  post: (p: string, body: unknown) => request(p, { method: 'POST', body }),
  patch: (p: string, body: unknown) => request(p, { method: 'PATCH', body }),
  del: (p: string) => request(p, { method: 'DELETE' }),
};
