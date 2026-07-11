import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-07-11.68';
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
    title: 'The Campaign bot got a brain — and it knows your market',
    body: 'Start a campaign brief and it recognises your business ("Sounds like a dental clinic"), then quotes what results really cost WHERE YOUR ADS RUN — UAE prices for UAE audiences, in dirhams too, never American numbers — and translates it into your budget ("expect roughly 4–10 leads"). Pick the countries with one tap; once you\'ve run a campaign, its real costs replace every estimate. Set a target price per lead and the robot steers toward it every 48 hours, telling you plainly what it did and why in its log.',
  },
  {
    title: 'Ads written by research, checked for honesty',
    body: 'Ad styles now follow what actually wins per industry (offers lead for restaurants and shops, proof leads for clinics and legal), every headline passes honesty and Meta-compliance checks before it can ship, and urgency like "only 6 spots left" appears ONLY when you\'ve told the robot it\'s true. Your first campaign always pauses to show you what it made — the actual images, the copy, the plan — before a single dirham is spent.',
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
