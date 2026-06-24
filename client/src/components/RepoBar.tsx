import { useEffect, useState } from 'react';
import type { GitStatus, GithubStatus, SessionMeta } from '@shared/types';
import { describeGitState } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { GithubRepoPicker } from './GithubRepoPicker';

/**
 * Slim "push target" bar under the chat: connect GitHub (OAuth) and choose the repo this session
 * pushes to — without opening the New-session dialog. Hidden when the feature isn't configured
 * and no repo is attached. Attaching a repo PATCHes the session (no re-clone; push goes from the
 * existing workspace to the chosen remote).
 */
export function RepoBar({ meta, running }: { meta: SessionMeta; running: boolean }) {
  const upsertSession = useStore((s) => s.upsertSession);
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitErr, setCommitErr] = useState('');
  const enabled = status?.enabled ?? null;
  const connected = !!status?.connected;

  useEffect(() => {
    let live = true;
    const refresh = () =>
      api
        .githubStatus()
        .then((s) => live && setStatus(s))
        .catch(() => live && setStatus({ enabled: false, connected: false }));
    refresh();
    // Reflect a connect/disconnect that happened elsewhere (the Connections dialog, or the
    // OAuth return) without needing a reload — both dispatch this event.
    window.addEventListener('arksai:github-changed', refresh);
    return () => {
      live = false;
      window.removeEventListener('arksai:github-changed', refresh);
    };
  }, []);

  // Clear stale status when switching sessions so we never flash the previous repo's state.
  useEffect(() => setGit(null), [meta.id]);

  // Read the workspace's git state so the user can SEE whether code is committed & pushed.
  // Re-reads whenever a run finishes (running → false), since that's when the agent commits/pushes.
  useEffect(() => {
    if (!meta.repoUrl || running) return;
    let live = true;
    api
      .gitStatus(meta.id)
      .then((g) => live && setGit(g))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [meta.id, meta.repoUrl, running]);

  // Nothing to show: feature off AND no repo attached.
  if (enabled === false && !meta.repoUrl) return null;
  if (enabled === null && !meta.repoUrl) return null; // still resolving, no repo yet → stay quiet

  const apply = async (repoUrl: string | null, branch?: string, connectionId?: string) => {
    setBusy(true);
    try {
      const updated = await api.patchSession(meta.id, { repoUrl: repoUrl ?? '', branch, githubConnectionId: connectionId });
      upsertSession(updated);
      setOpen(false);
    } catch {
      /* surfaced via the picker's own errors / leave open */
    } finally {
      setBusy(false);
    }
  };

  // One-tap commit & push of the latest changes — deterministic, no model turn.
  const commit = async () => {
    setCommitting(true);
    setCommitErr('');
    try {
      const r = await api.gitCommit(meta.id);
      setGit(r.git);
      if (r.pushError) setCommitErr(r.pushError);
    } catch (e: any) {
      setCommitErr(e?.message ?? 'Could not commit — try again.');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="repo-bar">
      <div className="repo-bar-row">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
        {meta.repoUrl ? (
          <span className="repo-bar-target">
            Pushing to <strong>{meta.repoName ?? meta.repoUrl}</strong>
          </span>
        ) : connected ? (
          <span className="repo-bar-target">
            {open ? (
              'Choose a repo to push to'
            ) : (
              <>GitHub connected{status?.login ? <> as <strong>@{status.login}</strong></> : null} — choose a repo to push to</>
            )}
          </span>
        ) : (
          <span className="repo-bar-target muted">Connect GitHub to push this build to a repo</span>
        )}
        {meta.repoUrl && git?.hasRepo && !open && (
          (() => {
            const d = describeGitState(git);
            return (
              <span className={`repo-git ${d.tone}`} title={git.head ? `${git.head.sha} — ${git.head.subject}` : undefined}>
                {d.text}
              </span>
            );
          })()
        )}
        {meta.repoUrl && git?.hasRepo && git.dirty > 0 && !open && (
          <button
            className="repo-commit-btn"
            disabled={running || committing}
            onClick={commit}
            title={running ? 'Finish the current run first' : 'Commit all changes and push to the connected repo'}
          >
            {committing ? 'Committing…' : 'Commit & push'}
          </button>
        )}
        {enabled && (
          <button className="repo-bar-btn" disabled={running || busy} onClick={() => setOpen((v) => !v)} title={running ? 'Finish the current run first' : undefined}>
            {open ? 'Close' : meta.repoUrl ? 'Change' : connected ? 'Choose repo' : 'Connect & choose repo'}
          </button>
        )}
        {meta.repoUrl && enabled && (
          <button className="repo-bar-link" disabled={running || busy} onClick={() => apply(null)}>
            detach
          </button>
        )}
      </div>
      {commitErr && <div className="repo-bar-err">{commitErr}</div>}
      {open && enabled && (
        <div className="repo-bar-picker">
          <GithubRepoPicker compact onSelect={(sel) => sel && apply(sel.repoUrl, sel.branch, sel.connectionId)} />
        </div>
      )}
    </div>
  );
}
