// Auth calls that mirror the backend kit's /auth routes. login/register store the
// JWT so subsequent api() calls are authenticated automatically.
import { api, setToken, getToken } from './client';

export interface User {
  id: number;
  email: string;
  name: string | null;
}

export async function register(email: string, password: string, name?: string): Promise<User> {
  const r = await api<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    auth: false,
    body: { email, password, name },
  });
  await setToken(r.token);
  return r.user;
}

export async function login(email: string, password: string): Promise<User> {
  const r = await api<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
  await setToken(r.token);
  return r.user;
}

export async function logout(): Promise<void> {
  await setToken(null);
}

/** Current user from the stored JWT, or null if not signed in / token invalid. */
export async function me(): Promise<User | null> {
  if (!(await getToken())) return null;
  try {
    const r = await api<{ user: User }>('/me');
    return r.user;
  } catch {
    await setToken(null); // token rejected → clear it
    return null;
  }
}
