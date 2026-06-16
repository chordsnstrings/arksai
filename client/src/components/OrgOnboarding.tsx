import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrgProfile } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { Chat } from './Chat';
import { Composer } from './Composer';

const SEED = "Let's set up our organization's workspace.";

/**
 * Agent-driven organization onboarding, designed to be FINISHED — built on how
 * anticipation works: dopamine is a "seeking" signal driven by the expectation of a
 * reward that beats prediction. So we open a loop the user wants to close (a vivid
 * promise + one tiny ask), then deliver a visible payoff that over-delivers — their
 * real brand revealed live in the side panel as the agent reads it — while an endowed
 * 3-step tracker shows them already moving. The whole thing stays smooth and is fully
 * visible (the agent chat is right there), so trust and momentum build together.
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
  const [profile, setProfile] = useState<OrgProfile | null>(null);

  const orgId = me?.currentOrg ?? null;
  const orgName = me?.orgs.find((o) => o.id === me?.currentOrg)?.name ?? 'your organization';

  const refreshProfile = useCallback(() => {
    if (!orgId) return;
    api.getOrgProfile(orgId).then(setProfile).catch(() => {});
  }, [orgId]);

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
      refreshProfile();
    })();
  }, [sessions, setActive, upsertSession, loadDetail, addUserMessage, refreshProfile]);

  // After each agent turn, pull the latest brand (the reveal) and onboarding status.
  useEffect(() => {
    const running = !!live?.running;
    if (wasRunning.current && !running) {
      refreshProfile();
      api
        .me()
        .then((m) => {
          if (m.currentOrgOnboarded) onDone();
        })
        .catch(() => {});
    }
    wasRunning.current = running;
  }, [live?.running, onDone, refreshProfile]);

  // Poll the brand WHILE the agent works, so the reveal panel lights up the instant
  // it saves the palette mid-turn — peaking the surprise at the moment of discovery.
  useEffect(() => {
    if (!live?.running) return;
    const t = setInterval(refreshProfile, 1800);
    return () => clearInterval(t);
  }, [live?.running, refreshProfile]);

  const skip = async () => {
    if (!orgId) return onDone();
    await api.patchOrgProfile(orgId, { onboardingComplete: true } as any).catch(() => {});
    onDone();
  };

  const meta = sessions.find((s) => s.id === activeId) ?? null;

  const brand = profile?.branding;
  const palette = (brand?.palette ?? []).filter(Boolean).slice(0, 6);
  const hasBrand = !!(brand?.accent || palette.length);
  const hasAbout = !!profile?.about;
  const complete = !!profile?.onboardingComplete;
  // Endowed progress: step 1 is "in progress" from the very first second.
  const step = complete ? 3 : hasBrand ? (hasAbout ? 3 : 2) : 1;
  const STEPS = ['Your brand', 'Your profile', 'First build'];

  return (
    <div className="onb">
      <header className="onb-head">
        <span className="lp-mark">
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </span>
        <div className="onb-head-mid">
          <div className="onb-kicker">Welcome — let’s make it yours</div>
          <div className="onb-title">Set up {orgName}</div>
        </div>
        <button className="onb-skip" onClick={skip} title="Skip and set this up later">
          Skip for now
        </button>
      </header>

      <ol className="onb-steps" aria-label="Setup progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'active' : 'todo';
          return (
            <li key={label} className={`onb-step ${state}`}>
              <span className="onb-step-dot">{state === 'done' ? '✓' : n}</span>
              <span className="onb-step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      <p className="onb-sub">
        Share your website or drop your logo right in the chat — watch the studio turn into your brand in
        seconds, then I’ll build you something on the spot.
      </p>

      <div className="onb-stage">
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

        <aside className={`onb-reveal ${hasBrand ? 'lit' : ''}`} aria-live="polite">
          <div className="onb-reveal-kicker">{hasBrand ? '✓ Your brand' : 'Your brand'}</div>
          {hasBrand ? (
            <>
              {brand?.accent && (
                <div className="onb-accent" style={{ background: brand.accent }}>
                  <span>{brand.accent.toUpperCase()}</span>
                </div>
              )}
              {palette.length > 0 && (
                <div className="onb-swatches">
                  {palette.map((c, i) => (
                    <span
                      key={`${c}-${i}`}
                      className="onb-swatch"
                      style={{ background: c, animationDelay: `${i * 70}ms` }}
                      title={c}
                    />
                  ))}
                </div>
              )}
              {hasAbout && <p className="onb-about">“{profile!.about}”</p>}
              <div className="onb-reveal-foot">{complete ? 'Ready — let’s build.' : 'Coming together…'}</div>
            </>
          ) : (
            <div className="onb-reveal-empty">
              <div className="onb-swatches">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="onb-swatch ghost" style={{ animationDelay: `${i * 180}ms` }} />
                ))}
              </div>
              <p>Your colours appear here the moment I read your site or logo.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
