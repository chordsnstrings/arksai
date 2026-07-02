import { useEffect } from 'react';
import { Icon } from './Icons.jsx';

/**
 * Accessible modal. Closes on ESC / backdrop click.
 */
export default function Modal({ title, onClose, children, foot, wide = false }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" style={wide ? { maxWidth: 720 } : undefined} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-hd">
          <h2 id="modal-title">{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}
