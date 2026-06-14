import type {
  CreateProjectRequest,
  CreateSessionRequest,
  CustomCommand,
  Deployment,
  MemoryEntry,
  ModelInfo,
  PatchProjectRequest,
  PatchSessionRequest,
  ProcessInfo,
  Project,
  ProjectFile,
  Schedule,
  CreateScheduleRequest,
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
  // Only send a JSON content-type when there's actually a body — otherwise
  // Fastify rejects an empty JSON body with 400 (this broke DELETE).
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
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
  submitLead: (lead: { email: string; company?: string; role?: string; team?: string; note?: string }) =>
    request<{ ok: true }>('/api/leads', { method: 'POST', body: JSON.stringify(lead) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  listModels: () => request<{ models: ModelInfo[] }>('/api/models').then((r) => r.models),
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
  diff: (id: string) => request<{ diff: string }>(`/api/sessions/${id}/diff`),
  verify: (id: string) => request<{ report: string }>(`/api/sessions/${id}/verify`),
  tree: (id: string) => request<{ files: string[] }>(`/api/sessions/${id}/tree`),
  processes: (id: string) => request<{ processes: ProcessInfo[] }>(`/api/sessions/${id}/processes`),
  ports: (id: string) => request<{ ports: number[] }>(`/api/sessions/${id}/ports`).then((r) => r.ports),
  killProcess: (id: string, pid: string) =>
    request<{ ok: true; killed: boolean }>(`/api/sessions/${id}/processes/${pid}/kill`, { method: 'POST' }),
  listCommands: () => request<{ commands: CustomCommand[] }>('/api/commands').then((r) => r.commands),
  putCommand: (name: string, description: string, template: string) =>
    request<CustomCommand>(`/api/commands/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ description, template }),
    }),
  deleteCommand: (name: string) => request<{ ok: true }>(`/api/commands/${name}`, { method: 'DELETE' }),
  listMemory: (scope?: string) =>
    request<{ memory: MemoryEntry[] }>(`/api/memory${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`).then(
      (r) => r.memory,
    ),
  addMemory: (scope: string, text: string) =>
    request<MemoryEntry>('/api/memory', { method: 'POST', body: JSON.stringify({ scope, text }) }),
  deleteMemory: (id: string) => request<{ ok: true }>(`/api/memory/${id}`, { method: 'DELETE' }),

  // ---- projects ----
  listProjects: () => request<{ projects: Project[] }>('/api/projects').then((r) => r.projects),
  createProject: (body: CreateProjectRequest) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  patchProject: (id: string, body: PatchProjectRequest) =>
    request<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  listProjectFiles: (id: string) =>
    request<{ files: ProjectFile[] }>(`/api/projects/${id}/files`).then((r) => r.files),
  uploadProjectFiles: (id: string, files: FileList | File[]) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('file', f);
    return fetch(`/api/projects/${id}/files`, { method: 'POST', credentials: 'same-origin', body: fd }).then(
      async (r) => {
        if (!r.ok) throw new ApiError(r.status, ((await r.json().catch(() => ({}))) as any).error ?? r.statusText);
        return (await r.json()) as { ok: true; files: ProjectFile[] };
      },
    );
  },
  deleteProjectFile: (id: string, fileId: string) =>
    request<{ ok: true }>(`/api/projects/${id}/files/${fileId}`, { method: 'DELETE' }),

  // ---- deployments ----
  listDeployments: (sessionId?: string) =>
    request<{ deployments: Deployment[] }>(
      `/api/deployments${sessionId ? `?sessionId=${sessionId}` : ''}`,
    ).then((r) => r.deployments),
  publish: (sessionId: string, name?: string) =>
    request<Deployment>(`/api/sessions/${sessionId}/publish`, { method: 'POST', body: JSON.stringify({ name }) }),
  stopDeployment: (slug: string) =>
    request<Deployment>(`/api/deployments/${slug}/stop`, { method: 'POST' }),
  restartDeployment: (slug: string) =>
    request<Deployment>(`/api/deployments/${slug}/restart`, { method: 'POST' }),
  deleteDeployment: (slug: string) => request<{ ok: true }>(`/api/deployments/${slug}`, { method: 'DELETE' }),

  // ---- scheduled / recurring tasks ----
  listSchedules: () => request<{ schedules: Schedule[] }>('/api/schedules').then((r) => r.schedules),
  createSchedule: (body: CreateScheduleRequest) =>
    request<Schedule>('/api/schedules', { method: 'POST', body: JSON.stringify(body) }),
  toggleSchedule: (id: string, enabled: boolean) =>
    request<{ ok: true }>(`/api/schedules/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  deleteSchedule: (id: string) => request<{ ok: true }>(`/api/schedules/${id}`, { method: 'DELETE' }),
};

export { ApiError };
