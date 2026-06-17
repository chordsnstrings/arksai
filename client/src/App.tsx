import { useEffect, useState } from 'react';
import { api } from './api/client';
import { useGlobalEvents, useSessionEvents } from './api/useEventStream';
import { useAutomation } from './api/useAutomation';
import { Canvas } from './components/Canvas';
import { Chat } from './components/Chat';
import { CommandsDialog } from './components/CommandsDialog';
import { MemoryDialog } from './components/MemoryDialog';
import { Composer } from './components/Composer';
import { CostBar } from './components/CostBar';
import { Landing } from './components/Landing';
import { Launchpad } from './components/Launchpad';
import { LoginScreen } from './components/LoginScreen';
import { InviteAccept } from './components/InviteAccept';
import { OperatorLogin } from './components/OperatorLogin';
import { OrgOnboarding } from './components/OrgOnboarding';
import { AdminDialog } from './components/AdminDialog';
import { NewSessionDialog } from './components/NewSessionDialog';
import { ProgressBar } from './components/ProgressBar';
import { ProjectDialog } from './components/ProjectDialog';
import { SchedulesDialog } from './components/SchedulesDialog';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { WhatsNewModal, shouldShowWhatsNew } from './components/WhatsNewModal';
import { ConfirmModal } from './components/ConfirmModal';
import { AnalyticsConsole } from './components/AnalyticsConsole';
import { useConfirm } from './state/confirmStore';
import { useStore, emptyLive } from './state/sessionStore';
import type { Project } from '@shared/types';

export default function App() {
  const authed = useStore((s) => s.authed);
  const setAuthed = useStore((s) => s.setAuthed);
  const setSessions = useStore((s) => s.setSessions);
  const setProjects = useStore((s) => s.setProjects);
  const setModels = useStore((s) => s.setModels);
  const setCommands = useStore((s) => s.setCommands);
  const setMe = useStore((s) => s.setMe);
  const me = useStore((s) => s.me);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const live = useStore((s) => (activeId ? s.live[activeId] : undefined));
  const canvasOpen = useStore((s) => s.canvasOpen);
  const navOpen = useStore((s) => s.navOpen);
  const toggleNav = useStore((s) => s.toggleNav);
  const [showNew, setShowNew] = useState<{ projectId: string | null } | null>(null);
  const [projectDialog, setProjectDialog] = useState<Project | 'new' | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);

  useEffect(() => {
    if (authed !== true) {
      api
        .listSessions()
        .then((list) => {
          setSessions(list);
          setAuthed(true);
        })
        .catch(() => setAuthed(false));
    } else {
      api.listSessions().then(setSessions).catch(() => {});
    }
  }, [authed, setAuthed, setSessions]);

  useEffect(() => {
    if (authed === true) {
      api.listModels().then(setModels).catch(() => {});
      api.listCommands().then(setCommands).catch(() => {});
      api.listProjects().then(setProjects).catch(() => {});
      api.me().then(setMe).catch(() => {});
      if (shouldShowWhatsNew()) setShowWhatsNew(true);
    }
  }, [authed, setModels, setCommands, setProjects, setMe]);

  // Deep-linkable chats: keep the URL in sync with the active session as /s/<id>, so every
  // chat has a real shareable/bookmarkable link (and reload/back-forward reopen it).
  // NOTE: deliberately NOT depending on activeId — this effect reacts only to load,
  // sessions arriving, and back/forward (popstate); the state→URL effect below owns the
  // activeId→URL direction. (Depending on activeId here ping-pongs the two into a loop.)
  useEffect(() => {
    if (authed !== true) return;
    const open = () => {
      const m = window.location.pathname.match(/^\/s\/([^/]+)$/);
      const id = m ? m[1] : null;
      const cur = useStore.getState().activeId;
      if (id) {
        if (sessions.some((s) => s.id === id) && cur !== id) setActive(id);
      } else if (cur) {
        setActive(null); // back to the launchpad when the URL has no session
      }
    };
    open();
    window.addEventListener('popstate', open);
    return () => window.removeEventListener('popstate', open);
  }, [authed, sessions, setActive]);

  useEffect(() => {
    if (authed !== true) return;
    const p = window.location.pathname;
    if (p.startsWith('/invite/') || p === '/operator' || p === '/operator/') return;
    const target = activeId ? `/s/${activeId}` : '/';
    if (p !== target) window.history.pushState({}, '', target); // guard prevents popstate loops
  }, [activeId, authed]);

  useGlobalEvents(authed === true);
  useSessionEvents(authed === true ? activeId : null);
  useAutomation(authed === true ? activeId : null);

  // Escape closes any open dialog — the standard keyboard expectation, in one place.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useConfirm.getState().opts) return; // a confirm is open — let it handle Esc
      setShowNew(null);
      setProjectDialog(null);
      setShowCommands(false);
      setShowMemory(false);
      setShowSchedules(false);
      setShowAdmin(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const inviteMatch = path.match(/^\/invite\/(.+)$/);
  if (inviteMatch) return <InviteAccept token={decodeURIComponent(inviteMatch[1])} />;
  const isOperatorPath = path === '/operator' || path === '/operator/';

  if (authed === null) return null;
  if (!authed) {
    if (isOperatorPath) return <OperatorLogin />;
    return showLogin ? (
      <LoginScreen onBack={() => setShowLogin(false)} />
    ) : (
      <Landing onSignIn={() => setShowLogin(true)} />
    );
  }

  // First-run: an org admin whose org hasn't been onboarded gets the agent-driven,
  // fully-visible setup before the studio. Members inherit the org brain silently.
  if (me && me.currentOrg && me.role === 'admin' && me.currentOrgOnboarded === false) {
    return <OrgOnboarding onDone={() => api.me().then(setMe).catch(() => {})} />;
  }

  const activeMeta = sessions.find((s) => s.id === activeId) ?? null;
  // Render the chat shell the instant a session is active — even before its detail
  // has loaded — so switching sessions never flashes the Launchpad/department picker.
  const liveOrEmpty = live ?? emptyLive();

  return (
    <div className={`app ${navOpen ? 'nav-open' : 'nav-closed'}`}>
      <Sidebar
        onNewSession={(projectId) => setShowNew({ projectId: projectId ?? null })}
        onNewProject={() => setProjectDialog('new')}
        onEditProject={(p) => setProjectDialog(p)}
        onSchedules={() => setShowSchedules(true)}
        onAdmin={() => setShowAdmin(true)}
        onAnalytics={() => setShowAnalytics(true)}
      />
      <div className="nav-backdrop" onClick={() => toggleNav(false)} />
      <div className="main">
        <button className="nav-open-btn" title="Menu" onClick={() => toggleNav(true)}>
          ☰
        </button>
        {activeMeta ? (
          <>
            <TopBar meta={activeMeta} />
            <ProgressBar live={liveOrEmpty} />
            <Chat live={liveOrEmpty} sessionId={activeMeta.id} />
            <Composer
              meta={activeMeta}
              running={liveOrEmpty.running}
              onOpenCommands={() => setShowCommands(true)}
              onOpenMemory={() => setShowMemory(true)}
            />
            <CostBar meta={activeMeta} live={liveOrEmpty} />
          </>
        ) : (
          <Launchpad onAdvanced={() => setShowNew({ projectId: null })} />
        )}
      </div>
      {canvasOpen && activeMeta && <Canvas sessionId={activeMeta.id} />}
      {showNew && <NewSessionDialog projectId={showNew.projectId} onClose={() => setShowNew(null)} />}
      {projectDialog && (
        <ProjectDialog
          project={projectDialog === 'new' ? null : projectDialog}
          onClose={() => setProjectDialog(null)}
        />
      )}
      {showCommands && <CommandsDialog onClose={() => setShowCommands(false)} />}
      {showMemory && <MemoryDialog meta={activeMeta} onClose={() => setShowMemory(false)} />}
      {showSchedules && <SchedulesDialog onClose={() => setShowSchedules(false)} />}
      {showAdmin && <AdminDialog onClose={() => setShowAdmin(false)} />}
      {showAnalytics && <AnalyticsConsole onClose={() => setShowAnalytics(false)} />}
      {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} />}
      <ConfirmModal />
    </div>
  );
}
