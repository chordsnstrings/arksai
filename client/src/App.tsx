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
import { AdminDialog } from './components/AdminDialog';
import { NewSessionDialog } from './components/NewSessionDialog';
import { ProgressBar } from './components/ProgressBar';
import { ProjectDialog } from './components/ProjectDialog';
import { SchedulesDialog } from './components/SchedulesDialog';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { useStore } from './state/sessionStore';
import type { Project } from '@shared/types';

export default function App() {
  const authed = useStore((s) => s.authed);
  const setAuthed = useStore((s) => s.setAuthed);
  const setSessions = useStore((s) => s.setSessions);
  const setProjects = useStore((s) => s.setProjects);
  const setModels = useStore((s) => s.setModels);
  const setCommands = useStore((s) => s.setCommands);
  const setMe = useStore((s) => s.setMe);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
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
    }
  }, [authed, setModels, setCommands, setProjects, setMe]);

  useGlobalEvents(authed === true);
  useSessionEvents(authed === true ? activeId : null);
  useAutomation(authed === true ? activeId : null);

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

  const activeMeta = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className={`app ${navOpen ? 'nav-open' : 'nav-closed'}`}>
      <Sidebar
        onNewSession={(projectId) => setShowNew({ projectId: projectId ?? null })}
        onNewProject={() => setProjectDialog('new')}
        onEditProject={(p) => setProjectDialog(p)}
        onSchedules={() => setShowSchedules(true)}
        onAdmin={() => setShowAdmin(true)}
      />
      <div className="nav-backdrop" onClick={() => toggleNav(false)} />
      <div className="main">
        <button className="nav-open-btn" title="Menu" onClick={() => toggleNav(true)}>
          ☰
        </button>
        {activeMeta && live ? (
          <>
            <TopBar meta={activeMeta} />
            <ProgressBar live={live} />
            <Chat live={live} sessionId={activeMeta.id} />
            <Composer
              meta={activeMeta}
              running={live.running}
              onOpenCommands={() => setShowCommands(true)}
              onOpenMemory={() => setShowMemory(true)}
            />
            <CostBar meta={activeMeta} live={live} />
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
    </div>
  );
}
