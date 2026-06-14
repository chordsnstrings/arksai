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
import { Launchpad } from './components/Launchpad';
import { LoginScreen } from './components/LoginScreen';
import { NewSessionDialog } from './components/NewSessionDialog';
import { ProgressBar } from './components/ProgressBar';
import { ProjectDialog } from './components/ProjectDialog';
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
    }
  }, [authed, setModels, setCommands, setProjects]);

  useGlobalEvents(authed === true);
  useSessionEvents(authed === true ? activeId : null);
  useAutomation(authed === true ? activeId : null);

  if (authed === null) return null;
  if (!authed) return <LoginScreen />;

  const activeMeta = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className={`app ${navOpen ? 'nav-open' : 'nav-closed'}`}>
      <Sidebar
        onNewSession={(projectId) => setShowNew({ projectId: projectId ?? null })}
        onNewProject={() => setProjectDialog('new')}
        onEditProject={(p) => setProjectDialog(p)}
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
    </div>
  );
}
