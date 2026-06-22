import { useEffect, useRef, useState } from 'react';
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
import { VerticalPage, verticalSlugs } from './components/VerticalPage';
import { FeaturesPage } from './components/FeaturesPage';
import { ResearchHub, ResearchArticle } from './components/Research';
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
import { Robots } from './components/Robots';
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
  // Robots: the separate, full-page agentic surface. Linkable at /robots; opening it pushes the
  // URL so it's a real shareable destination, and back/forward toggle it.
  const [showRobots, setShowRobots] = useState(
    typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === '/robots',
  );
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  // A deep link (/s/<id>) that resolved to a session we can't open (deleted / no
  // access). We keep the URL and show an explicit panel instead of silently
  // dumping the user on the Launchpad. The ref dedupes the one-shot resolve per id.
  const [deepLinkNotFound, setDeepLinkNotFound] = useState(false);
  const deepLinkTried = useRef<string | null>(null);
  // The state→URL effect must NOT clobber an as-yet-unresolved /s/<id> on first paint
  // (the 404 lands async, after this effect's first run) — so it skips the clear-to-'/'
  // exactly once at boot, then behaves normally.
  const didInitialUrlSync = useRef(false);

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
  // NOTE: this resolves the URL on load + back/forward ONLY — it deliberately does NOT
  // depend on `sessions` or `activeId`. Re-running it on a sessions-change would re-read a
  // stale URL right after a delete and falsely 404 the just-deleted session; instead we
  // read sessions fresh via getState() and let the state→URL effect own activeId→URL.
  useEffect(() => {
    if (authed !== true) return;
    const resolve = (id: string) => {
      const st = useStore.getState();
      // Already loaded (first page / opened before): just activate it.
      if (st.sessions.some((s) => s.id === id)) {
        if (st.activeId !== id) setActive(id);
        setDeepLinkNotFound(false);
        return;
      }
      // Not in the loaded list — an older session past the first page, or one we
      // can't access. Resolve it directly; on 404 show the not-available panel.
      if (deepLinkTried.current === id) return;
      deepLinkTried.current = id;
      api
        .getSession(id)
        .then((detail) => {
          const store = useStore.getState();
          store.upsertSession(detail.meta);
          store.loadDetail(detail);
          setActive(id);
          setDeepLinkNotFound(false);
        })
        .catch(() => setDeepLinkNotFound(true));
    };
    const m = window.location.pathname.match(/^\/s\/([^/]+)$/);
    if (m) resolve(m[1]);
    // Back/forward: follow the URL, including clearing to the launchpad.
    const onPop = () => {
      setShowRobots(window.location.pathname.replace(/\/$/, '') === '/robots');
      const mm = window.location.pathname.match(/^\/s\/([^/]+)$/);
      if (mm) resolve(mm[1]);
      else {
        if (useStore.getState().activeId) setActive(null);
        setDeepLinkNotFound(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [authed, setActive]);

  useEffect(() => {
    if (authed !== true) return;
    if (showRobots) return; // the Robots surface owns the URL (/robots) while it's open
    const p = window.location.pathname;
    if (p.startsWith('/invite/') || p === '/operator' || p === '/operator/') return;
    // A real session is open → any earlier "not available" deep link is moot.
    if (activeId && deepLinkNotFound) setDeepLinkNotFound(false);
    // Don't erase a not-found deep link's URL — keep it so the user can copy/retry;
    // only the explicit "Start a new chat" CTA clears it.
    if (deepLinkNotFound && !activeId) return;
    // First run at boot with nothing active yet: a deep link may still be resolving
    // (its 404 is async) — skip the clear-to-'/' this once so we never clobber it.
    if (!didInitialUrlSync.current && !activeId) {
      didInitialUrlSync.current = true;
      return;
    }
    didInitialUrlSync.current = true;
    const target = activeId ? `/s/${activeId}` : '/';
    if (p !== target) window.history.pushState({}, '', target); // guard prevents popstate loops
  }, [activeId, authed, deepLinkNotFound, showRobots]);

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

  const forMatch = path.match(/^\/for\/([a-z-]+)\/?$/);
  const researchMatch = path.match(/^\/research\/([a-z0-9-]+)\/?$/);
  const isResearchHub = path === '/research' || path === '/research/';
  const isFeatures = path === '/features' || path === '/features/';

  if (authed === null) return null;
  if (!authed) {
    if (isOperatorPath) return <OperatorLogin />;
    if (showLogin) return <LoginScreen onBack={() => setShowLogin(false)} />;
    // Public marketing pages (shareable, server-side OG meta + JSON-LD).
    if (isFeatures) return <FeaturesPage onSignIn={() => setShowLogin(true)} />;
    if (researchMatch) return <ResearchArticle slug={researchMatch[1]} onSignIn={() => setShowLogin(true)} />;
    if (isResearchHub) return <ResearchHub onSignIn={() => setShowLogin(true)} />;
    // Public per-vertical marketing pages (shareable, server-side OG meta).
    if (forMatch && verticalSlugs().includes(forMatch[1]))
      return <VerticalPage slug={forMatch[1]} onSignIn={() => setShowLogin(true)} />;
    return <Landing onSignIn={() => setShowLogin(true)} />;
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

  // Clear a not-found deep link and return to the Launchpad on the user's say-so.
  const dismissDeepLink = () => {
    deepLinkTried.current = null;
    setDeepLinkNotFound(false);
    setActive(null);
    window.history.pushState({}, '', '/');
  };

  return (
    <div className={`app ${navOpen ? 'nav-open' : 'nav-closed'}`}>
      <Sidebar
        onNewSession={(projectId) => setShowNew({ projectId: projectId ?? null })}
        onNewProject={() => setProjectDialog('new')}
        onEditProject={(p) => setProjectDialog(p)}
        onSchedules={() => setShowSchedules(true)}
        onRobots={() => {
          setShowRobots(true);
          window.history.pushState({}, '', '/robots');
        }}
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
        ) : deepLinkNotFound ? (
          <div className="deeplink-missing">
            <div className="dm-card">
              <div className="dm-eyebrow">Chat unavailable</div>
              <div className="dm-title">This chat isn’t available</div>
              <p className="dm-body">
                It may have been deleted, or you don’t have access to it. The link still works for
                anyone it was shared with who has access.
              </p>
              <button className="dm-cta" onClick={dismissDeepLink}>
                Start a new chat
              </button>
            </div>
          </div>
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
      {showRobots && (
        <Robots
          onClose={() => {
            setShowRobots(false);
            const back = useStore.getState().activeId;
            window.history.pushState({}, '', back ? `/s/${back}` : '/');
          }}
        />
      )}
      {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} />}
      <ConfirmModal />
    </div>
  );
}
