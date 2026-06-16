import { useState } from 'react';

// Bump this string whenever there's a new update to announce — each user sees the
// modal once per version (remembered in localStorage), so we keep people in the loop
// without nagging.
export const WHATS_NEW_VERSION = '2026-06-16.3';
const KEY = `arksai_whatsnew_${WHATS_NEW_VERSION}`;

/** True if this user hasn't dismissed the current update yet. */
export function shouldShowWhatsNew(): boolean {
  try {
    return !localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

const ITEMS: { title: string; body: string }[] = [
  {
    title: 'Tax & Compliance (UAE)',
    body: 'A new department that produces the real filing documents — VAT 201 + FAF, PINT AE e-invoices, the 9% Corporate Tax computation, Excise, and the WPS salary file — plus a guided, step-by-step wizard. Drafts for professional review; you submit via EmaraTax / your ASP / your agent bank.',
  },
  {
    title: 'Sharper reports, decks & documents',
    body: 'Full-bleed, typography-led report covers, your logo and brand carried through automatically, and publication-grade charts embedded in decks and Word docs.',
  },
  {
    title: 'Effortless file uploads',
    body: 'Drag, click, or just paste a file (or a screenshot) into the chat — the agent now notices it and reads it automatically, no extra instruction needed.',
  },
  {
    title: 'Publish & share a 24-hour preview',
    body: 'Ship a site or app to a public link anyone can open — no login needed to view. It stays live for 24 hours, then auto-deletes; re-publish any time to refresh the window.',
  },
  {
    title: 'Organization spaces with a shared brain',
    body: 'Your company gets a private workspace. A quick, agent-guided onboarding learns your brand and what you do, and that context — plus what your team builds here — is shared across your org (and never with anyone else).',
  },
  {
    title: 'Your data stays yours',
    body: 'Every workspace is strictly isolated — chats, projects, schedules, published apps, commands and memory are scoped to your organization and never visible to another. Workspaces aren’t swappable.',
  },
];

/** One-time "what's new" modal shown once per user, per version, after sign-in. */
export function WhatsNewModal({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    try {
      localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      /* private mode → just close */
    }
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={dismiss}>
      <div className="dialog wn" onClick={(e) => e.stopPropagation()}>
        <div className="wn-kicker">What’s new</div>
        <h2 className="wn-title">A few upgrades since you were last here</h2>
        <ul className="wn-list">
          {ITEMS.map((it) => (
            <li key={it.title}>
              <span className="wn-dot" />
              <div>
                <strong>{it.title}</strong>
                <p>{it.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="actions">
          <button className="send-btn" onClick={dismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
