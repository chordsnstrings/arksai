import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-07-15.74';
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
    title: 'Your own ArksAI on Telegram',
    body: 'Hire the new "Personal ArksAI" robot — a private bot only you command. Message it like a person and it MAKES what you ask (an image, ad creative, document, spreadsheet or chart) or runs a full build (a website, video, deck or report) and sends it right back in the chat. Images arrive as real photos and videos play inline — no opaque file blobs. Connect a Telegram bot in its office and add your own chat.',
  },
  {
    title: 'It does the thing — no more "generating now…"',
    body: 'When you ask a robot to make something, it now actually produces and delivers it instead of promising to "send it in a moment." Polite requests like "can you make an image of…" go straight to the real builder, and the bot will never claim it made something it didn\'t.',
  },
  {
    title: 'Your own private bot — “claim my bot”',
    body: 'A personal chat bot (Telegram/WhatsApp/SMS) is now owner-specific: the first person to message it “claim my bot” becomes its owner, and from then on it answers only to them — everyone else is politely turned away. Once it’s yours, ask it for an image, document, spreadsheet, report, website or video and it builds and delivers it, and now tells you up front roughly how long it’ll take.',
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
