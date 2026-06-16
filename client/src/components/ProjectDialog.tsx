import { useEffect, useState } from 'react';
import type { ModelId, Project, ProjectFile, SessionMode } from '@shared/types';
import { FALLBACK_MODEL_IDS, modelLabel } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { confirmDialog } from '../state/confirmStore';

export function ProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const models = useStore((s) => s.models);
  const modelIds = models.length ? models.map((m) => m.id) : FALLBACK_MODEL_IDS;
  const upsertProject = useStore((s) => s.upsertProject);
  const removeProject = useStore((s) => s.removeProject);

  const [name, setName] = useState(project?.name ?? '');
  const [instructions, setInstructions] = useState(project?.instructions ?? '');
  const [repoUrl, setRepoUrl] = useState(project?.defaultRepoUrl ?? '');
  const [branch, setBranch] = useState(project?.defaultBranch ?? '');
  const [mode, setMode] = useState<SessionMode | ''>(project?.defaultMode ?? '');
  const [model, setModel] = useState<ModelId | ''>(project?.defaultModel ?? '');
  const [accent, setAccent] = useState(project?.branding?.accent ?? '#2c6e63');
  const [logoName, setLogoName] = useState(project?.branding?.logoName ?? '');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visibility, setVisibility] = useState<'org' | 'private'>(project?.visibility ?? 'org');
  const [members, setMembers] = useState<{ userId: string; email: string }[]>([]);
  const [shareEmail, setShareEmail] = useState('');

  useEffect(() => {
    if (project) {
      api.listProjectFiles(project.id).then(setFiles).catch(() => {});
      api.listProjectMembers(project.id).then(setMembers).catch(() => {});
    }
  }, [project]);

  const changeVisibility = async (v: 'org' | 'private') => {
    setVisibility(v);
    if (!project) return;
    try {
      await api.setProjectVisibility(project.id, v);
      upsertProject({ ...project, visibility: v });
    } catch (e: any) {
      setError(e?.message ?? 'Could not change visibility.');
    }
  };
  const addShare = async () => {
    if (!project || !shareEmail.trim()) return;
    try {
      await api.addProjectMember(project.id, shareEmail.trim());
      setShareEmail('');
      setMembers(await api.listProjectMembers(project.id));
    } catch (e: any) {
      setError(e?.message ?? 'Could not add that person.');
    }
  };
  const removeShare = async (uid: string) => {
    if (!project) return;
    await api.removeProjectMember(project.id, uid).catch(() => {});
    setMembers((c) => c.filter((m) => m.userId !== uid));
  };

  const branding = () => ({
    accent: accent || undefined,
    logoName: logoName || undefined,
  });

  const save = async () => {
    if (!name.trim()) {
      setError('A project name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        instructions,
        defaultRepoUrl: repoUrl.trim() || null,
        defaultBranch: branch.trim() || null,
        ...(mode ? { defaultMode: mode } : {}),
        ...(model ? { defaultModel: model } : {}),
        branding: branding(),
      };
      let saved: Project;
      if (project) {
        saved = await api.patchProject(project.id, payload as any);
      } else {
        saved = await api.createProject({
          name: payload.name,
          instructions,
          defaultRepoUrl: repoUrl.trim() || undefined,
          defaultBranch: branch.trim() || undefined,
          ...(mode ? { defaultMode: mode } : {}),
          ...(model ? { defaultModel: model } : {}),
          branding: branding(),
        });
        if (pending.length) {
          await api.uploadProjectFiles(saved.id, pending);
          saved = await api.getProject(saved.id);
        }
      }
      upsertProject(saved);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save project');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!project) return;
    if (!(await confirmDialog({ title: 'Delete this project?', body: `“${project.name}” will be removed. Its sessions are kept (detached).`, confirmLabel: 'Delete', danger: true }))) return;
    setBusy(true);
    try {
      await api.deleteProject(project.id);
      removeProject(project.id);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete');
      setBusy(false);
    }
  };

  // Knowledge uploads. In edit mode upload immediately; in create mode hold them
  // until the project exists.
  const [pending, setPending] = useState<File[]>([]);
  const onPick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    if (project) {
      setBusy(true);
      try {
        const r = await api.uploadProjectFiles(project.id, list);
        setFiles(r.files);
      } catch (err: any) {
        setError(err?.message ?? 'Upload failed');
      } finally {
        setBusy(false);
      }
    } else {
      setPending((p) => [...p, ...Array.from(list)]);
    }
  };
  const delFile = async (f: ProjectFile) => {
    if (!project) return;
    await api.deleteProjectFile(project.id, f.id).catch(() => {});
    setFiles((cur) => cur.filter((x) => x.id !== f.id));
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>{project ? 'Project settings' : 'New project'}</h2>

        <div>
          <label>Name</label>
          <input placeholder="e.g. GIC Migration Intelligence" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label>Custom instructions — applied to every session in this project</label>
          <textarea
            rows={4}
            placeholder="Who this is for, tone, rules (e.g. audience is investors; never fabricate figures)…"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>

        <div className="row">
          <div>
            <label>Default repo (optional)</label>
            <input placeholder="owner/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
          </div>
          <div>
            <label>Default branch</label>
            <input placeholder="default branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
        </div>

        <div className="row">
          <div>
            <label>Default mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as SessionMode | '')}>
              <option value="">— none —</option>
              <option value="code">Code</option>
              <option value="plan">Plan</option>
              <option value="chat">Chat</option>
              <option value="report">Report</option>
            </select>
          </div>
          <div>
            <label>Default model</label>
            <select value={model} onChange={(e) => setModel(e.target.value as ModelId | '')}>
              <option value="">— none —</option>
              {modelIds.map((id) => (
                <option key={id} value={id}>
                  {modelLabel(id)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div>
            <label>Brand accent</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 40, padding: 0 }} />
              <input value={accent} onChange={(e) => setAccent(e.target.value)} style={{ flex: 1 }} />
            </div>
          </div>
          <div>
            <label>Logo (from knowledge)</label>
            <select value={logoName} onChange={(e) => setLogoName(e.target.value)}>
              <option value="">— none —</option>
              {files.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {project && (
          <div>
            <label>Who can see this project</label>
            <select value={visibility} onChange={(e) => changeVisibility(e.target.value as 'org' | 'private')}>
              <option value="org">Everyone in the organization</option>
              <option value="private">Private — only me + people I add</option>
            </select>
            {visibility === 'private' && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    placeholder="Share with a member's email"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="canvas-btn" onClick={addShare}>
                    Add
                  </button>
                </div>
                <div className="kb-list" style={{ marginTop: 6 }}>
                  {members.map((m) => (
                    <div key={m.userId} className="kb-row">
                      <span className="kb-name">{m.email}</span>
                      <button className="kb-del" title="Remove" onClick={() => removeShare(m.userId)}>
                        ✕
                      </button>
                    </div>
                  ))}
                  {members.length === 0 && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: 4 }}>Only you can see this project.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label>Knowledge files — available to every session in this project</label>
          <div className="kb-list">
            {project &&
              files.map((f) => (
                <div key={f.id} className="kb-row">
                  <span className="kb-name">{f.name}</span>
                  <button className="kb-del" title="Remove" onClick={() => delFile(f)}>
                    ✕
                  </button>
                </div>
              ))}
            {!project &&
              pending.map((f, i) => (
                <div key={i} className="kb-row">
                  <span className="kb-name">{f.name}</span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>pending</span>
                </div>
              ))}
            {(project ? files.length === 0 : pending.length === 0) && (
              <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '4px 2px' }}>
                No knowledge files yet.
              </div>
            )}
          </div>
          <label className="file-pick">
            <input type="file" multiple style={{ display: 'none' }} onChange={(e) => onPick(e.target.files)} />
            + Add files
          </label>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}

        <div className="actions">
          {project && (
            <button className="cancel" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          <button className="cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="send-btn" onClick={save} disabled={busy}>
            {busy ? '…' : project ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
