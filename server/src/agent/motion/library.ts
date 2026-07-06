import type { MotionStyleId } from './scaffolds';

/**
 * MOTION DESIGN LIBRARY (operator 2026-07-05: "close to a thousand different typography,
 * call outs, SVG background movement and other little extra animations with indexed but
 * with intent so that it's easier for the ai to pick from").
 *
 * ~1000 curated presets generated from parametric grids over the motion-kit's base
 * systems (see "DESIGN LIBRARY BASES" in motion.css). Every entry carries an INTENT line
 * and mood tags, searched by token overlap (the searchAssets pattern) — the agent asks
 * for "calm drifting texture for a quiet data scene" and gets exact paste-ready snippets.
 *
 * Pure and lazy: the catalog builds on first use, no I/O, unit-testable.
 */

export interface DesignEntry {
  id: string;
  kind: 'type' | 'callout' | 'background' | 'micro';
  name: string;
  /** One line: when a designer would reach for this. */
  intent: string;
  moods: string[];
  /** Packs this sits well in ('all' = neutral). */
  packs: MotionStyleId[] | 'all';
  /** Paste-ready HTML (self-contained: kit classes + inline vars; placeholder text in CAPS). */
  snippet: string;
}

// ---------------------------------------------------------------------------
// TYPE VOICES — treatments over the bundled self-hosted families (fonts/fonts.css).
// ---------------------------------------------------------------------------

interface FamilyMeta {
  name: string;
  css: string;
  tags: string[];
  serif: boolean;
  weights: number[];
  italic?: boolean;
  mono?: boolean;
}

const FAMILIES: FamilyMeta[] = [
  { name: 'Fraunces', css: "'Fraunces', Georgia, serif", tags: ['warm', 'editorial', 'premium', 'literary', 'human'], serif: true, weights: [600], italic: true },
  { name: 'Source Serif 4', css: "'Source Serif 4', Georgia, serif", tags: ['editorial', 'journalistic', 'classic', 'trustworthy'], serif: true, weights: [400, 600], italic: true },
  { name: 'Lora', css: "'Lora', Georgia, serif", tags: ['calm', 'bookish', 'gentle', 'story'], serif: true, weights: [400], italic: true },
  { name: 'Newsreader', css: "'Newsreader', Georgia, serif", tags: ['newspaper', 'longform', 'reading', 'reportage'], serif: true, weights: [400], italic: true },
  { name: 'Spectral', css: "'Spectral', Georgia, serif", tags: ['elegant', 'literary', 'refined', 'quote'], serif: true, weights: [600], italic: true },
  { name: 'Inter', css: "'Inter', -apple-system, sans-serif", tags: ['neutral', 'product', 'clean', 'ui'], serif: false, weights: [400, 500, 600, 700] },
  { name: 'Space Grotesk', css: "'Space Grotesk', sans-serif", tags: ['technical', 'modern', 'geometric', 'bold', 'broadcast'], serif: false, weights: [500, 700] },
  { name: 'Bricolage Grotesque', css: "'Bricolage Grotesque', sans-serif", tags: ['characterful', 'playful', 'contemporary', 'science'], serif: false, weights: [700] },
  { name: 'Sora', css: "'Sora', sans-serif", tags: ['quiet', 'technical', 'futuristic', 'precise'], serif: false, weights: [600] },
  { name: 'Outfit', css: "'Outfit', sans-serif", tags: ['soft', 'geometric', 'startup', 'friendly'], serif: false, weights: [600] },
  { name: 'DM Sans', css: "'DM Sans', sans-serif", tags: ['humanist', 'calm', 'product', 'approachable'], serif: false, weights: [400, 600] },
  { name: 'Manrope', css: "'Manrope', sans-serif", tags: ['neutral', 'clean', 'tech', 'composed'], serif: false, weights: [600] },
  { name: 'Plus Jakarta Sans', css: "'Plus Jakarta Sans', sans-serif", tags: ['modern', 'friendly', 'product'], serif: false, weights: [400, 600] },
  { name: 'Hanken Grotesk', css: "'Hanken Grotesk', sans-serif", tags: ['grotesk', 'editorial', 'swiss', 'understated'], serif: false, weights: [400, 600] },
  { name: 'IBM Plex Mono', css: "'IBM Plex Mono', ui-monospace, monospace", tags: ['data', 'technical', 'numbers', 'terminal'], serif: false, weights: [500], mono: true },
  { name: 'Space Mono', css: "'Space Mono', ui-monospace, monospace", tags: ['retro', 'data', 'quirky', 'typewriter'], serif: false, weights: [400], mono: true },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function typeEntries(): DesignEntry[] {
  const out: DesignEntry[] = [];
  const mask = (inner: string) => `<span class="mg-mask"><span class="mg-rise" style="--at:.15s">${inner}</span></span>`;
  for (const f of FAMILIES) {
    const fam = slug(f.name);
    const w = Math.max(...f.weights);
    // hero — the biggest voice of a scene
    out.push({
      id: `type-${fam}-hero`,
      kind: 'type', name: `${f.name} hero`,
      intent: `Giant scene-defining headline in ${f.name} — ${f.tags.slice(0, 2).join(', ')} register; one short line, fills the frame.`,
      moods: [...f.tags, 'hero', 'giant', 'headline', 'display'], packs: 'all',
      snippet: `<h1 style="font-family:${f.css};font-weight:${w};font-size:min(11vh,12.6vw);line-height:.98;letter-spacing:-0.02em;">${mask('YOUR LINE')}</h1>`,
    });
    // headline — standard display
    out.push({
      id: `type-${fam}-headline`,
      kind: 'type', name: `${f.name} headline`,
      intent: `Working headline in ${f.name} — ${f.tags[0]} voice for 4-8 word lines.`,
      moods: [...f.tags, 'headline', 'title', 'display'], packs: 'all',
      snippet: `<h2 style="font-family:${f.css};font-weight:${w};font-size:min(6.4vh,7.4vw);line-height:1.08;">${mask('YOUR HEADLINE')}</h2>`,
    });
    if (!f.serif && !f.mono) {
      out.push({
        id: `type-${fam}-upper-tracked`,
        kind: 'type', name: `${f.name} uppercase tracked`,
        intent: `Shouting uppercase display in ${f.name} — announcements, broadcast energy, chapter names.`,
        moods: [...f.tags, 'uppercase', 'loud', 'announcement', 'impact'], packs: ['broadcast', 'nutshell', 'clean'],
        snippet: `<h2 style="font-family:${f.css};font-weight:${w};font-size:min(6vh,7vw);text-transform:uppercase;letter-spacing:0.04em;line-height:1.05;">${mask('YOUR LINE')}</h2>`,
      });
      out.push({
        id: `type-${fam}-label`,
        kind: 'type', name: `${f.name} tracked label`,
        intent: `Small tracked-caps label/kicker in ${f.name} — quiet structure, not a subtitle.`,
        moods: [...f.tags, 'label', 'kicker', 'small', 'caps'], packs: 'all',
        snippet: `<div style="font-family:${f.css};font-weight:600;font-size:2.2vh;text-transform:uppercase;letter-spacing:0.22em;color:var(--mg-muted);" class="mg-fade">YOUR LABEL</div>`,
      });
    }
    if (f.serif && f.italic) {
      out.push({
        id: `type-${fam}-italic`,
        kind: 'type', name: `${f.name} italic aside`,
        intent: `Italic ${f.name} for asides, quotes and emotional pivots — the human voice inside a factual scene.`,
        moods: [...f.tags, 'italic', 'quote', 'aside', 'emotional'], packs: ['clean', 'vox', 'nordic'],
        snippet: `<div style="font-family:${f.css};font-style:italic;font-weight:${Math.min(...f.weights)};font-size:min(5vh,5.8vw);">${mask('your aside, spoken softly')}</div>`,
      });
      out.push({
        id: `type-${fam}-mixed-scale`,
        kind: 'type', name: `${f.name} mixed-scale stack`,
        intent: `Editorial mixed-size stack in ${f.name} — short words huge, long words small (≥3:1 contrast); the art-directed hook look.`,
        moods: [...f.tags, 'stack', 'mixed', 'hook', 'editorial', 'contrast'], packs: 'all',
        snippet: `<h1 style="font-family:${f.css};font-weight:${w};line-height:1.02;display:flex;flex-direction:column;"><span class="mg-mask"><span class="mg-rise" style="--at:.12s;font-size:min(4.6vh,5.3vw);">the small setup line</span></span><span class="mg-mask"><span class="mg-rise" style="--at:.26s;font-size:min(11vh,12.6vw);">BIG WORD</span></span></h1>`,
      });
    }
    if (f.mono) {
      out.push({
        id: `type-${fam}-numeral`,
        kind: 'type', name: `${f.name} counting numeral`,
        intent: `Tabular counting numeral in ${f.name} — data moments, timers, prices; pairs with data-count-to.`,
        moods: [...f.tags, 'numeral', 'counter', 'stat', 'tabular'], packs: 'all',
        snippet: `<div style="font-family:${f.css};font-variant-numeric:tabular-nums;font-weight:${Math.max(...f.weights)};font-size:min(18vh,20.7vw);line-height:.9;color:var(--mg-accent);" class="mg-pop"><span data-count-to="42" data-count-start-frac="0.2" data-count-dur="1300">0</span>%</div>`,
      });
      out.push({
        id: `type-${fam}-terminal`,
        kind: 'type', name: `${f.name} typewriter line`,
        intent: `Typewriter reveal in ${f.name} — terminal/documents/receipts register; pairs with data-typewriter.`,
        moods: [...f.tags, 'typewriter', 'terminal', 'document'], packs: ['clean', 'nordic', 'vox'],
        snippet: `<div class="kt-caret" style="font-family:${f.css};font-size:3.2vh;" data-typewriter="YOUR TYPED LINE" data-tw-start-frac="0.15"></div>`,
      });
    }
  }
  // Extra treatments that multiply the voices: ghost echoes, display numerals,
  // quotes (serifs), tight giants (sans) — each a real art-direction decision.
  for (const f of FAMILIES) {
    const fam = slug(f.name);
    const w = Math.max(...f.weights);
    out.push({
      id: `type-${fam}-echo`,
      kind: 'type', name: `${f.name} ghost echo`,
      intent: `Giant outlined background echo word in ${f.name} — texture, not content; bleeds off-frame at ≤10% opacity.`,
      moods: [...f.tags, 'echo', 'ghost', 'texture', 'outline', 'background'], packs: 'all',
      snippet: `<div class="mg-echo mg-outline" style="right:-6vw;bottom:-6vh;font-size:min(34vh,39.1vw);font-family:${f.css};font-weight:${w};"><span style="display:inline-block;">ECHO</span></div>`,
    });
    if (!f.mono) {
      out.push({
        id: `type-${fam}-numeral`,
        kind: 'type', name: `${f.name} display numeral`,
        intent: `Hero counting numeral set in ${f.name} — when the number should carry the ${f.tags[0]} voice, not the data voice.`,
        moods: [...f.tags, 'numeral', 'stat', 'counter', 'hero'], packs: 'all',
        snippet: `<div class="mg-pop" style="--at:.2s;font-family:${f.css};font-weight:${w};font-variant-numeric:tabular-nums;font-size:min(22vh,25.3vw);line-height:.88;color:var(--mg-accent);"><span data-count-to="42" data-count-start-frac="0.2" data-count-dur="1300">0</span></div>`,
      });
    }
    if (f.serif) {
      out.push({
        id: `type-${fam}-quote`,
        kind: 'type', name: `${f.name} pull quote`,
        intent: `Pull-quote setting in ${f.name} with a ghost quotation mark — testimony, sources, voices.`,
        moods: [...f.tags, 'quote', 'testimony', 'voice', 'pull'], packs: 'all',
        snippet: `<div style="position:relative;"><div class="mg-echo" style="left:-4vw;top:-9vh;font-size:min(30vh,34.5vw);font-family:${f.css};opacity:.08;">“</div><div style="font-family:${f.css};font-size:min(5.6vh,6.4vw);line-height:1.25;"><span class="mg-mask"><span class="mg-rise" style="--at:.15s">Your quoted line here.</span></span></div></div>`,
      });
      out.push({
        id: `type-${fam}-smallcaps`,
        kind: 'type', name: `${f.name} small-caps line`,
        intent: `Letterspaced small-caps line in ${f.name} — book-like section openers and attributions.`,
        moods: [...f.tags, 'smallcaps', 'attribution', 'bookish'], packs: ['clean', 'nordic', 'vox'],
        snippet: `<div class="mg-fade" style="--at:.2s;font-family:${f.css};font-variant-caps:small-caps;letter-spacing:0.14em;font-size:3vh;">Your Attribution Line</div>`,
      });
    }
    if (!f.serif && !f.mono) {
      out.push({
        id: `type-${fam}-tight-giant`,
        kind: 'type', name: `${f.name} tight giant`,
        intent: `Ultra-tight giant word in ${f.name} — poster energy, negative tracking, one word only.`,
        moods: [...f.tags, 'poster', 'giant', 'tight', 'impact'], packs: ['broadcast', 'nutshell', 'clean'],
        snippet: `<h1 style="font-family:${f.css};font-weight:${w};font-size:min(16vh,18.4vw);letter-spacing:-0.045em;line-height:.9;">${mask('WORD')}</h1>`,
      });
    }
  }
  // Curated pairings (display + label + data) with a scene-lockup snippet.
  const PAIRINGS: Array<[string, string, string, string, string[]]> = [
    ['Fraunces', 'Inter', 'IBM Plex Mono', 'warm premium editorial — finance, health, essays', ['premium', 'editorial', 'warm']],
    ['Source Serif 4', 'Space Grotesk', 'IBM Plex Mono', 'journalistic evidence — explainers, investigations', ['journalistic', 'evidence', 'serious']],
    ['Spectral', 'Hanken Grotesk', 'Space Mono', 'refined literary — culture, ideas, quotes', ['literary', 'refined', 'culture']],
    ['Bricolage Grotesque', 'Inter', 'IBM Plex Mono', 'playful science — bold facts with character', ['playful', 'science', 'bold']],
    ['Space Grotesk', 'Inter', 'IBM Plex Mono', 'technical broadcast — product launches, tech news', ['technical', 'broadcast', 'modern']],
    ['Newsreader', 'Manrope', 'IBM Plex Mono', 'newspaper longform — history, policy, timelines', ['newspaper', 'history', 'calm']],
    ['Outfit', 'DM Sans', 'Space Mono', 'soft startup — lifestyle, wellness, consumer', ['startup', 'soft', 'friendly']],
    ['Sora', 'Inter', 'IBM Plex Mono', 'quiet futurism — AI, space, frontier tech', ['futuristic', 'quiet', 'precise']],
    ['Lora', 'Plus Jakarta Sans', 'IBM Plex Mono', 'gentle story — personal narratives, education', ['gentle', 'story', 'human']],
    ['Hanken Grotesk', 'Inter', 'Space Mono', 'swiss understatement — design, architecture, systems', ['swiss', 'minimal', 'grid']],
  ];
  for (const [disp, label, data, vibe, moods] of PAIRINGS) {
    const d = FAMILIES.find((f) => f.name === disp)!;
    const l = FAMILIES.find((f) => f.name === label)!;
    const m = FAMILIES.find((f) => f.name === data)!;
    for (const reg of ['hero', 'compact'] as const) {
      out.push({
        id: `pair-${slug(disp)}-${slug(label)}-${reg}`,
        kind: 'type', name: `${disp} × ${label} (${reg})`,
        intent: `Full type lockup — ${vibe}; ${reg === 'hero' ? 'hook/hero scenes' : 'body/data scenes'}.`,
        moods: [...moods, 'pairing', 'lockup', reg], packs: 'all',
        snippet: `<div class="mg-col" style="gap:1.6vh;"><div style="font-family:${l.css};font-size:2.2vh;text-transform:uppercase;letter-spacing:0.22em;color:var(--mg-muted);" class="mg-fade">YOUR KICKER</div><h1 style="font-family:${d.css};font-weight:${Math.max(...d.weights)};font-size:${reg === 'hero' ? 'min(9.4vh,10.8vw)' : 'min(5.6vh,6.4vw)'};line-height:1.04;"><span class="mg-mask"><span class="mg-rise" style="--at:.15s">YOUR HEADLINE</span></span></h1><div style="font-family:${m.css};font-variant-numeric:tabular-nums;font-size:2.6vh;color:var(--mg-accent);" class="mg-lag" style="--at:.5s">42% · THE DATA LINE</div></div>`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CALLOUTS — annotation components × tones × sizes.
// ---------------------------------------------------------------------------

function calloutEntries(): DesignEntry[] {
  const out: DesignEntry[] = [];
  interface Comp {
    id: string; cls: string; name: string; base: string;
    tones: Array<['', 'danger', 'money', 'ink'][number]>;
    packs: DesignEntry['packs']; moods: string[]; sizes?: boolean; text?: string;
  }
  const COMPS: Comp[] = [
    { id: 'pill', cls: 'mg-pill', name: 'Soft pill', base: 'soft rounded pill label — gentle categorical tag', tones: ['', 'danger', 'money', 'ink'], packs: 'all', moods: ['soft', 'tag', 'category', 'gentle'], sizes: true },
    { id: 'pill-solid', cls: 'mg-pill solid', name: 'Solid pill', base: 'solid accent pill — confident state/verdict chip', tones: ['', 'danger', 'money'], packs: 'all', moods: ['verdict', 'state', 'confident'], sizes: true },
    { id: 'stamp', cls: 'mg-stamp2', name: 'Print stamp', base: 'tilted bordered stamp slamming in — verdicts, APPROVED/DENIED beats, receipts', tones: ['', 'danger', 'money', 'ink'], packs: ['nordic', 'vox', 'clean'], moods: ['stamp', 'verdict', 'print', 'documentary'], sizes: true },
    { id: 'flag', cls: 'mg-flagtag', name: 'Flag tag', base: 'pointed flag label sliding in — direction/location/step markers', tones: ['', 'danger', 'money'], packs: 'all', moods: ['flag', 'marker', 'direction'], sizes: true },
    { id: 'ribbon', cls: 'mg-ribbon', name: 'Ribbon', base: 'folded ribbon banner — awards, rankings, featured items', tones: ['', 'danger', 'money'], packs: ['broadcast', 'nutshell', 'clean'], moods: ['award', 'ranking', 'featured', 'banner'], sizes: true },
    { id: 'underlabel', cls: 'mg-underlabel', name: 'Crawling underline', base: 'word with an accent underline crawling beneath — quiet argument emphasis', tones: [''], packs: 'all', moods: ['underline', 'argument', 'quiet', 'emphasis'], sizes: true },
    { id: 'keycap', cls: 'mg-keycap', name: 'Keycap', base: 'keyboard-key chip dropping in — shortcuts, steps, inputs, tech register', tones: [''], packs: ['clean', 'broadcast'], moods: ['tech', 'key', 'step', 'input'], sizes: true },
    { id: 'corner-badge', cls: 'mg-cornerbadge', name: 'Corner badge', base: 'corner-anchored badge sliding in — NEW/LIVE/UPDATED status on a card or plate', tones: ['', 'danger', 'money'], packs: 'all', moods: ['badge', 'status', 'corner', 'live'], text: 'NEW' },
    { id: 'bracketed', cls: 'mg-bracketed', name: 'Drawn brackets', base: 'term framed by drawing [brackets] — definitions and technical terms', tones: [''], packs: ['nordic', 'clean', 'vox'], moods: ['definition', 'term', 'technical', 'bracket'], sizes: true },
    { id: 'shout', cls: 'mg-callout', name: 'Shouting box', base: 'the broadcast yellow outlined box with hard shadow — numbers that must be YELLED', tones: ['', 'danger', 'money'], packs: ['broadcast', 'nutshell'], moods: ['loud', 'shout', 'number', 'alarm'], sizes: true },
    { id: 'vox-label', cls: 'mg-label-vox', name: 'Highlighter label', base: 'the vox yellow boxed label — evidence annotation on photos/plates', tones: [''], packs: ['vox', 'broadcast'], moods: ['evidence', 'annotation', 'photo', 'label'], sizes: true },
    { id: 'ink-label', cls: 'mg-label-vox ink', name: 'Ink label', base: 'black boxed label — restrained print annotation', tones: [''], packs: ['nordic', 'vox', 'clean'], moods: ['print', 'annotation', 'restrained'], sizes: true },
    { id: 'rule-label', cls: 'mg-rulelabel', name: 'Ruled label', base: 'hairline + tracked caps — the editorial kicker treatment', tones: [''], packs: 'all', moods: ['kicker', 'editorial', 'quiet', 'structure'], sizes: false },
    { id: 'arrow-tag', cls: 'mg-tag', name: 'Arrow tag', base: 'small pinned tag with a pointer — names the thing it points at', tones: [''], packs: 'all', moods: ['pin', 'pointer', 'name', 'subject'], text: 'THE SUBJECT' },
  ];
  const SIZES: Array<[string, string, string]> = [
    ['compact', '2vh', 'small whisper scale for dense frames'],
    ['standard', '2.8vh', 'default reading scale'],
    ['large', '4vh', 'hero scale — the callout IS the scene beat'],
  ];
  const TONE_INTENT: Record<string, string> = {
    '': 'in the pack accent',
    danger: 'in danger red — warnings, losses, failures',
    money: 'in money green — gains, savings, wins',
    ink: 'in neutral ink — quiet, non-semantic',
  };
  for (const c of COMPS) {
    for (const tone of c.tones) {
      const sizes = c.sizes ? SIZES : ([['standard', '2.8vh', 'default scale']] as typeof SIZES);
      for (const [sz, fs, szIntent] of sizes) {
        out.push({
          id: `co-${c.id}${tone ? '-' + tone : ''}-${sz}`,
          kind: 'callout',
          name: `${c.name}${tone ? ` (${tone})` : ''} · ${sz}`,
          intent: `${c.base}, ${TONE_INTENT[tone]}; ${szIntent}.`,
          moods: [...c.moods, tone || 'accent', sz],
          packs: c.packs,
          snippet: `<div class="${c.cls}${tone ? ' ' + tone : ''}" style="--at:calc(var(--scene-s,8)*0.4s);font-size:${fs};">${c.text ?? 'YOUR LABEL'}</div>`,
        });
      }
    }
  }
  // corner badges in all four corners
  for (const [pos, css, posIntent] of [
    ['tl', 'top:0;left:0;clip-path:polygon(0 0, 100% 0, calc(100% - 2vh) 100%, 0 100%);', 'top-left status'],
    ['tr', 'top:0;right:0;', 'top-right status (default)'],
    ['bl', 'bottom:0;left:0;clip-path:polygon(0 0, calc(100% - 2vh) 0, 100% 100%, 0 100%);', 'bottom-left caption-side status'],
    ['br', 'bottom:0;right:0;clip-path:polygon(2vh 0, 100% 0, 100% 100%, 0 100%);', 'bottom-right quiet status'],
  ] as Array<[string, string, string]>) {
    for (const tone of ['', 'danger', 'money'] as const) {
      out.push({
        id: `co-corner-${pos}${tone ? '-' + tone : ''}`,
        kind: 'callout', name: `Corner badge ${pos.toUpperCase()}${tone ? ` (${tone})` : ''}`,
        intent: `Corner-anchored badge (${posIntent}) ${tone === 'danger' ? 'in danger red' : tone === 'money' ? 'in money green' : 'in the pack accent'} — NEW/LIVE/UPDATED marks on cards and plates.`,
        moods: ['badge', 'corner', 'status', pos, tone || 'accent'],
        packs: 'all',
        snippet: `<div class="mg-cornerbadge${tone ? ' ' + tone : ''}" style="--at:calc(var(--scene-s,8)*0.35s);${css}">NEW</div>`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BACKGROUNDS — animated pattern layers over the .mg-bgx/.mg-blob/.mg-orbits bases.
// ---------------------------------------------------------------------------

function backgroundEntries(): DesignEntry[] {
  const out: DesignEntry[] = [];
  const INK = 'color-mix(in srgb, var(--mg-ink) 60%, transparent)';
  const ACC = 'color-mix(in srgb, var(--mg-accent) 75%, transparent)';
  interface Pattern {
    id: string; name: string; img: (color: string, unit: string) => string; sizes: Array<[string, string]>;
    moods: string[]; motions: Array<'scroll' | 'spin' | 'breathe' | 'still'>; directional?: boolean;
  }
  const PATTERNS: Pattern[] = [
    { id: 'dots', name: 'Dot grid', img: (c) => `radial-gradient(circle, ${c} 1.1px, transparent 1.7px)`, sizes: [['sparse', '8vh'], ['medium', '5vh'], ['dense', '3vh']], moods: ['dots', 'grid', 'texture', 'clean'], motions: ['scroll', 'breathe', 'still'] },
    { id: 'rings', name: 'Ring dots', img: (c) => `radial-gradient(circle, transparent 34%, ${c} 36%, transparent 42%)`, sizes: [['sparse', '11vh'], ['medium', '7vh']], moods: ['rings', 'circles', 'playful', 'science'], motions: ['scroll', 'breathe'] },
    { id: 'stripes-diag', name: 'Diagonal hairlines', img: (c) => `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 8vh)`, sizes: [['sparse', ''], ['dense', '']], moods: ['stripes', 'diagonal', 'dynamic', 'print'], motions: ['scroll'], directional: true },
    { id: 'lines-vert', name: 'Vertical rules', img: (c) => `repeating-linear-gradient(90deg, ${c} 0 1px, transparent 1px 9vh)`, sizes: [['sparse', '']], moods: ['lines', 'columns', 'architectural', 'grid'], motions: ['scroll', 'still'], directional: true },
    { id: 'grid', name: 'Blueprint grid', img: (c) => `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, sizes: [['fine', '4vh'], ['broad', '9vh']], moods: ['grid', 'blueprint', 'technical', 'swiss'], motions: ['scroll', 'still'] },
    { id: 'crosshatch', name: 'Crosshatch', img: (c) => `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 5vh), repeating-linear-gradient(-45deg, ${c} 0 1px, transparent 1px 5vh)`, sizes: [['standard', '']], moods: ['crosshatch', 'sketch', 'workshop', 'texture'], motions: ['scroll', 'still'] },
    { id: 'plus', name: 'Plus marks', img: (c) => `linear-gradient(${c} 1.5px, transparent 1.5px), linear-gradient(90deg, ${c} 1.5px, transparent 1.5px)`, sizes: [['sparse', '10vh']], moods: ['plus', 'marks', 'map', 'technical'], motions: ['scroll', 'breathe', 'still'] },
    { id: 'waves', name: 'Contour waves', img: (c) => `repeating-radial-gradient(ellipse 140% 60% at 50% 120%, transparent 0 6vh, ${c} 6vh calc(6vh + 1px), transparent calc(6vh + 1px) 12vh)`, sizes: [['standard', '']], moods: ['waves', 'contour', 'topographic', 'organic', 'calm'], motions: ['breathe', 'still'] },
    { id: 'checker', name: 'Soft checker', img: (c) => `conic-gradient(${c} 90deg, transparent 90deg 180deg, ${c} 180deg 270deg, transparent 270deg)`, sizes: [['broad', '12vh']], moods: ['checker', 'retro', 'bold', 'graphic'], motions: ['scroll'] },
  ];
  const MOTIONS: Record<string, Array<[string, string, string]>> = {
    scroll: [
      ['drift-slow', '--bgdur:24s;--bgdx:10vh;--bgdy:6vh;', 'barely-perceptible drift — quiet scenes'],
      ['drift', '--bgdur:14s;--bgdx:12vh;--bgdy:8vh;', 'steady ambient drift'],
      ['rain', '--bgdur:10s;--bgdx:0vh;--bgdy:14vh;', 'downward rain — time passing, downloads, decline'],
      ['rise', '--bgdur:12s;--bgdx:0vh;--bgdy:-14vh;', 'upward rise — growth, progress, optimism'],
      ['slide', '--bgdur:12s;--bgdx:16vh;--bgdy:0vh;', 'lateral travel — journeys, comparison sweeps'],
    ],
    spin: [['spin', '--bgdur:80s;', 'imperceptible rotation — cosmic/organic scenes']],
    breathe: [['breathe', '--bgdur:9s;', 'texture inhaling gently — living quiet frames']],
    still: [['still', '', 'static texture — when the content itself is busy']],
  };
  const COLORS: Array<['ink' | 'accent', string, string]> = [
    ['ink', INK, 'neutral ink texture'],
    ['accent', ACC, 'accent-tinted texture (brand-forward)'],
  ];
  for (const p of PATTERNS) {
    for (const [szName, szVal] of p.sizes) {
      for (const motion of p.motions) {
        for (const [mName, mVars, mIntent] of MOTIONS[motion]) {
          for (const [cName, cVal, cIntent] of COLORS) {
            const cls = motion === 'still' ? 'mg-bgx' : `mg-bgx ${motion}`;
            const size = szVal ? `background-size:${szVal} ${szVal};` : '';
            for (const [oName, oVal, oIntent] of [
              ['whisper', '.05', 'barely-there texture under dense content'],
              ['standard', '.09', 'the default ambient presence'],
              ['present', '.16', 'a visible design element, for sparse frames'],
            ] as Array<[string, string, string]>) {
              out.push({
                id: `bg-${p.id}-${szName}-${mName}-${cName}-${oName}`,
                kind: 'background',
                name: `${p.name} · ${szName} · ${mName} · ${cName} · ${oName}`,
                intent: `${p.name} layer (${szName}), ${mIntent}; ${cIntent}; ${oIntent}.`,
                moods: [...p.moods, mName, cName, oName, 'background', 'ambient'],
                packs: 'all',
                snippet: `<div class="${cls}" style="${mVars}--bgo:${oVal};background-image:${p.img(cVal, szVal)};${size}"></div>`,
              });
            }
          }
        }
      }
    }
  }
  // blobs — positions × speeds
  const BLOB_POS: Array<[string, string, string]> = [
    ['tr', '--x:68%;--y:8%;', 'upper-right mass balancing left-anchored text'],
    ['bl', '--x:6%;--y:62%;', 'lower-left mass balancing right content'],
    ['center', '--x:32%;--y:28%;', 'central glow behind a hero element'],
  ];
  for (const [pos, posVars, posIntent] of BLOB_POS) {
    for (const [spd, dur] of [['calm', '16s'], ['lively', '9s']] as const) {
      for (const [szName, sz] of [['large', '52vh'], ['medium', '36vh']] as const) {
        out.push({
          id: `bg-blob-${pos}-${szName}-${spd}`,
          kind: 'background',
          name: `Accent blob · ${pos} · ${szName} · ${spd}`,
          intent: `Blurred morphing accent mass, ${posIntent}; ${spd} tempo. Organic warmth on dark or light grounds.`,
          moods: ['blob', 'organic', 'glow', 'soft', spd, 'background', 'ambient'],
          packs: 'all',
          snippet: `<div class="mg-blob" style="${posVars}--sz:${sz};--bgdur:${dur};--bgo:.28;"></div>`,
        });
      }
    }
  }
  // orbits
  for (const [n, rings] of [['single', ['--d:74vh;--bgdur:56s;']], ['double', ['--d:60vh;--bgdur:44s;', '--d:92vh;--bgdur:70s;--at:-20s;']]] as Array<[string, string[]]>) {
    for (const [pos, cx, cy] of [['center', '50%', '50%'], ['offset', '70%', '30%']] as const) {
      out.push({
        id: `bg-orbits-${n}-${pos}`,
        kind: 'background',
        name: `Orbit rings · ${n} · ${pos}`,
        intent: `Concentric orbit ring${n === 'double' ? 's' : ''} with travelling accent dots (${pos}) — systems, cycles, planetary/science registers.`,
        moods: ['orbit', 'rings', 'science', 'cycle', 'space', 'background', 'ambient'],
        packs: ['nutshell', 'clean', 'sora' as any].filter((p) => p !== ('sora' as any)) as MotionStyleId[],
        snippet: `<div class="mg-orbits">${rings.map((r) => `<div class="ring" style="${r}--cx:${cx};--cy:${cy};"></div>`).join('')}</div>`,
      });
    }
  }
  // sweeps
  for (const [ang, angIntent] of [['100deg', 'vertical light bar'], ['160deg', 'diagonal sheen']] as const) {
    for (const [spd, dur] of [['slow', '16s'], ['standard', '11s']] as const) {
      out.push({
        id: `bg-sweep-${slug(ang)}-${spd}`,
        kind: 'background',
        name: `Light sweep · ${ang} · ${spd}`,
        intent: `A soft accent ${angIntent} sweeping across the frame (${spd}) — premium sheen, keeps flat grounds alive.`,
        moods: ['sweep', 'sheen', 'light', 'premium', 'background', 'ambient'],
        packs: 'all',
        snippet: `<div class="mg-bgsweep" style="--ang:${ang};--bgdur:${dur};--bgo:.1;"></div>`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// MICRO ANIMATIONS — entrances / idles / emphasis, indexed by role + energy.
// ---------------------------------------------------------------------------

function microEntries(): DesignEntry[] {
  const out: DesignEntry[] = [];
  interface Effect { id: string; cls: string; name: string; base: string; roles: string[]; moods: string[]; wrapper?: boolean }
  const ENTRANCES: Effect[] = [
    { id: 'rise', cls: 'mg-mask + mg-rise', name: 'Masked rise', base: 'line rises from behind an invisible mask — THE editorial text entrance', roles: ['headline', 'line', 'quote'], moods: ['editorial', 'premium', 'clean'] },
    { id: 'reveal', cls: 'mg-reveal', name: 'Fade up', base: 'soft fade + short rise — the neutral default', roles: ['label', 'card', 'block'], moods: ['neutral', 'soft'] },
    { id: 'pop', cls: 'mg-pop', name: 'Overshoot pop', base: 'scales in with overshoot — additions, icons, chips', roles: ['icon', 'chip', 'number', 'badge'], moods: ['playful', 'confident'] },
    { id: 'blur-in', cls: 'mg-blur-in', name: 'Blur in', base: 'sharpens from a blur — memories, reveals, dreamy transitions', roles: ['photo', 'headline', 'quote'], moods: ['dreamy', 'reveal', 'cinematic'] },
    { id: 'flip-in', cls: 'mg-flip-in', name: 'Flip up', base: 'flips up from flat like a departure board — schedules, swaps, updates', roles: ['number', 'label', 'card'], moods: ['mechanical', 'update', 'board'] },
    { id: 'drop-in', cls: 'mg-drop-in', name: 'Drop with bounce', base: 'falls in and settles with weight — heavy numbers, stamps, physical things', roles: ['number', 'icon', 'badge'], moods: ['weight', 'physical', 'punchy'] },
    { id: 'swing-in', cls: 'mg-swing-in', name: 'Swing in', base: 'swings from the top pivot — signs, hanging labels', roles: ['label', 'badge'], moods: ['hanging', 'sign', 'playful'] },
    { id: 'clip-diag', cls: 'mg-clip-diag', name: 'Diagonal wipe', base: 'reveals along a diagonal clip — maps, plates, panels', roles: ['photo', 'card', 'panel'], moods: ['wipe', 'graphic', 'dynamic'] },
    { id: 'zoom-settle', cls: 'mg-zoom-settle', name: 'Zoom settle', base: 'arrives from oversized and settles — photographic focus pull', roles: ['photo', 'headline'], moods: ['cinematic', 'focus'] },
    { id: 'skew-in', cls: 'mg-skew-in', name: 'Skew slide', base: 'slides in with a skew that straightens — speed, motion register', roles: ['headline', 'label'], moods: ['fast', 'sport', 'energetic'] },
    { id: 'slide-l', cls: 'mg-slide-l', name: 'Slide from left', base: 'enters from the left — the left side of comparisons, returns', roles: ['card', 'block'], moods: ['directional', 'comparison'] },
    { id: 'slide-r', cls: 'mg-slide-r', name: 'Slide from right', base: 'enters from the right — the right side of comparisons, arrivals', roles: ['card', 'block'], moods: ['directional', 'comparison'] },
    { id: 'words', cls: 'mg-words', name: 'Word by word', base: 'words appear one at a time — spoken-sync hooks (plain text only inside)', roles: ['line', 'hook'], moods: ['spoken', 'sync', 'kinetic'] },
  ];
  const SPEEDS: Array<[string, string, string]> = [
    ['instant', '0.05s', 'lands with the cut'],
    ['early', '0.3s', 'just after the cut'],
    ['spoken', 'calc(var(--scene-s,8)*0.45s)', 'timed to mid-narration (proportional)'],
    ['late', 'calc(var(--scene-s,8)*0.7s)', 'the delayed second beat'],
  ];
  for (const e of ENTRANCES) {
    for (const [spd, at, spdIntent] of SPEEDS) {
      for (const role of e.roles) {
        out.push({
          id: `fx-${e.id}-${role}-${spd}`,
          kind: 'micro',
          name: `${e.name} · ${role} · ${spd}`,
          intent: `${e.base}; for a ${role}, ${spdIntent}.`,
          moods: [...e.moods, role, spd, 'entrance'],
          packs: 'all',
          snippet: e.id === 'rise'
            ? `<span class="mg-mask"><span class="mg-rise" style="--at:${at}">YOUR ${role.toUpperCase()}</span></span>`
            : `<div class="${e.cls}" style="--at:${at}">YOUR ${role.toUpperCase()}</div>`,
        });
      }
    }
  }
  const IDLES: Array<[string, string, string[]]> = [
    ['mg-breathe', 'gentle scale breathing — organic living presence', ['organic', 'calm']],
    ['mg-bob', 'vertical bobbing — floating icons and chips', ['float', 'playful']],
    ['mg-float', 'slow drift float — weightless elements', ['weightless', 'ambient']],
    ['mg-sway', 'pendulum sway — hanging/rooted elements', ['hanging', 'gentle']],
    ['mg-pulse', 'attention pulse — the thing to look at now', ['attention', 'alive']],
    ['mg-shimmer', 'opacity shimmer — quiet label life', ['quiet', 'subtle']],
  ];
  for (const [cls, base, moods] of IDLES) {
    for (const [phase, at] of [['a', '-1s'], ['b', '-2.3s'], ['c', '-3.6s']] as const) {
      out.push({
        id: `fx-idle-${cls.replace('mg-', '')}-${phase}`,
        kind: 'micro', name: `${cls.replace('mg-', '')} idle (phase ${phase})`,
        intent: `${base}. Phase-offset ${at} so siblings never move in lockstep.`,
        moods: [...moods, 'idle', 'ambient', 'loop'],
        packs: 'all',
        snippet: `<div class="${cls}" style="--at:${at}">…wrap your element…</div>`,
      });
    }
  }
  const EMPH: Array<[string, string, string, string[]]> = [
    ['mg-emph', '<span class="mg-emph" style="--at:calc(var(--scene-s,8)*0.55s)">key phrase</span>', 'the pack emphasis sweep on a spoken keyword', ['keyword', 'spoken', 'highlight']],
    ['mg-key', '<span class="mg-key" style="--at:calc(var(--scene-s,8)*0.6s)">PAYOFF</span>', 'accent keyword pop with overshoot — the sentence payoff', ['payoff', 'pop', 'accent']],
    ['mg-mark', '<span class="mg-mark" style="--at:calc(var(--scene-s,8)*0.55s)">swept phrase</span>', 'accent sweep behind a phrase', ['sweep', 'highlight']],
    ['mg-highlight', '<span class="mg-highlight" style="--at:calc(var(--scene-s,8)*0.55s)">evidence</span>', 'the vox yellow highlighter over evidence', ['evidence', 'yellow', 'vox']],
    ['mg-stress', '<span class="mg-stress" style="--at:calc(var(--scene-s,8)*0.7s)">…wrap…</span>', 'a single stress pulse when narration hits the element', ['stress', 'pulse', 'sync']],
    ['mg-shake', '<div class="mg-shake" style="--at:calc(var(--scene-s,8)*0.5s)">…wrap…</div>', 'damped danger shake — errors, warnings, NO', ['danger', 'error', 'no']],
    ['mg-wiggle-once', '<div class="mg-wiggle-once" style="--at:calc(var(--scene-s,8)*0.5s)">…wrap…</div>', 'a friendly one-time wiggle — nudges, notifications', ['nudge', 'friendly', 'notification']],
    ['mg-pulse-ring', '<div class="mg-pulse-ring" style="--at:calc(var(--scene-s,8)*0.6s);border-radius:2vh;">…wrap…</div>', 'one expanding ring — pings, targets, live markers', ['ping', 'target', 'live']],
  ];
  for (const [cls, snippet, base, moods] of EMPH) {
    out.push({
      id: `fx-emph-${cls.replace('mg-', '')}`,
      kind: 'micro', name: `${cls.replace('mg-', '')} emphasis`,
      intent: `${base}; fire it while the word/element is being SPOKEN (proportional --at).`,
      moods: [...moods, 'emphasis'],
      packs: 'all',
      snippet,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Catalog + search
// ---------------------------------------------------------------------------

let CATALOG: DesignEntry[] | null = null;

export function designCatalog(): DesignEntry[] {
  if (!CATALOG) {
    CATALOG = [...typeEntries(), ...calloutEntries(), ...backgroundEntries(), ...microEntries()];
  }
  return CATALOG;
}

const SYNONYMS: Record<string, string[]> = {
  calm: ['quiet', 'gentle', 'subtle', 'soft', 'peaceful'],
  urgent: ['danger', 'alarm', 'warning', 'loud', 'alert'],
  money: ['finance', 'price', 'cost', 'saving', 'gain'],
  tech: ['technical', 'digital', 'data', 'terminal'],
  elegant: ['premium', 'refined', 'classy', 'luxury'],
  fun: ['playful', 'friendly', 'quirky'],
  serious: ['journalistic', 'documentary', 'evidence', 'trustworthy'],
  space: ['cosmic', 'orbit', 'planetary', 'science'],
  moving: ['drift', 'scroll', 'ambient', 'motion', 'animated'],
  title: ['headline', 'hero', 'display'],
  number: ['numeral', 'stat', 'counter', 'data'],
  texture: ['pattern', 'grain', 'background'],
};

function expand(tokens: string[]): string[] {
  const outSet = new Set(tokens);
  for (const t of tokens) {
    for (const [k, syns] of Object.entries(SYNONYMS)) {
      if (t === k || syns.includes(t)) {
        outSet.add(k);
        syns.forEach((s) => outSet.add(s));
      }
    }
  }
  return [...outSet];
}

export interface DesignSearchOpts {
  kind?: DesignEntry['kind'];
  style?: MotionStyleId;
  limit?: number;
}

/** Pure token-overlap search over the catalog — rank by hits in name/intent/moods. */
export function searchMotionDesign(query: string, opts: DesignSearchOpts = {}): DesignEntry[] {
  const tokens = expand(
    query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2),
  );
  const limit = Math.min(20, Math.max(1, opts.limit ?? 8));
  const scored: Array<[number, DesignEntry]> = [];
  for (const e of designCatalog()) {
    if (opts.kind && e.kind !== opts.kind) continue;
    if (opts.style && e.packs !== 'all' && !e.packs.includes(opts.style)) continue;
    const hay = `${e.name} ${e.intent} ${e.moods.join(' ')} ${e.kind}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (e.moods.includes(t)) score += 3;
      else if (hay.includes(t)) score += 1;
    }
    if (opts.style && e.packs !== 'all') score += 0.5; // pack-tuned beats generic on ties
    if (score > 0) scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id));
  return scored.slice(0, limit).map(([, e]) => e);
}

/** Exact-id lookup (scaffold bg slots, retakes). */
export function designEntry(id: string): DesignEntry | null {
  return designCatalog().find((e) => e.id === id) ?? null;
}
