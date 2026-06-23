// Typed fetch wrapper for the ArksAI app backend. Attaches the JWT, prepends the
// base URL, and unwraps the backend's error envelope { error: { message, code } }
// into a thrown ApiError — so every screen calls the API the same safe way.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

const TOKEN_KEY = 'auth.token';

export async function getToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export async function setToken(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  auth?: boolean; // attach the JWT (default true)
  signal?: AbortSignal;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e: any) {
    throw new ApiError(e?.message || 'Network request failed', 'NETWORK', 0);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(err?.message || `Request failed (${res.status})`, err?.code || 'ERROR', res.status);
  }
  return data as T;
}

function safeJson(t: string): any {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
