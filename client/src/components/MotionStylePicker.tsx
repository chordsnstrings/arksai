import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { MotionStyleSummary } from '../api/client';

/**
 * Visual style picker for motion videos — cards with REAL engine-rendered preview frames
 * (served by /api/motion/styles), so what you pick is exactly what the engine produces.
 * Catalog-driven: a new style pack on the server appears here with zero client changes.
 */
export function MotionStylePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [styles, setStyles] = useState<MotionStyleSummary[]>([]);
  useEffect(() => {
    api.getMotionStyles().then(setStyles).catch(() => {});
  }, []);
  if (!styles.length) return null;
  return (
    <div className="msp" role="radiogroup" aria-label="Video style">
      {styles.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          className={`msp-card ${value === s.id ? 'on' : ''}`}
          style={{ ['--msp-accent' as any]: s.accent }}
          onClick={() => onChange(s.id)}
        >
          <img src={s.previewUrl} alt="" className="msp-thumb" loading="lazy" />
          <span className="msp-name">{s.name}</span>
          <span className="msp-vibe">{s.vibe}</span>
          <span className="msp-best">{s.bestFor}</span>
        </button>
      ))}
    </div>
  );
}
