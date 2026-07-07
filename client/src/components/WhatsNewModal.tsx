import { useState } from 'react';

// Bump this string for each new BUILD we ship — each user sees the modal once per
// version (remembered in localStorage), so we keep people in the loop without nagging.
// ITEMS below describes ONLY the latest build: REPLACE the entries each release, don't
// accumulate a running changelog (that's what made the modal overflow the screen).
export const WHATS_NEW_VERSION = '2026-07-06.61';
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
    title: 'Combine messy spreadsheets into one clean workbook',
    body: 'Upload several bank statements, expense exports or monthly files and ask for one combined sheet. ArksAI now merges them deterministically: it finds each file\'s real header (even under bank preamble), matches columns by meaning across files, turns debit/credit pairs into one signed amount, fixes dates and currency formats, drops repeated headers and footer totals, removes duplicates from overlapping exports, and sorts everything by date. The delivered workbook includes an Audit sheet where live formulas re-count and re-sum every source file — the tie checks read OK, proving not a single row was lost — plus a monthly summary.',
  },
  {
    title: '28 ready-made Excel models — for every team',
    body: 'Self-checking templates for budgets vs actuals, cash runway, break-even, unit economics, NPV, depreciation, working capital, sales pipelines, commissions, marketing funnels, KPI dashboards, cohort retention, A/B tests, inventory EOQ, project budgets, headcount, personal budgets, savings goals, rental property and e-commerce P&L — all formula-driven with tie-out checks.',
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
