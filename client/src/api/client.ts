import type {
  CreateProjectRequest,
  CreateRobotRequest,
  CreateSessionRequest,
  CustomCommand,
  Deployment,
  MemoryEntry,
  ModelInfo,
  OrgProfile,
  PatchProjectRequest,
  PatchSessionRequest,
  ProcessInfo,
  Project,
  Robot,
  RobotConfig,
  RobotDraft,
  ProjectFile,
  Schedule,
  CreateScheduleRequest,
  SessionDetail,
  SessionMeta,
} from '@shared/types';

export interface PubUser {
  id: string;
  email: string;
  name: string | null;
  isSuperadmin: boolean;
}
export interface Org {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}
export interface OrgMember {
  id: string;
  userId: string;
  orgId: string;
  role: 'admin' | 'member';
  email: string;
  name: string | null;
  createdAt: number;
}
export interface EmailAccount {
  orgId: string;
  fromName: string | null;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string | null;
  enabled: boolean;
  autoReply: boolean;
  verifiedAt: number | null;
  hasSmtpPass: boolean;
  hasImapPass: boolean;
  updatedAt: number;
}
export interface EmailAccountForm {
  fromName?: string | null;
  fromEmail: string;
  smtpHost: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPass?: string | null;
  imapHost?: string | null;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string | null;
  imapPass?: string | null;
  enabled?: boolean;
  autoReply?: boolean;
}
export interface EmailVerifyResult {
  smtp: { ok: boolean; error?: string };
  imap: { ok: boolean; error?: string; skipped?: boolean };
}
export interface RobotDraftResult {
  text: string;
  model: string;
  escalate: boolean;
  reason: string;
}
export interface Lead {
  id: string;
  email: string;
  company?: string;
  role?: string;
  team?: string;
  note?: string;
  created_at: number;
}
export interface MeResponse {
  user: { id: string; email: string; name: string | null; isSuperadmin: boolean } | null;
  orgs: Org[];
  currentOrg: string | null;
  /** false → the current org hasn't completed the agent-driven onboarding yet. */
  currentOrgOnboarded?: boolean;
  role: string | null;
  isSuperadmin: boolean;
}

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
  setName: (name: string) =>
    request<{ ok: true; name: string | null }>('/api/auth/name', { method: 'POST', body: JSON.stringify({ name }) }),
  listModels: () => request<{ models: ModelInfo[] }>('/api/models').then((r) => r.models),
  // Ad-platform connectors (Settings → Connections)
  connectorsAvailable: () =>
    request<{ enabled: boolean; providers: { provider: string; label: string }[] }>('/api/connectors/available'),
  listConnectors: () =>
    request<{ connectors: { id: string; provider: string; accountId: string; accountName: string | null; status: string }[] }>('/api/connectors').then((r) => r.connectors),
  deleteConnector: (id: string) => request<{ ok: true }>(`/api/connectors/${id}`, { method: 'DELETE' }),
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
  // Session file upload with a small retry on TRANSIENT network failures only. A
  // deploy/restart blip (or a flaky connection) surfaces in the browser as a rejected
  // fetch ("Failed to fetch"); we retry those with backoff so the user never sees it. A
  // real HTTP error (413 over-limit, 404 no session) is an ApiError → thrown immediately,
  // never retried. Shared by the Composer + Launchpad attach paths.
  uploadSessionFiles: async (id: string, files: FileList | File[]) => {
    const form = new FormData();
    for (const f of Array.from(files)) form.append('files', f, f.name);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/sessions/${id}/upload`, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        });
        if (!res.ok) {
          let message = res.statusText;
          try {
            message = ((await res.json()) as any).error ?? message;
          } catch {}
          throw new ApiError(res.status, message);
        }
        return (await res.json()) as { ok: true; files: { name: string; size: number }[] };
      } catch (err) {
        if (err instanceof ApiError) throw err; // server responded → not transient
        lastErr = err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Upload failed — please try again.');
  },
  setProjectVisibility: (id: string, visibility: 'org' | 'private') =>
    request<{ ok: true; visibility: string }>(`/api/projects/${id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    }),
  listProjectMembers: (id: string) =>
    request<{ members: { userId: string; email: string }[] }>(`/api/projects/${id}/members`).then((r) => r.members),
  addProjectMember: (id: string, email: string) =>
    request<{ ok: true }>(`/api/projects/${id}/members`, { method: 'POST', body: JSON.stringify({ email }) }),
  removeProjectMember: (id: string, userId: string) =>
    request<{ ok: true }>(`/api/projects/${id}/members/${userId}`, { method: 'DELETE' }),

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

  // ---- auth / organizations ----
  me: () => request<MeResponse>('/api/auth/me'),
  loginUser: (email: string, password: string) =>
    request<{ ok: true; user: PubUser; orgs: Org[]; currentOrg: string | null; role: string | null }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  acceptInvite: (token: string, password: string, name?: string) =>
    request<{ ok: true; user: PubUser; currentOrg: string }>('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token, password, name }),
    }),
  switchOrg: (orgId: string) =>
    request<{ ok: true; currentOrg: string }>(`/api/orgs/${orgId}/switch`, { method: 'POST' }),
  getOrgProfile: (orgId: string) =>
    request<{ profile: OrgProfile }>(`/api/orgs/${orgId}/profile`).then((r) => r.profile),
  patchOrgProfile: (orgId: string, patch: Partial<OrgProfile>) =>
    request<{ ok: true; profile: OrgProfile }>(`/api/orgs/${orgId}/profile`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.profile),
  listMembers: (orgId: string) =>
    request<{ members: OrgMember[] }>(`/api/orgs/${orgId}/members`).then((r) => r.members),
  inviteMember: (orgId: string, email: string, role: 'admin' | 'member') =>
    request<{ invite: unknown; link: string }>(`/api/orgs/${orgId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  removeMember: (orgId: string, userId: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
  // ---- per-org email connection (SMTP + IMAP) ----
  getEmailAccount: (orgId: string) =>
    request<{ account: EmailAccount | null }>(`/api/orgs/${orgId}/email`).then((r) => r.account),
  saveEmailAccount: (orgId: string, body: EmailAccountForm) =>
    request<{ account: EmailAccount }>(`/api/orgs/${orgId}/email`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }).then((r) => r.account),
  testEmailAccount: (orgId: string, body: EmailAccountForm) =>
    request<{ result: EmailVerifyResult }>(`/api/orgs/${orgId}/email/test`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.result),
  deleteEmailAccount: (orgId: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/email`, { method: 'DELETE' }),
  // ---- robots ----
  listRobots: (orgId: string) =>
    request<{ robots: Robot[] }>(`/api/orgs/${orgId}/robots`).then((r) => r.robots),
  createRobot: (orgId: string, body: CreateRobotRequest) =>
    request<{ robot: Robot }>(`/api/orgs/${orgId}/robots`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.robot),
  updateRobot: (orgId: string, rid: string, patch: Partial<Robot> & { config?: RobotConfig }) =>
    request<{ robot: Robot }>(`/api/orgs/${orgId}/robots/${rid}`, { method: 'PUT', body: JSON.stringify(patch) }).then((r) => r.robot),
  deleteRobot: (orgId: string, rid: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/robots/${rid}`, { method: 'DELETE' }),
  previewRobot: (orgId: string, rid: string, sample: { from?: string; fromName?: string; subject?: string; body?: string }) =>
    request<{ outcome: { primary: RobotDraftResult; alt?: RobotDraftResult } }>(`/api/orgs/${orgId}/robots/${rid}/preview`, {
      method: 'POST',
      body: JSON.stringify(sample),
    }).then((r) => r.outcome),
  listDrafts: (orgId: string, opts?: { status?: string; robotId?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.robotId) qs.set('robotId', opts.robotId);
    const s = qs.toString();
    return request<{ drafts: RobotDraft[] }>(`/api/orgs/${orgId}/drafts${s ? `?${s}` : ''}`).then((r) => r.drafts);
  },
  editDraft: (orgId: string, did: string, text: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/drafts/${did}`, { method: 'PUT', body: JSON.stringify({ text }) }),
  sendDraft: (orgId: string, did: string, text?: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/drafts/${did}/send`, { method: 'POST', body: JSON.stringify({ text }) }),
  dismissDraft: (orgId: string, did: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/drafts/${did}/dismiss`, { method: 'POST' }),
  adminListOrgs: () => request<{ orgs: Org[] }>('/api/admin/orgs').then((r) => r.orgs),
  adminCreateOrg: (name: string, adminEmail?: string) =>
    request<{ org: Org; adminInviteLink: string | null }>('/api/admin/orgs', {
      method: 'POST',
      body: JSON.stringify({ name, adminEmail }),
    }),
  adminDeleteOrg: (id: string) =>
    request<{ ok: true; name: string; deletedUsers: number; sessions: number; projects: number; deployments: number }>(
      `/api/admin/orgs/${id}`,
      { method: 'DELETE' },
    ),
  adminListLeads: () => request<{ leads: Lead[] }>('/api/admin/leads').then((r) => r.leads),

  // ---- Analytics (operator cross-org; pass orgId for the per-org view) ----
  analyticsOverview: (orgId?: string) =>
    request<{ analytics: any }>(orgId ? `/api/orgs/${orgId}/analytics/overview` : '/api/admin/analytics/overview').then((r) => r.analytics),
  analyticsTimeseries: (days = 30, orgId?: string) =>
    request<{ timeseries: any }>(`${orgId ? `/api/orgs/${orgId}` : '/api/admin'}/analytics/timeseries?days=${days}`).then((r) => r.timeseries),
  analyticsUsage: (days = 30, orgId?: string) =>
    request<{ usage: any }>(`${orgId ? `/api/orgs/${orgId}` : '/api/admin'}/analytics/usage?days=${days}`).then((r) => r.usage),
  analyticsQuality: (days = 30, orgId?: string) =>
    request<{ quality: { status: string; count: number }[] }>(`${orgId ? `/api/orgs/${orgId}` : '/api/admin'}/analytics/quality?days=${days}`).then((r) => r.quality),
  analyticsCost: (days = 30) => request<{ cost: any }>(`/api/admin/analytics/cost?days=${days}`).then((r) => r.cost),
  analyticsRetention: (orgId?: string) =>
    request<{ retention: any[] }>(`${orgId ? `/api/orgs/${orgId}` : '/api/admin'}/analytics/retention`).then((r) => r.retention),
  analyticsFunnel: (orgId?: string) =>
    request<{ funnel: { stage: string; count: number; pct: number }[] }>(`${orgId ? `/api/orgs/${orgId}` : '/api/admin'}/analytics/funnel`).then((r) => r.funnel),
  analyticsOrgs: () => request<{ orgs: any[] }>('/api/admin/analytics/orgs').then((r) => r.orgs),
  analyticsMembers: (orgId: string) => request<{ members: any[] }>(`/api/orgs/${orgId}/analytics/members`).then((r) => r.members),
  analyticsUsers: () => request<{ users: any[] }>('/api/admin/analytics/users').then((r) => r.users),
  analyticsUserDetail: (userId: string, orgId?: string) =>
    request<{ user: any }>(orgId ? `/api/orgs/${orgId}/analytics/members/${userId}` : `/api/admin/analytics/users/${userId}`).then((r) => r.user),
  analyticsAlerts: (orgId?: string) =>
    request<{ alerts: any }>(`${orgId ? `/api/orgs/${orgId}` : '/api/admin'}/analytics/alerts`).then((r) => r.alerts),
  analyticsDigests: () => request<{ digests: any[] }>('/api/admin/analytics/digests').then((r) => r.digests),
};

export { ApiError };
