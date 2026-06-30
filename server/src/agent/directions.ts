// Curated, tested DESIGN DIRECTIONS — 40 complete modern recipes (a layout archetype + a font trio +
// an accent + a signature), each validated on a real model. Richer + bolder than the smooth-only
// `looks`: the agent picks ONE that fits the SUBJECT so output is modern + varied, never templated.
// Injected (compact menu) into the design context for visual tasks, gated by config.directionLibrary.

export type DirectionGroup = 'modern' | 'glass' | 'structural' | 'aesthetic';

export interface Direction {
  id: string;
  group: DirectionGroup;
  name: string;
  mood: string;
  display: string; // display / heading font
  body: string;    // UI / body font
  data: string;    // mono "data" face (eyebrows, labels, numbers)
  accent: string;  // primary accent hex
  dark: boolean;
  signature: string; // the distinctive archetype / treatment in one phrase
}

// Google-Fonts CSS2 `family=` fragments, axes validated to return real @font-face.
const FONT_FRAG: Record<string, string> = {
  Inter: 'Inter:wght@400;500;600;700',
  'Space Grotesk': 'Space+Grotesk:wght@400;500;700',
  Sora: 'Sora:wght@400;500;600;700',
  Outfit: 'Outfit:wght@400;500;600;700',
  'Plus Jakarta Sans': 'Plus+Jakarta+Sans:wght@400;500;600;700',
  Manrope: 'Manrope:wght@400;500;600;700',
  Quicksand: 'Quicksand:wght@400;500;600;700',
  Nunito: 'Nunito:wght@400;600;700;800',
  Unbounded: 'Unbounded:wght@400;600;700',
  'Bricolage Grotesque': 'Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700',
  'Bodoni Moda': 'Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;0,6..96,600;1,6..96,400',
  'IBM Plex Mono': 'IBM+Plex+Mono:wght@400;500',
  'JetBrains Mono': 'JetBrains+Mono:wght@400;500;700',
  'Space Mono': 'Space+Mono:wght@400;700',
};

/** Build the exact Google-Fonts <link> href that loads a direction's font trio. */
export function directionFontsLink(d: Direction): string {
  const frags: string[] = [];
  const seen = new Set<string>();
  for (const key of [d.display, d.body, d.data]) {
    const f = FONT_FRAG[key];
    if (f && !seen.has(f)) { seen.add(f); frags.push(f); }
  }
  return `https://fonts.googleapis.com/css2?family=${frags.join('&family=')}&display=swap`;
}

export const DIRECTIONS: Direction[] = [
  // ---------------- MODERN PRODUCT ARCHETYPES ----------------
  { id: 'linear', group: 'modern', name: 'Linear Dark', mood: 'dark product dashboard, indigo glow', display: 'Space Grotesk', body: 'Inter', data: 'JetBrains Mono', accent: '#6e6bf2', dark: true, signature: 'progress ring + stat tiles + sparkline + springy switch toggles on near-black with a faint indigo glow' },
  { id: 'bento', group: 'modern', name: 'Apple Bento', mood: 'light modular grid', display: 'Inter', body: 'Inter', data: 'Space Mono', accent: '#0a84ff', dark: false, signature: 'a 2-col grid of rounded tiles of varying sizes, big numerals, soft depth shadows' },
  { id: 'glass', group: 'modern', name: 'Aurora Glass', mood: 'vibrant frosted glass', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#5fe0d8', dark: true, signature: 'frosted glass cards over a vivid aurora gradient mesh, glowing toggles' },
  { id: 'vercel', group: 'modern', name: 'Vercel Mono', mood: 'stark monochrome', display: 'Inter', body: 'Inter', data: 'JetBrains Mono', accent: '#000000', dark: false, signature: 'razor-clean black/white, a huge mono focal metric, thin bar, engineered restraint' },
  { id: 'arc', group: 'modern', name: 'Arc Playful', mood: 'friendly gradient', display: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', data: 'Space Mono', accent: '#6d5cff', dark: false, signature: 'a colorful indigo→pink gradient hero, big rounded tap-targets, springy checks' },
  { id: 'stripe', group: 'modern', name: 'Stripe Clean', mood: 'fintech SaaS', display: 'Inter', body: 'Inter', data: 'IBM Plex Mono', accent: '#635bff', dark: false, signature: 'a subtle gradient progress bar, a segmented control, a mini bar-chart, soft elevation' },
  { id: 'notion', group: 'modern', name: 'Notion Clean', mood: 'neutral workspace', display: 'Inter', body: 'Inter', data: 'IBM Plex Mono', accent: '#2383e2', dark: false, signature: 'a calm doc-like canvas, callout blocks, database-row lists with soft hover' },
  { id: 'raycast', group: 'modern', name: 'Raycast', mood: 'command-bar dark', display: 'Inter', body: 'Inter', data: 'JetBrains Mono', accent: '#ff6363', dark: true, signature: 'a prominent ⌘K command/add bar, command-row list, snappy dark vivid' },
  { id: 'spotify', group: 'modern', name: 'Bold Media', mood: 'bold dark media', display: 'Sora', body: 'Inter', data: 'Space Mono', accent: '#1ed760', dark: true, signature: 'big bold titles, chunky circular play-style buttons, high-energy dark' },
  { id: 'things', group: 'modern', name: 'Calm Tasks', mood: 'warm minimal zen', display: 'Inter', body: 'Inter', data: 'IBM Plex Mono', accent: '#2e7bff', dark: false, signature: 'one calm column, generous whitespace, soft round checkboxes, premium-minimal' },
  { id: 'framer', group: 'modern', name: 'Framer Bold', mood: 'bold gradient', display: 'Unbounded', body: 'Inter', data: 'JetBrains Mono', accent: '#7c5cff', dark: true, signature: 'an oversized Unbounded hero + a giant gradient focal number, launch-energy' },
  { id: 'swiss', group: 'modern', name: 'Swiss Grid', mood: 'international typographic', display: 'Inter', body: 'Inter', data: 'Space Mono', accent: '#e8482b', dark: false, signature: 'a strict grid, thin black rules, huge display ratio, mono index numbers, no shadows' },
  { id: 'superhuman', group: 'modern', name: 'Premium Dense', mood: 'jewel-dark premium', display: 'Inter', body: 'Inter', data: 'JetBrains Mono', accent: '#8a7bff', dark: true, signature: 'a dense, refined list with small row height + keyboard hints, density done elegantly' },
  { id: 'figma', group: 'modern', name: 'Multicolor Tool', mood: 'light creative tool', display: 'Inter', body: 'Inter', data: 'Space Mono', accent: '#0d99ff', dark: false, signature: 'a multi-segment progress, items each carry their own accent color, clean toolbar feel' },
  { id: 'editorialmod', group: 'modern', name: 'Modern Magazine', mood: 'bold sans editorial', display: 'Bricolage Grotesque', body: 'Inter', data: 'Space Mono', accent: '#ff5230', dark: false, signature: 'a BIG bold Bricolage display headline + one hot accent — editorial via type, not a masthead' },
  { id: 'terminal', group: 'modern', name: 'Terminal CLI', mood: 'dark mono terminal', display: 'JetBrains Mono', body: 'JetBrains Mono', data: 'JetBrains Mono', accent: '#39ff8a', dark: true, signature: 'a prompt header, an ASCII [#####-----] meter, [x]/[ ] rows, command-line input — crisp modern terminal' },
  { id: 'neubrutal', group: 'modern', name: 'Neo-Brutalist', mood: 'bold flat blocks', display: 'Space Grotesk', body: 'Inter', data: 'Space Mono', accent: '#ffd23f', dark: false, signature: 'thick black borders, hard offset drop-shadows, flat bright color blocks, chunky type' },
  { id: 'fintech', group: 'modern', name: 'Fintech Dense', mood: 'data-dark trading', display: 'Inter', body: 'Inter', data: 'JetBrains Mono', accent: '#2ee6a6', dark: true, signature: 'a dense KPI strip with up/down deltas, a sparkline, a tight data-table with a heat row' },
  // ---------------- GLASSMORPHISM LEVELS ----------------
  { id: 'glass-clear', group: 'glass', name: 'Clear Glass', mood: 'subtle light glass', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#2e7bff', dark: false, signature: 'a whisper of frost — blur(8px), mostly opaque white cards on a soft light gradient mesh' },
  { id: 'glass-frost', group: 'glass', name: 'Frosted Glass', mood: 'classic frosted', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#7b5cff', dark: false, signature: 'textbook frosted cards — blur(16px) on a warm peach→lavender→blue gradient' },
  { id: 'glass-heavy', group: 'glass', name: 'Heavy Frost', mood: 'cloudy dark glass', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#6ee7ff', dark: true, signature: 'thick cloudy frost — blur(32px), low-opacity cards on a dark moody mesh' },
  { id: 'glass-aurora', group: 'glass', name: 'Aurora Vibrant', mood: 'vibrant glow glass', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#5fe0d8', dark: true, signature: 'glowing glass over a saturated indigo/magenta/teal aurora mesh' },
  { id: 'glass-liquid', group: 'glass', name: 'Liquid Glass', mood: 'Apple 2025 specular', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#0a84ff', dark: false, signature: 'glossy specular Liquid-Glass — bright top edge, lens highlights, radius 28px over a soft colorful wallpaper' },
  { id: 'glass-irid', group: 'glass', name: 'Iridescent Glass', mood: 'holographic dark', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#8a7bff', dark: true, signature: 'a holographic rainbow gradient border + a faint prismatic sheen on dark glass cards' },
  { id: 'glass-tinted', group: 'glass', name: 'Tinted Glass', mood: 'stained colored glass', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#0d99ff', dark: false, signature: 'each card a different translucent colored tint (stained-acrylic) on a light bright ground' },
  { id: 'glass-mono', group: 'glass', name: 'Mono Premium Glass', mood: 'restrained dark glass', display: 'Sora', body: 'Inter', data: 'JetBrains Mono', accent: '#8a7bff', dark: true, signature: 'understated near-black glass — blur(24px), one restrained accent, Superhuman-grade' },
  // ---------------- STRUCTURAL ARCHETYPES (new layouts) ----------------
  { id: 'heatmap', group: 'structural', name: 'Calendar Heatmap', mood: 'contribution grid', display: 'Inter', body: 'Inter', data: 'JetBrains Mono', accent: '#40c463', dark: false, signature: 'a GitHub-style contribution heatmap as the hero (weeks × weekdays shaded by intensity)' },
  { id: 'sidebar', group: 'structural', name: 'Sidebar / Rail', mood: 'desktop SaaS shell', display: 'Inter', body: 'Inter', data: 'IBM Plex Mono', accent: '#4f46e5', dark: false, signature: 'a fixed left nav rail (collapses to an icon rail on mobile) + a main dashboard area' },
  { id: 'bottomtab', group: 'structural', name: 'Native Bottom-Tab', mood: 'native mobile app', display: 'Inter', body: 'Inter', data: 'IBM Plex Mono', accent: '#0a84ff', dark: false, signature: 'an iOS-style title header + a fixed bottom tab bar (icons + labels) + a floating +' },
  { id: 'kanban', group: 'structural', name: 'Kanban Board', mood: 'column board', display: 'Space Grotesk', body: 'Inter', data: 'Space Mono', accent: '#6d5cff', dark: false, signature: 'horizontal columns with count badges; items move between columns on action' },
  { id: 'carousel', group: 'structural', name: 'Swipe Story Cards', mood: 'swipeable full-bleed', display: 'Sora', body: 'Inter', data: 'Space Mono', accent: '#5b9dff', dark: true, signature: 'one full-bleed gradient card at a time (scroll-snap) with a dots indicator, story/Tinder feel' },
  { id: 'timeline', group: 'structural', name: 'Vertical Timeline', mood: 'agenda feed', display: 'Inter', body: 'Inter', data: 'JetBrains Mono', accent: '#0f9d6e', dark: false, signature: 'a left connector rail with nodes, each row a timeline entry — reads like a day agenda' },
  { id: 'stepper', group: 'structural', name: 'Focus Stepper', mood: 'one-at-a-time flow', display: 'Manrope', body: 'Manrope', data: 'Space Mono', accent: '#ff6b5d', dark: false, signature: 'a single centered card with an "N of M" stepper + Prev/Next, a calm zen flow' },
  { id: 'masonry', group: 'structural', name: 'Masonry Grid', mood: 'Pinterest varied tiles', display: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', data: 'Space Mono', accent: '#7c5cff', dark: false, signature: 'a 2-col masonry of varying-height pastel tiles packed tightly' },
  // ---------------- FRESH AESTHETICS (new visual languages) ----------------
  { id: 'frutiger', group: 'aesthetic', name: 'Frutiger Aero / Y2K', mood: 'glossy aqua revival', display: 'Outfit', body: 'Inter', data: 'Space Mono', accent: '#00b4d8', dark: false, signature: 'a bright sky→grass gradient, glossy skeuomorphic shine, bubbly rounded, aqua+lime' },
  { id: 'cyber', group: 'aesthetic', name: 'Cyberpunk HUD', mood: 'sci-fi neon HUD', display: 'Space Grotesk', body: 'JetBrains Mono', data: 'JetBrains Mono', accent: '#00e5ff', dark: true, signature: 'neon cyan/magenta glow, angular clip-path panels, corner brackets, a glowing gauge — game-HUD' },
  { id: 'clay', group: 'aesthetic', name: 'Claymorphism', mood: 'soft puffy 3D', display: 'Quicksand', body: 'Nunito', data: 'Space Mono', accent: '#7c6cff', dark: false, signature: 'soft puffy clay shapes with double inner+outer shadows, big rounded, pastel, tactile' },
  { id: 'riso', group: 'aesthetic', name: 'Risograph Print', mood: 'indie print grain', display: 'Bricolage Grotesque', body: 'Space Mono', data: 'Space Mono', accent: '#ff4d8d', dark: false, signature: 'a paper grain, a 2-ink fluoro-pink+blue palette, halftone dots, a touch of misregistration' },
  { id: 'luxe', group: 'aesthetic', name: 'Editorial Luxury', mood: 'fashion couture', display: 'Bodoni Moda', body: 'Inter', data: 'IBM Plex Mono', accent: '#b08d57', dark: false, signature: 'a large dramatic Bodoni display, gold hairlines on near-monochrome, couture whitespace' },
  { id: 'synth', group: 'aesthetic', name: 'Synthwave', mood: '80s retro-future', display: 'Unbounded', body: 'Inter', data: 'Space Mono', accent: '#ff4dd6', dark: true, signature: 'a neon grid horizon + a purple→pink→cyan sunset gradient, glowing chrome display' },
];

const GROUP_TITLES: Record<DirectionGroup, string> = {
  modern: 'Modern product archetypes',
  glass: 'Glassmorphism levels (pick the intensity that fits)',
  structural: 'Structural archetypes (a different LAYOUT, not a restyle)',
  aesthetic: 'Fresh aesthetics (distinct visual languages)',
};

/** Compact, grouped catalog of all directions for prompt injection. */
export function directionsMenu(): string {
  const order: DirectionGroup[] = ['modern', 'glass', 'structural', 'aesthetic'];
  const lines: string[] = [];
  for (const g of order) {
    lines.push(`\n### ${GROUP_TITLES[g]}`);
    for (const d of DIRECTIONS.filter((x) => x.group === g)) {
      const trio = d.display === d.body ? `${d.display} + ${d.data}` : `${d.display} / ${d.body} / ${d.data}`;
      lines.push(`- ${d.name} — ${d.mood}. Type: ${trio}. Accent ${d.accent} (${d.dark ? 'dark' : 'light'}). ${d.signature}.`);
    }
  }
  return lines.join('\n');
}

export function directionById(id: string): Direction | undefined {
  return DIRECTIONS.find((d) => d.id === id);
}
