import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider } from './components/Toast.jsx';
import AppShell from './components/AppShell.jsx';
import Auth from './pages/Auth.jsx';
import { PAGES } from './modules.gen.js';

function Root() {
  const { user, ready } = useAuth();
  const [page, setPage] = useState(PAGES[0].key);
  if (!ready) return <div className="page"><div className="empty loading">Loading…</div></div>;
  if (!user) return <Auth />;
  const Current = (PAGES.find((p) => p.key === page) || PAGES[0]).component;
  return (
    <AppShell page={page} onNavigate={setPage} pages={PAGES}>
      <Current />
    </AppShell>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ToastProvider>
  );
}
