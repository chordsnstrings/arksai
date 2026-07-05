/**
 * MOTION STYLE CATALOG — the single source of truth the client picker renders from
 * (the /api/design/directions pattern). Adding a pack = kit CSS + a MOTION.md section +
 * one entry here + a preview frame rendered BY THE ENGINE into
 * server/assets/motion-kit/previews/<id>.jpg — every UI updates automatically.
 */

export interface MotionStyleInfo {
  id: 'clean' | 'nutshell' | 'broadcast' | 'vox' | 'nordic';
  name: string;
  /** One-line vibe shown on the picker card. */
  vibe: string;
  /** What briefs it suits — the picker's secondary line. */
  bestFor: string;
  /** Card accent (selection ring / chip). */
  accent: string;
  /** Experimental packs can ship hidden. */
  available: boolean;
}

export const MOTION_STYLES: MotionStyleInfo[] = [
  {
    id: 'nordic',
    name: 'Nordic',
    vibe: 'Swiss grid editorial — paper, ink, one red',
    bestFor: 'brand films, editorial explainers, typography-led pieces',
    accent: '#e32219',
    available: true,
  },
  {
    id: 'clean',
    name: 'Clean',
    vibe: 'The house style — calm, editorial, typography-first',
    bestFor: 'Product updates, internal explainers, anything understated',
    accent: '#0a7d5b',
    available: true,
  },
  {
    id: 'nutshell',
    name: 'Nutshell',
    vibe: 'Neon flat-vector science on cosmic backdrops, with a mascot',
    bestFor: 'Science, health, big-idea storytelling',
    accent: '#e30050',
    available: true,
  },
  {
    id: 'broadcast',
    name: 'Broadcast',
    vibe: 'Bright, bold infographic storytelling with shouting stat callouts',
    bestFor: 'Fast-paced facts, comparisons, listicles',
    accent: '#ffb400',
    available: true,
  },
  {
    id: 'vox',
    name: 'Vox',
    vibe: 'Annotated evidence — plates, yellow boxed labels, highlighter sweeps',
    bestFor: 'Money, policy, journalism-flavored analysis',
    accent: '#ffe600',
    available: true,
  },
];
