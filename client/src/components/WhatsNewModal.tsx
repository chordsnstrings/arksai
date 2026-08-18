import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-08-18.75';
const KEY = `arksai_whatsnew_${WHATS_NEW_VERSION}`;

/** True if this user hasn't dismissed the current update yet. */
export function shouldShowWhatsNew(): boolean {
  try {
    return !localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

// Only the latest build's changes — keep this short (1–3 items). Replace each release.
const ITEMS: { title: string; body: string }[] = [
  {
    title: 'A brand-new look — modern Swedish design',
    body: 'The whole studio has been redrawn in a Swedish-editorial style. Light mode is “Arkiv” — warm printing-paper, ink type, hairline rules and one confident signal-red accent, laid out like a design annual. It’s calmer, more considered, and unmistakably ours — not another look-alike AI app.',
  },
  {
    title: 'A dark mode worth using — “Skymning”',
    body: 'Flip to dark and you get Skymning (“dusk”): a matte blue-slate studio with warm paper-white text and a muted brass accent — glow-free and easy on the eyes for long sessions. Toggle it any time from the moon/sun in the top-left.',
  },
  {
    title: 'New type, sharper details',
    body: 'Headlines are now set in Familjen Grotesk (a Swedish typeface), with Space Mono carrying the small editorial labels. Cleaner icons, flatter surfaces and tighter spacing throughout — same ArksAI, a lot more beautiful.',
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
        <h2 className="wn-title">Just shipped</h2>
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
