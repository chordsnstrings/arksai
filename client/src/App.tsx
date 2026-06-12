import { useEffect, useState } from 'react';
import { api } from './api/client';
import { useGlobalEvents, useSessionEvents } from './api/useEventStream';
import { useAutomation } from './api/useAutomation';
import { Canvas } from './components/Canvas';
import { Chat } from './components/Chat';
import { CommandsDialog } from './components/CommandsDialog';
import { Composer } from './components/Composer';
import { CostBar } from './components/CostBar';
import { LoginScreen } from './components/LoginScreen';
import { NewSessionDialog } from './components/NewSessionDialog';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { useStore } from './state/sessionStore';

export default function App() {
  const authed = useStore((s) => s.authed);
  const setAuthed = useStore((s) => s.setAuthed);
  const setSessions = useStore((s) => s.setSessions);
  const setModels = useStore((s) => s.setModels);
  const setCommands = useStore((s) => s.setCommands);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const live = useStore((s) => (activeId ? s.live[activeId] : undefined));
  const canvasOpen = useStore((s) => s.canvasOpen);
  const [showNew, setShowNew] = useState(false);
  const [showCommands, setShowCommands] = useState(false);

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
    }
  }, [authed, setModels, setCommands]);

  useGlobalEvents(authed === true);
  useSessionEvents(authed === true ? activeId : null);
  useAutomation(authed === true ? activeId : null);

  if (authed === null) return null;
  if (!authed) return <LoginScreen />;

  const activeMeta = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="app">
      <Sidebar onNewSession={() => setShowNew(true)} />
      <div className="main">
        {activeMeta && live ? (
          <>
            <TopBar meta={activeMeta} />
            <Chat live={live} sessionId={activeMeta.id} />
            <Composer meta={activeMeta} running={live.running} onOpenCommands={() => setShowCommands(true)} />
            <CostBar meta={activeMeta} live={live} />
          </>
        ) : (
          <div className="empty-state">
            <div className="logo-mark" />
            <div>Start a new session to put the agent to work.</div>
            <button className="send-btn" onClick={() => setShowNew(true)}>
              New session
            </button>
          </div>
        )}
      </div>
      {canvasOpen && activeMeta && <Canvas sessionId={activeMeta.id} />}
      {showNew && <NewSessionDialog onClose={() => setShowNew(false)} />}
      {showCommands && <CommandsDialog onClose={() => setShowCommands(false)} />}
    </div>
  );
}
