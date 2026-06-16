import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { Chat } from './Chat';
import { Composer } from './Composer';

const SEED = "Let's set up our organization's workspace.";

/**
 * Agent-driven, fully-visible organization onboarding. A new org admin lands here:
 * ArksAI runs a short, visible setup conversation (crawl the website → confirm the
 * brand + "about" → a few questions → save), which seeds the org's shared memory.
 * Reuses the normal Chat + Composer so the user watches every step. When the agent
 * finishes (org marked onboarded), `onDone` releases the gate into the studio.
 */
export function OrgOnboarding({ onDone }: { onDone: () => void }) {
  const me = useStore((s) => s.me);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const live = useStore((s) => (activeId ? s.live[activeId] : undefined));
  const setActive = useStore((s) => s.setActive);
  const upsertSession = useStore((s) => s.upsertSession);
  const loadDetail = useStore((s) => s.loadDetail);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const started = useRef(false);
  const wasRunning = useRef(false);

  const orgId = me?.currentOrg ?? null;
  const orgName = me?.orgs.find((o) => o.id === me?.currentOrg)?.name ?? 'your organization';

  // On mount: find or create the onboarding session, make it active, and (if new) kick it off.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const existing = sessions.find((s) => s.task === 'org.onboarding');
      let id = existing?.id;
      if (!id) {
        const sess = await api.createSession({ mode: 'chat', task: 'org.onboarding' } as any).catch(() => null);
        if (!sess) return;
        upsertSession(sess);
        id = sess.id;
      }
      setActive(id);
      const detail = await api.getSession(id).catch(() => null);
      if (detail) {
        loadDetail(detail);
        const hasUser = detail.timeline.some((i) => i.kind === 'user');
        if (!hasUser) {
          addUserMessage(id, SEED);
          await api.sendMessage(id, SEED).catch(() => {});
        }
      }
    })();
  }, [sessions, setActive, upsertSession, loadDetail, addUserMessage]);

  // When a run finishes, re-check onboarding status — the agent flips it via save_org_profile.
  useEffect(() => {
    const running = !!live?.running;
    if (wasRunning.current && !running) {
      api
        .me()
        .then((m) => {
          if (m.currentOrgOnboarded) onDone();
        })
        .catch(() => {});
    }
    wasRunning.current = running;
  }, [live?.running, onDone]);

  const skip = async () => {
    if (!orgId) return onDone();
    await api.patchOrgProfile(orgId, { onboardingComplete: true } as any).catch(() => {});
    onDone();
  };

  const meta = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="onb">
      <header className="onb-head">
        <span className="lp-mark">
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </span>
        <div className="onb-head-mid">
          <div className="onb-kicker">Welcome</div>
          <div className="onb-title">Let’s set up {orgName}</div>
        </div>
        <button className="onb-skip" onClick={skip} title="Skip and set this up later">
          Skip for now
        </button>
      </header>
      <p className="onb-sub">
        ArksAI will learn your brand and what you do, then tailor itself to your team — you’ll see every step.
      </p>
      <div className="onb-chat">
        {meta && live ? (
          <>
            <Chat live={live} sessionId={meta.id} />
            <Composer meta={meta} running={live.running} onOpenCommands={() => {}} onOpenMemory={() => {}} />
          </>
        ) : (
          <div className="onb-loading">Starting your setup…</div>
        )}
      </div>
    </div>
  );
}
