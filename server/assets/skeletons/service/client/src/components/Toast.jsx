import { createContext, useCallback, useContext, useState } from 'react';
import { Icon } from './Icons.jsx';

const ToastCtx = createContext(null);

let _id = 0;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const show = useCallback((message, kind = 'success') => {
    const id = ++_id;
    setToast({ id, message, kind });
    setTimeout(() => setToast(t => (t && t.id === id ? null : t)), 2800);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
          <span className="icon"><Icon name={toast.kind === 'error' ? 'alert' : 'check'} size={16}/></span>
          {toast.message}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
