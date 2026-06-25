import { useState } from 'react';
import type { GitStatus, SessionMeta } from '@shared/types';
import { describeGitState } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { useEscClose } from '../hooks/useEscClose';
import { GithubRepoPicker } from './GithubRepoPicker';
import { ConnectorIcon } from './ConnectorIcon';

/**
 * The composer's "Connect" surface as a modal: connect GitHub + choose the repo this session
 * pushes to (replacing the always-on repo bar), with a path to the full connectors hub. Attaching
 * a repo PATCHes the session (no re-clone; push goes from the existing workspace to the remote).
 */
export function ConnectModal({
  meta,
  git,
  onClose,
  onMore,
}: {
  meta: SessionMeta;
  git: GitStatus | null;
  onClose: () => void;
  onMore: () => void;
}) {
  useEscClose(onClose);
  const upsertSession = useStore((s) => s.upsertSession);
  const [busy, setBusy] = useState(false);

  const apply = async (repoUrl: string | null, branch?: string, connectionId?: string) => {
    setBusy(true);
    try {
      const updated = await api.patchSession(meta.id, { repoUrl: repoUrl ?? '', branch, githubConnectionId: connectionId });
      upsertSession(updated);
      window.dispatchEvent(new Event('arksai:github-changed'));
      if (repoUrl) onClose(); // picked a repo → done; detach keeps the modal open
    } catch {
      /* surfaced via the picker's own errors */
    } finally {
      setBusy(false);
    }
  };

  const state = git?.hasRepo ? describeGitState(git) : null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog connect-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cm-head">
          <ConnectorIcon size={18} />
          <h2>Connect</h2>
        </div>
        {meta.repoUrl && (
          <div className="cm-current">
            <span className="cm-current-txt">
              Pushing to <strong>{meta.repoName ?? meta.repoUrl}</strong>
            </span>
            {state && <span className={`repo-git ${state.tone}`}>{state.text}</span>}
            <button className="cm-detach" onClick={() => apply(null)} disabled={busy}>
              detach
            </button>
          </div>
        )}
        <div className="cm-body">
          <GithubRepoPicker onSelect={(sel) => sel && apply(sel.repoUrl, sel.branch, sel.connectionId)} />
        </div>
        <button
          className="cm-more"
          onClick={() => {
            onClose();
            onMore();
          }}
        >
          More connectors (email, ad platforms) →
        </button>
        <div className="actions">
          <button className="cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
