import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-07-05.43';
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
    title: 'Every video style now looks like itself',
    body: 'Each explainer style carries its own design DNA end to end — its own colours, type voice and card treatments — so a Nutshell video, a Broadcast video and a Nordic video are unmistakably different, at every size.',
  },
  {
    title: 'Designed for every frame size',
    body: 'Vertical Shorts, square and 4:5 social posts now get compositions built for their shape (not a squeezed widescreen layout), and every scene keeps living motion inside the frame — drifting texture, breathing elements, travelling accents — never a frozen slide.',
  },
  {
    title: 'Endings that land like an outro',
    body: 'Videos with a music bed now finish properly: the narration ends, the music rises and carries the final moment, then fades out gently — the voice is never cut or faded mid-word.',
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
