import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-10-20.76';
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
    title: 'A new, stronger brain behind every build',
    body: 'ArksAI now runs on a new set of AI models, chosen in a blind head-to-head test on the real work our customers do — apps, reports, financial models, legal letters and chat. The winner builds noticeably better apps and formula-driven spreadsheets. Big builds may take a few minutes longer, but you will always see it working, and it switches engines by itself if one ever goes quiet.',
  },
  {
    title: 'Sharper eyes, images and video',
    body: 'Design checks now use a more exacting visual reviewer that catches contrast, clipping and overlap problems before you ever see them, and flags pages that look identical. New image and video engines make crisper visuals, and video clips come with their own synchronized sound.',
  },
  {
    title: 'Voice is taking a short break',
    body: 'Read-aloud, narrated explainer videos and voice-note replies from robots are paused while we bring on a new voice provider. Sending voice notes still works — they are transcribed as before.',
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
