import type { TimelineItem } from '@shared/types';
import type { LiveState } from '../state/sessionStore';

/**
 * The visible build plan (operator ask, 2026-07-02). A long build announces its plan as
 * "Step N — Title" headings (and/or a numbered list) and commits a durable git checkpoint per
 * milestone. The old trail showed ONLY committed checkpoints — so mid-build, before the first
 * gate pass, it was empty even though the plan was visibly progressing in the chat. Now the trail
 * DERIVES the plan from the transcript so it appears the moment the agent posts a plan, marks each
 * step done as later steps start (or a checkpoint commits), and shows the "saved — resumable"
 * tally from the real committed checkpoints. No server change needed.
 */

type PlanStep = { n: number; title: string };
type Status = 'done' | 'active' | 'pending';

/** All assistant prose this run (finalized items + the currently-streaming message). */
function assistantText(live: LiveState): string {
  const parts: string[] = [];
  for (const it of live.items as TimelineItem[]) {
    if (it.kind === 'assistant' && it.text) parts.push(it.text);
  }
  if (live.pendingAssistant?.text) parts.push(live.pendingAssistant.text);
  return parts.join('\n');
}

const clean = (s: string) => s.replace(/[*#`_]+/g, '').trim().slice(0, 80);

/**
 * Parse an ordered step plan from the agent's text. Two signals, merged:
 *  - "Step N — Title" headings (the progress markers — appear as each step BEGINS)
 *  - a numbered plan block "1. … 2. … 3. …" (the full plan, posted up front)
 * Returns the steps and how far the agent has visibly progressed (the highest heading seen).
 */
export function derivePlan(text: string): { steps: PlanStep[]; enteredMax: number } {
  const titles = new Map<number, string>();
  let enteredMax = 0;

  const reHeading = /(?:^|\n)\s*#{0,4}\s*Step\s+(\d{1,2})\s*[—–:.\-]\s*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = reHeading.exec(text))) {
    const n = parseInt(m[1], 10);
    const title = clean(m[2]);
    if (n >= 1 && n <= 20 && title) {
      titles.set(n, title);
      if (n > enteredMax) enteredMax = n; // a heading means the agent ENTERED that step
    }
  }

  // A numbered plan block fills in steps the headings haven't reached yet. Only trust a run that
  // actually starts at 1 and is ≥3 long (so a random numbered list in prose isn't misread as a plan).
  const nums: PlanStep[] = [];
  const reNum = /(?:^|\n|,|;)\s*(\d{1,2})[.)]\s+([^\n,;]{2,80})/g;
  while ((m = reNum.exec(text))) nums.push({ n: parseInt(m[1], 10), title: clean(m[2]) });
  const seq = nums.filter((s, i) => s.n === i + 1); // keep the 1,2,3… consecutive prefix
  if (seq.length >= 3) for (const s of seq) if (!titles.has(s.n)) titles.set(s.n, s.title);

  const steps = [...titles.entries()].sort((a, b) => a[0] - b[0]).map(([n, title]) => ({ n, title }));
  return { steps, enteredMax };
}

const stepLabel = (task: string) =>
  task.replace(/^checkpoint:\s*/i, '').replace(/^auto:\s*verified build state$/i, 'Verified & saved');

export function CheckpointTrail({ live }: { live: LiveState }) {
  if (!live.running && !live.completion) return null;

  const committed = live.checkpoints.length;
  const { steps, enteredMax } = derivePlan(assistantText(live));

  // Prefer the derived plan (visible immediately); fall back to committed checkpoints only.
  const plan: { key: string; label: string; status: Status }[] = [];
  if (steps.length >= 2) {
    for (const s of steps) {
      let status: Status;
      if (s.n <= committed) status = 'done'; // a real checkpoint commit is the strongest "done"
      else if (live.running) status = s.n < enteredMax ? 'done' : s.n === enteredMax ? 'active' : 'pending';
      else status = s.n <= enteredMax ? 'done' : 'pending'; // run ended → everything entered is done
      plan.push({ key: `s${s.n}`, label: s.title, status });
    }
  } else if (committed > 0) {
    for (const c of live.checkpoints.slice(-6)) plan.push({ key: c.sha, label: stepLabel(c.task), status: 'done' });
  } else {
    return null; // nothing to show yet
  }

  const icon = (st: Status) =>
    st === 'done' ? (
      <span style={{ color: 'var(--ok, #17915a)', fontWeight: 700 }}>✓</span>
    ) : st === 'active' ? (
      <span className="spinner sm" style={{ width: 11, height: 11 }} />
    ) : (
      <span style={{ color: 'var(--text-faint)' }}>○</span>
    );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '5px 18px',
        fontSize: 12,
        color: 'var(--text-faint)',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
      aria-label="Build plan"
    >
      <span style={{ fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 10.5, flexShrink: 0 }}>
        Build plan
      </span>
      {plan.map((s, i) => (
        <span key={s.key + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {icon(s.status)}
          <span
            style={{
              color: s.status === 'pending' ? 'var(--text-faint)' : 'var(--text)',
              fontWeight: s.status === 'active' ? 600 : 400,
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {s.label}
          </span>
        </span>
      ))}
      {committed > 0 && (
        <span style={{ marginLeft: 'auto', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {committed} saved — resumable
        </span>
      )}
    </div>
  );
}
