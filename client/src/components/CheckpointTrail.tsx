import type { LiveState } from '../state/sessionStore';

/** Friendly step name: strip the machine prefixes the ledger carries. */
function stepLabel(task: string): string {
  return task
    .replace(/^checkpoint:\s*/i, '')
    .replace(/^auto:\s*verified build state$/i, 'Verified & saved')
    .replace(/^Step\s*/i, 'Step ');
}

/**
 * The visible build plan (operator ask 2026-07-02): every durable checkpoint a long build
 * commits shows up here as a completed step — the user SEES the plan advancing and knows the
 * build survives interruption. Renders only when a run is live and has checkpoints.
 */
export function CheckpointTrail({ live }: { live: LiveState }) {
  const steps = live.checkpoints;
  if (!steps.length || (!live.running && !live.completion)) return null;
  const recent = steps.slice(-5); // the trail stays compact; the count carries the rest
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 18px',
        fontSize: 12,
        color: 'var(--text-faint)',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
      aria-label="Build checkpoints"
    >
      <span style={{ fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 10.5 }}>
        Build plan
      </span>
      {steps.length > recent.length && <span>…{steps.length - recent.length} earlier</span>}
      {recent.map((s, i) => (
        <span key={s.sha + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: 'var(--ok, #17915a)', fontWeight: 700 }}>✓</span>
          <span style={{ color: 'var(--text)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stepLabel(s.task)}
          </span>
        </span>
      ))}
      {live.running && <span style={{ color: 'var(--text-faint)' }}>▸ working…</span>}
      <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
        {steps.length} saved — resumable
      </span>
    </div>
  );
}
