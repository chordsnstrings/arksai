import { useEffect, useRef, useState } from 'react';
import { phaseCeiling } from '@shared/types';
import type { LiveState } from '../state/sessionStore';

/**
 * The live "smart-work" bar. It advertises the expert work happening at each
 * stage and — crucially — never looks frozen: it eases ("creeps") toward the
 * ceiling of the current phase band so it keeps inching forward even during the
 * genuinely silent gaps (npm install, booting), then snaps up when a real
 * progress beat arrives and glides to 100 on finish.
 */
export function ProgressBar({ live }: { live: LiveState }) {
  const [display, setDisplay] = useState(0);
  const [visible, setVisible] = useState(false);
  const raf = useRef<number | undefined>(undefined);

  // Show while running; on finish, glide to 100 then fade out.
  useEffect(() => {
    if (live.running) {
      setVisible(true);
    } else if (visible) {
      setDisplay(100);
      const t = setTimeout(() => {
        setVisible(false);
        setDisplay(0);
      }, 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.running]);

  // Creep toward the current phase ceiling so the bar is always alive.
  useEffect(() => {
    if (!live.running) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const floorTarget = live.progress?.pct ?? 0;
      const goal = Math.max(floorTarget, live.progress ? phaseCeiling(live.progress.phase) : 90);
      setDisplay((d) => {
        const base = Math.max(d, floorTarget); // snap up to confirmed progress at once
        return base >= goal ? base : base + (goal - base) * 0.02; // gentle ease toward the ceiling
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [live.running, live.progress?.pct, live.progress?.phase]);

  if (!visible) return null;
  return (
    <div className="progress-wrap">
      <div className="progress-track">
        <div className={`progress-fill ${live.running ? 'running' : 'done'}`} style={{ width: `${Math.min(100, display)}%` }} />
      </div>
      {live.running && live.progress && <div className="progress-label">{live.progress.label}</div>}
    </div>
  );
}
