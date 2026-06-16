import { useConfirm } from '../state/confirmStore';
import { useEscClose } from '../hooks/useEscClose';

/** The single in-app confirm dialog (mounted once in App), driven by confirmDialog(). */
export function ConfirmModal() {
  const opts = useConfirm((s) => s.opts);
  const answer = useConfirm((s) => s.answer);
  useEscClose(() => answer(false));
  if (!opts) return null;
  return (
    <div className="dialog-backdrop" style={{ zIndex: 50 }} onClick={() => answer(false)}>
      <div className="dialog" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2>{opts.title}</h2>
        {opts.body && <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 4px' }}>{opts.body}</p>}
        <div className="actions">
          <button className="cancel" onClick={() => answer(false)}>
            Cancel
          </button>
          <button
            className="send-btn"
            style={opts.danger ? { background: 'var(--red)' } : undefined}
            onClick={() => answer(true)}
            autoFocus
          >
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
