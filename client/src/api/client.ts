import type {
  CreateSessionRequest,
  PatchSessionRequest,
  SessionDetail,
  SessionMeta,
} from '@shared/types';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (password: string) =>
    request<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  listSessions: () => request<SessionMeta[]>('/api/sessions'),
  createSession: (body: CreateSessionRequest) =>
    request<SessionMeta>('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),
  getSession: (id: string) => request<SessionDetail>(`/api/sessions/${id}`),
  patchSession: (id: string, body: PatchSessionRequest) =>
    request<SessionMeta>(`/api/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSession: (id: string) => request<{ ok: true }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  sendMessage: (id: string, text: string) =>
    request<{ ok: true }>(`/api/sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  interrupt: (id: string) => request<{ ok: true }>(`/api/sessions/${id}/interrupt`, { method: 'POST' }),
  clear: (id: string) => request<{ ok: true }>(`/api/sessions/${id}/clear`, { method: 'POST' }),
};

export { ApiError };
