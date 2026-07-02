import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-07-02.11';
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
    title: 'A studio just for video',
    body: 'The new Video page (🎬 in the sidebar) lets you describe a shot, add spoken lines, pick the format, and generate it with synchronized sound — a quick draft first, then the full render. Clips can now run up to 15 seconds, and everything you make lands in a library you can replay any time.',
  },
  {
    title: 'Put a character in your video',
    body: 'Upload a photo of a person (or mascot) on the Video page and they star in your clip — the same face and look held throughout. Add a spoken line and they say it with lip-sync. You can also start or end the video on your own photo.',
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
