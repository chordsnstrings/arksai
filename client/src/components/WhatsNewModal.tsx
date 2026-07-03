import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-07-03.23';
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
    title: 'Get paid — Stripe and PayPal built in',
    body: 'Apps that sell now come with real online payment. Open your app\'s Payments page, paste your Stripe or PayPal keys, and buyers can pay by card or PayPal immediately — money goes straight to your account. Every payment is verified with the provider before an order is marked paid, and until you add keys, orders are simply recorded for you to arrange payment.',
  },
  {
    title: 'Shops, bookings, and content sites',
    body: 'App building now covers commerce and services out of the box: product catalogs with a cart and secure checkout (prices always computed server-side), appointment booking with double-booking made impossible, and publishable content pages with a clean editor — all pre-verified, so your store or studio app works on the first build.',
  },
  {
    title: 'Android apps, built on rails',
    body: 'Native Android builds now start from ready-made building blocks — tab navigation, sign-in, offline data, a QR scanner — styled by a 23-piece mobile design kit. And before any build machine spins up, the app is type-checked and bundle-checked locally, so broken builds get caught in seconds, not after a ten-minute wait.',
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
