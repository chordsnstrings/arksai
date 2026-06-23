import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-06-23.2';
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
    title: 'Android Apps — richer setup + a real plan',
    body: 'The Android page now asks the right things up front: app type, a visual style kit (Material You, Minimal, Bold, Clean Pro, Dark/Premium), a fuller set of device capabilities (camera, contacts, microphone, biometrics, calendar, files, haptics, NFC and more), how it runs, whether it needs a backend, and your accent. ArksAI then plans the app with you — proposing the screens, data model and flows and asking a couple of quick questions — before the build starts.',
  },
  {
    title: 'Publish under your own Google Play account',
    body: 'Admins can connect their company’s own Google Play Developer account on the Android page, so apps publish under your name and billing — not a shared account. Direct-to-Play upload is coming next; today native builds still hand back an installable APK.',
  },
  {
    title: 'Dark mode polish',
    body: 'Fixed the Android setup screens in dark mode — inputs, option cards and labels now switch to dark correctly.',
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
