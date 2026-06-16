import { useEffect } from 'react';

/** Close a dialog/modal on Escape — the standard keyboard expectation that every
 *  ArksAI dialog now honours. Pass the same `onClose` used by the backdrop click. */
export function useEscClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}
