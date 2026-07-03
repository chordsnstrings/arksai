import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-07-03.29';
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
    title: 'Product videos that focus on YOUR product',
    body: 'Upload a photo of your product on any background — a kitchen counter, a shop shelf, anywhere — and ArksAI finds the product, removes the background, and stages it on a proper commercial set (20 backdrops, from studio white to dark luxury) before the video even starts. The clip opens on that clean staged frame, so the product in the ad is exactly yours.',
  },
  {
    title: '51 ad styles, product line-ups, and any art style',
    body: 'Every kind of product now has a full menu of director-grade ad styles — its own expert formats plus eleven universal ones, including the unboxing, shot-on-a-phone UGC, a problem→solved story arc, speed-ramp hype cuts, and zero gravity. Got a product range? Upload 2–4 photos and the whole family is cut out and staged shoulder to shoulder, hero variant center. And videos now come in 24 art styles across three families — photoreal camera looks, animated renders (3D, cartoon, anime, claymation, watercolour…), and stylized worlds (cyberpunk, synthwave, toy world…).',
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
